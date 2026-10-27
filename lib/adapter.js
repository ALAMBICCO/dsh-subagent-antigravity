/**
 * Direct in-process DSH `LlmAdapter` for the Antigravity subscription.
 *
 * Registers the `antigravity` provider route on `ctx.llm` so `subagent_fork`
 * (and `subagent`) child sessions run natively in-process on the user's
 * Google AI Pro subscription (`daily-cloudcode-pa.googleapis.com`) without
 * needing a loopback HTTP proxy or `llm-pi-ai` configuration in `cordis.patch.yml`.
 */

import { createHash, randomUUID } from 'node:crypto'
import {
    LlmAdapter,
    LlmError,
    ReasoningEffortId,
    ToolCallId,
    EMPTY_RESPONSE_CODE,
    CONTEXT_WINDOW_EXCEEDED_CODE,
    QUOTA_EXCEEDED_CODE,
    contentHasImage,
    offloadedImageText,
    projectOffloadedImages,
    requestImageHandleText,
    resolveImageAttachmentAccess,
    isContextWindowExceededError,
    isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'
import { requestImageDimensions } from '@deepseek-ai/dsh-attachment'
import { MODELS, PROJECT, resolveModel, budgetForEffort } from './models.js'
import { openStream, describeFailure, log, invalidateToken } from './agy.js'
import { rememberSignature } from './signatures.js'
import { convertRequest, deltasFrom, dshUsageFrom } from './openai.js'

const DEFAULT_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_IMAGE_MAX_BYTES = 1024 * 1024

const CONTENT_FILTER_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'])

/** @type {Map<string, Promise<void>>} */
const inflightAdapterPrefills = new Map()

function computeAdapterPrefixHash(upstreamModel, request) {
    try {
        const prefixTurns = Array.isArray(request.contents) && request.contents.length > 1
            ? request.contents.slice(0, -1)
            : []
        const raw = JSON.stringify({
            m: upstreamModel,
            s: request.systemInstruction,
            t: request.tools,
            c: prefixTurns,
        })
        if (raw.length < 8000) return null
        return createHash('sha1').update(raw).digest('hex')
    } catch {
        return null
    }
}

/**
 * Pull one SSE JSON payload per `data:` line out of a byte stream.
 * @param {ReadableStream<Uint8Array>} stream
 */
export async function* ssePayloads(stream) {
    if (!stream) return
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let newline
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).replace(/\r$/, '')
                buffer = buffer.slice(newline + 1)
                if (!line.startsWith('data:')) continue
                const payload = line.slice(5).trim()
                if (!payload || payload === '[DONE]') continue
                try {
                    yield JSON.parse(payload)
                } catch {
                    /* ignore malformed frame */
                }
            }
        }
        buffer += decoder.decode()
        for (const rawLine of buffer.split('\n')) {
            const trailing = rawLine.trim()
            if (!trailing.startsWith('data:')) continue
            const payload = trailing.slice(5).trim()
            if (payload && payload !== '[DONE]') {
                try {
                    yield JSON.parse(payload)
                } catch {
                    /* ignore trailing partial frame */
                }
            }
        }
    } finally {
        reader.cancel().catch(() => {})
    }
}

function classifyFailureCode(status, detail) {
    if (status === 401 || status === 403) return 'AUTH'
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    if (isQuotaExceededError(detail) || status === 402) return QUOTA_EXCEEDED_CODE
    if (status === 429) return 'RATE_LIMIT'
    if (status === 400 || status === 413) return 'INVALID_REQUEST'
    if (status !== undefined && status >= 500) return 'SERVER'
    return status === undefined ? 'TRANSPORT' : `HTTP_${status}`
}

function mapFinishReason(rawReason, hasToolCalls, hasBlocks, modelId) {
    if (rawReason === 'MAX_TOKENS') return { kind: 'max-tokens' }
    if (hasToolCalls) return { kind: 'tool-calls' }
    if (rawReason && CONTENT_FILTER_REASONS.has(rawReason)) {
        return {
            kind: 'error',
            failure: {
                message: `Antigravity model "${modelId}" blocked output (${rawReason})`,
                code: 'CONTENT_FILTER',
            },
        }
    }
    if (!hasBlocks) {
        return {
            kind: 'error',
            failure: {
                message: `Antigravity model "${modelId}" returned a completed response with no content`,
                code: EMPTY_RESPONSE_CODE,
            },
        }
    }
    return { kind: 'stop' }
}

