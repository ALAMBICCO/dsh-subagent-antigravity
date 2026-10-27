/**
 * Loopback OpenAI-compatible HTTP server (`127.0.0.1:8791/v1`).
 *
 * Kept alongside the direct in-process `AntigravityLlmAdapter` so any preset
 * or external tool that points at `http://127.0.0.1:8791/v1` via `llm-pi-ai`
 * continues to work seamlessly without needing a second plugin installed.
 */

import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { MODELS, PROJECT, resolveModel, budgetForEffort } from './models.js'
import { openStream, describeFailure, log, invalidateToken, TOKEN_FILE } from './agy.js'
import { rememberSignature, signatureCount } from './signatures.js'
import { ssePayloads } from './adapter.js'
import {
    convertRequest,
    usageFrom,
    deltasFrom,
    openAiFinish,
    chunkFrame,
    completionId,
} from './openai.js'

const MAX_BODY = 32 * 1024 * 1024
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])

/**
 * Prefill warm-up gate: when multiple parallel subagents launch with an identical
 * request prefix (systemInstruction + tools + inherited history), let the first
 * request finish its prefill pass (first SSE delta or up to 12s) before releasing
 * sibling requests so Google's implicit prefix cache is warm for siblings.
 * @type {Map<string, Promise<void>>}
 */
const inflightPrefills = new Map()

function computePrefixHash(upstreamModel, request) {
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

function sendJson(res, status, body) {
    if (res.destroyed || res.writableEnded) return
    const text = JSON.stringify(body)
    if (!res.headersSent) {
        res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'content-length': Buffer.byteLength(text),
            'cache-control': 'no-store',
        })
    }
    res.end(text)
}

const sendError = (res, status, message, type = 'invalid_request_error') =>
    sendJson(res, status, { error: { message, type, code: status } })

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (chunk) => {
            size += chunk.length
            if (size > MAX_BODY) {
                reject(new Error(`request body exceeds ${MAX_BODY} bytes`))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (error) {
                reject(new Error(`request body is not JSON: ${error.message}`))
            }
        })
        req.on('error', reject)
    })
}