/**
 * Convert DSH `GenerateOptions` into the OpenAI-shaped body that `convertRequest` consumes,
 * resolving any durable image attachments through `ctx.attachments`.
 */
async function dshOptionsToOpenAiBody(options, ctx) {
    const attachments = ctx?.get?.('attachments')
    const resolveAccess = (ref) =>
        attachments
            ? resolveImageAttachmentAccess(attachments, (hostPath) => ctx?.get?.('fs')?.processPathFromHostPath(hostPath), ref)
            : undefined

    const projected = projectOffloadedImages(options.messages ?? [], (ref) => offloadedImageText(ref, resolveAccess(ref)))

    // Prepare any retained image blocks
    const imageMap = new Map()
    if (attachments) {
        for (const msg of projected) {
            if (!contentHasImage(msg.content)) continue
            for (const block of msg.content) {
                if (block.type === 'image' && !block.offloaded && !imageMap.has(block.attachment.attachmentId)) {
                    const target = {
                        ...requestImageDimensions(block.attachment.width, block.attachment.height, DEFAULT_IMAGE_PIXEL_BUDGET),
                        maxBytes: DEFAULT_IMAGE_MAX_BYTES,
                    }
                    const version = await attachments.readImageRequest(block.attachment, target, options.signal)
                    imageMap.set(block.attachment.attachmentId, version)
                }
            }
        }
    }

    const convertBlocks = (blocks) => {
        const parts = []
        for (const block of blocks ?? []) {
            if (block.type === 'text' && block.text) {
                parts.push({ type: 'text', text: block.text })
            } else if (block.type === 'image') {
                const version = imageMap.get(block.attachment.attachmentId)
                if (version) {
                    const handleText = requestImageHandleText(block.attachment, version, resolveAccess(block.attachment))
                    parts.push({ type: 'text', text: handleText })
                    const b64 = Buffer.from(version.data).toString('base64')
                    parts.push({ type: 'image_url', image_url: { url: `data:${version.mediaType};base64,${b64}` } })
                } else {
                    parts.push({ type: 'text', text: offloadedImageText(block.attachment, resolveAccess(block.attachment)) })
                }
            }
        }
        if (parts.length === 0) return ''
        if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('\n')
        return parts
    }

    const messages = []
    if (typeof options.system === 'string' && options.system.trim()) {
        messages.push({ role: 'system', content: options.system })
    }

    for (const msg of projected) {
        if (msg.role === 'system' || msg.role === 'developer') {
            const text = (msg.content ?? [])
                .filter((b) => b.type === 'text' && b.text)
                .map((b) => b.text)
                .join('\n\n')
            if (text) messages.push({ role: msg.role, content: text })
            continue
        }
        if (msg.role === 'tool') {
            messages.push({
                role: 'tool',
                tool_call_id: msg.toolCallId,
                content: convertBlocks(msg.content),
            })
            continue
        }
        if (msg.role === 'assistant') {
            const reasoningBlocks = (msg.content ?? []).filter((b) => b.type === 'reasoning' && b.text)
            const textBlocks = (msg.content ?? []).filter((b) => b.type === 'text' && b.text)
            const toolCallBlocks = (msg.content ?? []).filter((b) => b.type === 'tool-call')
            const replayBlocks = Array.isArray(msg.source?.replayState?.blocks) ? msg.source.replayState.blocks : undefined

            const tool_calls = toolCallBlocks.map((b) => {
                const blockIdx = (msg.content ?? []).indexOf(b)
                const replayEntry = blockIdx >= 0 ? replayBlocks?.[blockIdx] : undefined
                return {
                    id: b.id,
                    type: 'function',
                    function: {
                        name: b.name,
                        arguments: b.arguments ?? '{}',
                    },
                    ...(typeof replayEntry?.thoughtSignature === 'string'
                        ? { thoughtSignature: replayEntry.thoughtSignature }
                        : {}),
                }
            })

            const reasoningText = reasoningBlocks.map((b) => b.text).join('')
            messages.push({
                role: 'assistant',
                content: textBlocks.map((b) => b.text).join(''),
                ...(reasoningText ? { reasoning_content: reasoningText } : {}),
                ...(tool_calls.length > 0 ? { tool_calls } : {}),
            })
            continue
        }
        if (msg.role === 'user') {
            messages.push({
                role: 'user',
                content: convertBlocks(msg.content),
            })
        }
    }

    const tools = (options.tools ?? [])
        .filter((t) => !t.deferLoading)
        .map((t) => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }))

    return {
        model: options.model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.stop !== undefined ? { stop: options.stop } : {}),
        ...(options.reasoningEffort !== undefined ? { reasoning_effort: String(options.reasoningEffort) } : {}),
    }
}

export class AntigravityLlmAdapter extends LlmAdapter {
    constructor(ctx, getSettings) {
        super()
        this.ctx = ctx
        this.getSettings = typeof getSettings === 'function' ? getSettings : null
    }

    providerInfo(provider) {
        return {
            id: provider,
            name: 'Antigravity (Google AI Pro subscription)',
        }
    }

    imageRequestTarget(_provider, _model, image) {
        return {
            ...requestImageDimensions(image.width, image.height, DEFAULT_IMAGE_PIXEL_BUDGET),
            maxBytes: DEFAULT_IMAGE_MAX_BYTES,
        }
    }

    listModels(provider) {
        return Promise.resolve(
            MODELS.map((m) => ({
                provider,
                id: m.id,
                name: m.name,
                description: m.description,
                inputModalities: [...m.inputModalities],
            })),
        )
    }

    resolveModel(provider, modelId) {
        const entry = resolveModel(modelId) ?? MODELS[0]
        return Promise.resolve({
            provider,
            id: modelId,
            name: entry.name,
            description: entry.description,
            inputModalities: [...entry.inputModalities],
            context: { contextWindow: entry.contextWindow },
            defaultMaxTokens: entry.maxOutput,
            reasoning: {
                efforts: [
                    { id: ReasoningEffortId('low'), name: 'Low' },
                    { id: ReasoningEffortId('medium'), name: 'Medium' },
                    { id: ReasoningEffortId('high'), name: 'High' },
                    { id: ReasoningEffortId('max'), name: 'Max' },
                ],
                defaultEffort: ReasoningEffortId(
                    modelId.includes('low') ? 'low' : modelId.includes('medium') ? 'medium' : 'high',
                ),
            },
        })
    }