async function handleCompletions(_req, res, body, getSettings) {
    const runtimeSettings = typeof getSettings === 'function' ? getSettings() : null
    const requested = runtimeSettings?.overrideSubagent
        ? runtimeSettings.model
        : typeof body.model === 'string'
          ? body.model
          : undefined
    const model = resolveModel(requested)
    if (!model) {
        return sendError(res, 404, `unknown model "${requested}"; available: ${MODELS.map((m) => m.id).join(', ')}`)
    }

    const effectiveEffort = runtimeSettings?.overrideSubagent
        ? runtimeSettings.effort
        : (body.reasoning_effort ?? body.reasoning?.effort ?? runtimeSettings?.effort)
    const budget = budgetForEffort(effectiveEffort, model.thinkingBudget)
    const { request, upstreamModel } = convertRequest(body, model, budget)
    const wantsStream = body.stream !== false
    const id = completionId()
    const startedAt = Date.now()
    const write = (payload) => {
        if (!res.destroyed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`)
        }
    }

    const controller = new AbortController()
    res.on('close', () => {
        if (!res.writableEnded) controller.abort()
    })

    // Prefill warm-up stagger for parallel subagent waves sharing the same prefix
    const prefixHash = computePrefixHash(upstreamModel, request)
    let releasePrefillGate = null
    if (prefixHash) {
        const existingGate = inflightPrefills.get(prefixHash)
        if (existingGate) {
            await Promise.race([
                existingGate,
                new Promise((r) => setTimeout(r, 12000)),
            ])
            if (controller.signal.aborted || res.destroyed || res.writableEnded) return
        } else {
            let resolveGate
            const gatePromise = new Promise((r) => {
                resolveGate = r
            })
            inflightPrefills.set(prefixHash, gatePromise)
            releasePrefillGate = () => {
                if (inflightPrefills.get(prefixHash) === gatePromise) {
                    inflightPrefills.delete(prefixHash)
                }
                resolveGate()
            }
        }
    }

    let upstream
    try {
        upstream = await openStream(request, { model: upstreamModel, project: PROJECT, signal: controller.signal })
    } catch (error) {
        releasePrefillGate?.()
        if (controller.signal.aborted || res.destroyed || res.writableEnded) return
        log(`✗ proxy connect failed: ${error.message}`)
        return sendError(res, 502, `antigravity upstream unreachable: ${error.message}`, 'upstream_error')
    }

    if (!upstream.ok) {
        releasePrefillGate?.()
        const failure = await describeFailure(upstream)
        if (controller.signal.aborted || res.destroyed || res.writableEnded) return
        log(`✗ proxy upstream ${failure.status}: ${failure.message.slice(0, 200)}`)
        if (failure.status === 401) invalidateToken()
        const status = failure.status === 429 ? 429 : failure.status === 401 || failure.status === 403 ? 401 : 502
        return sendError(res, status, `antigravity upstream ${failure.status}: ${failure.message}`, 'upstream_error')
    }

    let firstDeltaAt = 0
    let text = ''
    let reasoningText = ''
    let usage
    let finishReason
    let thoughtChars = 0
    let streamFailed
    const toolCalls = []
    let toolCallIndex = 0
    let lastSeenSignature

    if (wantsStream) {
        res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
        })
        write(chunkFrame({ id, model: model.id, delta: { role: 'assistant', content: '' } }))
    }

    try {
        for await (const event of ssePayloads(upstream.body)) {
            if (releasePrefillGate) {
                releasePrefillGate()
                releasePrefillGate = null
            }
            const response = event?.response ?? event
            if (response?.usageMetadata) usage = usageFrom(response.usageMetadata)
            const delta = deltasFrom(response)
            thoughtChars += delta.thoughts.length
            if (delta.finishReason) finishReason = delta.finishReason
            if (delta.signature) lastSeenSignature = delta.signature

            if (delta.thoughts) {
                if (!firstDeltaAt) firstDeltaAt = Date.now()
                reasoningText += delta.thoughts
                if (wantsStream) {
                    write(chunkFrame({ id, model: model.id, delta: { reasoning_content: delta.thoughts } }))
                }
            }

            for (const piece of delta.texts) {
                if (!firstDeltaAt) firstDeltaAt = Date.now()
                text += piece
                if (wantsStream) write(chunkFrame({ id, model: model.id, delta: { content: piece } }))
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
                }
            }

            for (let i = 0; i < delta.calls.length; i += 1) {
                const call = delta.calls[i]
                if (!firstDeltaAt) firstDeltaAt = Date.now()
                const callId = call.id || `call_${randomUUID().replace(/-/g, '').slice(0, 12)}`
                const sig = call.signature || turnSig || lastSeenSignature
                if (sig) rememberSignature(callId, sig, call.name)
                const safeArgs = call.args ?? {}
                toolCalls.push({ id: callId, name: call.name, args: safeArgs })
                if (wantsStream) {
                    write(
                        chunkFrame({
                            id,
                            model: model.id,
                            delta: {
                                tool_calls: [
                                    {
                                        index: toolCallIndex++,
                                        id: callId,
                                        type: 'function',
                                        function: {
                                            name: call.name,
                                            arguments: JSON.stringify(safeArgs),
                                        },
                                    },
                                ],
                            },
                        }),
                    )
                }
            }
        }
    } catch (error) {
        if (!controller.signal.aborted) {
            streamFailed = error
            log(`✗ proxy stream broke after ${text.length} chars: ${error.message}`)
        }
    } finally {
        releasePrefillGate?.()
    }

    if (lastSeenSignature && toolCalls.length > 0) {
        for (const tc of toolCalls) {
            rememberSignature(tc.id, lastSeenSignature, tc.name)
        }
    }

    const elapsed = Date.now() - startedAt
    const ttft = firstDeltaAt ? firstDeltaAt - startedAt : 0
    const finalFinishReason =
        finishReason === 'MAX_TOKENS'
            ? 'length'
            : toolCalls.length > 0
              ? 'tool_calls'
              : (openAiFinish(finishReason) ?? 'stop')
    log(
        `${streamFailed ? '!' : '✓'} [proxy] ${model.id} effort=${effectiveEffort ?? '-'} budget=${budget} ${text.length} chars calls=${toolCalls.length} ttft=${ttft}ms total=${elapsed}ms ` +
            `thoughts=${thoughtChars}c usage=${usage ? `${usage.prompt_tokens}(cached=${usage.prompt_tokens_details?.cached_tokens ?? 0})/${usage.completion_tokens}` : 'none'}`,
    )

    if (controller.signal.aborted || res.destroyed || res.writableEnded) return

    if (!wantsStream) {
        if (streamFailed) {
            return sendError(res, 502, `antigravity stream failed: ${streamFailed.message}`, 'upstream_error')
        }
        return sendJson(res, 200, {
            id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model.id,
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: text || null,
                        ...(reasoningText ? { reasoning_content: reasoningText } : {}),
                        ...(toolCalls.length > 0
                            ? {
                                  tool_calls: toolCalls.map((c) => ({
                                      id: c.id,
                                      type: 'function',
                                      function: {
                                          name: c.name,
                                          arguments: JSON.stringify(c.args ?? {}),
                                      },
                                  })),
                              }
                            : {}),
                    },
                    finish_reason: finalFinishReason,
                },
            ],
            ...(usage ? { usage } : {}),
        })
    }

    if (streamFailed) {
        write({ error: { message: `antigravity stream failed: ${streamFailed.message}`, type: 'upstream_error', code: 502 } })
        res.end()
        return
    }

    write(
        chunkFrame({
            id,
            model: model.id,
            delta: {},
            finishReason: finalFinishReason,
            usage,
        }),
    )
    res.write('data: [DONE]\n\n')
    res.end()
}

function handleModels(_req, res) {
    sendJson(res, 200, {
        object: 'list',
        data: MODELS.map((model) => ({
            id: model.id,
            object: 'model',
            created: 0,
            owned_by: 'antigravity-subscription',
            context_window: model.contextWindow,
            max_output_tokens: model.maxOutput,
            name: model.name,
        })),
    })
}

export function startLoopbackProxy(port = 8791, getSettings) {
    if (!Number.isFinite(port) || port <= 0) return () => {}
    const server = createServer(async (req, res) => {
        const remote = req.socket.remoteAddress
        if (!LOOPBACK.has(remote)) return sendError(res, 403, 'this endpoint is loopback-only')

        let path
        try {
            path = new URL(req.url, 'http://127.0.0.1').pathname.replace(/\/+$/, '') || '/'
        } catch {
            return sendError(res, 400, 'unparsable request URI')
        }

        try {
            if (req.method === 'GET' && (path === '/health' || path === '/')) {
                const settings = typeof getSettings === 'function' ? getSettings() : undefined
                return sendJson(res, 200, {
                    ok: true,
                    service: 'dsh-subagent-antigravity',
                    project: PROJECT,
                    models: MODELS.map((m) => m.id),
                    settings,
                    tokenFile: TOKEN_FILE,
                    signatures: signatureCount(),
                })
            }
            if (req.method === 'GET' && path === '/v1/models') return handleModels(req, res)
            if (req.method === 'POST' && path === '/v1/chat/completions') {
                const body = await readBody(req)
                if (!body || typeof body !== 'object') return sendError(res, 400, 'expected a JSON object body')
                return await handleCompletions(req, res, body, getSettings)
            }
            return sendError(res, 404, `no route for ${req.method} ${path}`)
        } catch (error) {
            log(`✗ ${req.method} ${path} threw: ${error?.message ?? error}`)
            if (!res.headersSent) return sendError(res, 500, error?.message ?? 'internal error', 'server_error')
            try {
                res.end()
            } catch {
                /* already closed */
            }
        }
    })

    server.on('error', (error) => {
        log(`✗ loopback proxy on 127.0.0.1:${port}: ${error.message}`)
    })
    server.listen(port, '127.0.0.1', () => {
        log(`loopback proxy listening on http://127.0.0.1:${port}/v1`)
    })

    let closed = false
    const shutdown = () => {
        if (closed) return
        closed = true
        process.removeListener('exit', shutdown)
        try {
            server.closeAllConnections?.()
            server.close()
        } catch {
            /* ignore */
        }
    }
    process.once('exit', shutdown)
    return shutdown
}