    async *stream(options) {
        const runtimeSettings = this.getSettings ? this.getSettings() : null
        const effectiveModelId = runtimeSettings?.overrideSubagent ? runtimeSettings.model : options.model
        const model = resolveModel(effectiveModelId) ?? resolveModel(options.model)
        if (!model) {
            throw new LlmError(`Antigravity adapter does not serve model "${options.model}"`, 'UNKNOWN_MODEL')
        }

        const body = await dshOptionsToOpenAiBody(options, this.ctx)
        const effectiveEffort = runtimeSettings?.overrideSubagent
            ? runtimeSettings.effort
            : (body.reasoning_effort ?? runtimeSettings?.effort)
        const budget = budgetForEffort(effectiveEffort, model.thinkingBudget)
        const { request, upstreamModel } = convertRequest(body, model, budget)

        const startedAt = Date.now()
        const controller = new AbortController()
        const onCallerAbort = () => controller.abort(options.signal?.reason)
        if (options.signal?.aborted) {
            controller.abort(options.signal.reason)
            throw new LlmError('Antigravity request aborted', 'ABORTED')
        }
        options.signal?.addEventListener?.('abort', onCallerAbort, { once: true })

        try {
            const prefixHash = computeAdapterPrefixHash(upstreamModel, request)
            let releasePrefillGate = null
            if (prefixHash) {
                const existingGate = inflightAdapterPrefills.get(prefixHash)
                if (existingGate) {
                    await Promise.race([
                        existingGate,
                        new Promise((r) => setTimeout(r, 12000)),
                    ])
                    if (options.signal?.aborted) throw new LlmError('Antigravity request aborted', 'ABORTED')
                } else {
                    let resolveGate
                    const gatePromise = new Promise((r) => {
                        resolveGate = r
                    })
                    inflightAdapterPrefills.set(prefixHash, gatePromise)
                    releasePrefillGate = () => {
                        if (inflightAdapterPrefills.get(prefixHash) === gatePromise) {
                            inflightAdapterPrefills.delete(prefixHash)
                        }
                        resolveGate()
                    }
                }
            }

            let upstream
            try {
                upstream = await openStream(request, {
                    model: upstreamModel,
                    project: PROJECT,
                    signal: controller.signal,
                })
            } catch (error) {
                releasePrefillGate?.()
                if (options.signal?.aborted) throw new LlmError('Antigravity request aborted', 'ABORTED', { cause: error })
                log(`✗ adapter connect failed: ${error.message}`)
                throw new LlmError(`Antigravity upstream unreachable: ${error.message}`, 'TRANSPORT', { cause: error })
            }

            if (!upstream.ok) {
                releasePrefillGate?.()
                const failure = await describeFailure(upstream)
                log(`✗ adapter upstream ${failure.status}: ${failure.message.slice(0, 200)}`)
                if (failure.status === 401) invalidateToken()
                const code = classifyFailureCode(failure.status, failure.message)
                throw new LlmError(`Antigravity upstream ${failure.status}: ${failure.message}`, code, {
                    status: failure.status,
                })
            }

            let firstDeltaAt = 0
            let nextBlockIndex = 0
            let openReasoningBlock = null
            let openTextBlock = null
            const emittedBlocks = []
            const replayBlocks = []
            const toolCalls = []
            let usageMetadata
            let finishReason
            let thoughtChars = 0
            let lastSeenSignature

            const closeOpenReasoningBlock = function* () {
                if (openReasoningBlock === null) return
                const finished = openReasoningBlock
                openReasoningBlock = null
                const block = { type: 'reasoning', text: finished.text }
                emittedBlocks.push(block)
                replayBlocks.push({ type: 'reasoning' })
                yield {
                    type: 'block-end',
                    index: finished.index,
                    block,
                }
            }

            const closeOpenTextBlock = function* () {
                if (openTextBlock === null) return
                const finished = openTextBlock
                openTextBlock = null
                const block = { type: 'text', text: finished.text }
                emittedBlocks.push(block)
                replayBlocks.push({ type: 'text' })
                yield {
                    type: 'block-end',
                    index: finished.index,
                    block,
                }
            }

            try {
                for await (const event of ssePayloads(upstream.body)) {
                    if (releasePrefillGate) {
                        releasePrefillGate()
                        releasePrefillGate = null
                    }
                    const response = event?.response ?? event
                    if (response?.usageMetadata) usageMetadata = response.usageMetadata
                    const delta = deltasFrom(response)
                    thoughtChars += delta.thoughts.length
                    if (delta.finishReason) finishReason = delta.finishReason
                    if (delta.signature) lastSeenSignature = delta.signature

                    if (delta.thoughts) {
                        yield* closeOpenTextBlock()
                        if (!firstDeltaAt) firstDeltaAt = Date.now()
                        if (openReasoningBlock === null) {
                            openReasoningBlock = { index: nextBlockIndex++, text: '' }
                            yield {
                                type: 'block-start',
                                index: openReasoningBlock.index,
                                blockType: 'reasoning',
                            }
                        }
                        openReasoningBlock.text += delta.thoughts
                        yield {
                            type: 'reasoning-delta',
                            index: openReasoningBlock.index,
                            text: delta.thoughts,
                        }
                    }

                    for (const piece of delta.texts) {
                        yield* closeOpenReasoningBlock()
                        if (!firstDeltaAt) firstDeltaAt = Date.now()
                        if (openTextBlock === null) {
                            openTextBlock = { index: nextBlockIndex++, text: '' }
                            yield {
                                type: 'block-start',
                                index: openTextBlock.index,
                                blockType: 'text',
                            }
                        }
                        openTextBlock.text += piece
                        yield {
                            type: 'text-delta',
                            index: openTextBlock.index,
                            text: piece,
                        }
                    }

                    let turnSig = delta.signature
                    for (const call of delta.calls) {
                        if (call.signature) {
                            turnSig = call.signature
                            break
                        }
                    }
                    if (turnSig) lastSeenSignature = turnSig

                    if (lastSeenSignature && toolCalls.length > 0) {
                        for (const tc of toolCalls) {
                            rememberSignature(tc.id, lastSeenSignature, tc.name)
                            if (tc.replay && !tc.replay.thoughtSignature) {
                                tc.replay.thoughtSignature = lastSeenSignature
                            }
                        }
                    }

                    for (let i = 0; i < delta.calls.length; i += 1) {
                        yield* closeOpenReasoningBlock()
                        yield* closeOpenTextBlock()
                        const call = delta.calls[i]
                        if (!firstDeltaAt) firstDeltaAt = Date.now()
                        const rawId = call.id || `call_${randomUUID().replace(/-/g, '').slice(0, 12)}`
                        const callId = ToolCallId(rawId)
                        const sig = call.signature || turnSig || lastSeenSignature
                        if (sig) rememberSignature(rawId, sig, call.name)

                        const argsJson = JSON.stringify(call.args ?? {})
                        const blockIndex = nextBlockIndex++
                        const block = {
                            type: 'tool-call',
                            id: callId,
                            name: call.name,
                            arguments: argsJson,
                        }
                        const replayEntry = {
                            type: 'tool-call',
                            ...(sig ? { thoughtSignature: sig } : {}),
                        }
                        emittedBlocks.push(block)
                        replayBlocks.push(replayEntry)
                        toolCalls.push({ id: rawId, name: call.name, args: call.args, replay: replayEntry })

                        yield {
                            type: 'block-start',
                            index: blockIndex,
                            blockType: 'tool-call',
                        }
                        yield {
                            type: 'tool-call-delta',
                            index: blockIndex,
                            id: callId,
                            name: call.name,
                            argumentsDelta: argsJson,
                        }
                        yield {
                            type: 'block-end',
                            index: blockIndex,
                            block,
                        }
                    }
                }
            } catch (error) {
                if (options.signal?.aborted) {
                    throw new LlmError('Antigravity stream aborted by caller', 'ABORTED', { cause: error })
                }
                throw new LlmError(`Antigravity stream interrupted: ${error.message}`, 'TRANSPORT', { cause: error })
            } finally {
                releasePrefillGate?.()
            }

            yield* closeOpenReasoningBlock()
            yield* closeOpenTextBlock()

            if (lastSeenSignature && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    rememberSignature(tc.id, lastSeenSignature, tc.name)
                    if (tc.replay && !tc.replay.thoughtSignature) {
                        tc.replay.thoughtSignature = lastSeenSignature
                    }
                }
            }

            const usage = dshUsageFrom(usageMetadata)
            const elapsed = Date.now() - startedAt
            const ttft = firstDeltaAt ? firstDeltaAt - startedAt : 0
            log(
                `✓ [adapter] ${model.id} effort=${effectiveEffort ?? '-'} budget=${budget} blocks=${emittedBlocks.length} calls=${toolCalls.length} ttft=${ttft}ms total=${elapsed}ms ` +
                    `thoughts=${thoughtChars}c usage=${usage.inputTokens}(cached=${usage.cacheReadTokens ?? 0})/${usage.outputTokens}`,
            )

            yield {
                type: 'usage',
                usage,
            }
            yield {
                type: 'finish',
                reason: mapFinishReason(finishReason, toolCalls.length > 0, emittedBlocks.length > 0, model.id),
                replayState: {
                    response: {
                        kind: 'antigravity',
                        version: 1,
                        provider: options.provider,
                        model: model.id,
                    },
                    blocks: replayBlocks,
                },
            }
        } finally {
            options.signal?.removeEventListener?.('abort', onCallerAbort)
            controller.abort()
        }
    }
}
