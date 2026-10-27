/**
 * OpenAI Chat Completions ⇄ Cloud Code Assist (Gemini) translation.
 *
 * Used by both the direct in-process `AntigravityLlmAdapter` and the optional
 * loopback OpenAI-compatible HTTP server.
 */

import { signatureFor } from './signatures.js'

const FINISH_REASONS = {
    STOP: 'stop',
    MAX_TOKENS: 'length',
    SAFETY: 'content_filter',
    RECITATION: 'content_filter',
    PROHIBITED_CONTENT: 'content_filter',
    BLOCKLIST: 'content_filter',
    SPII: 'content_filter',
}

export const completionId = () => `chatcmpl-agy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function inlineDataFromDataUrl(url) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(url ?? '')
    if (!match) return undefined
    return { inlineData: { mimeType: match[1], data: match[2] } }
}

/**
 * OpenAI message content (string, or an array of typed parts) -> Gemini parts.
 */
export function contentToParts(content) {
    if (typeof content === 'string') return content ? [{ text: content }] : []
    if (!Array.isArray(content)) return []
    const parts = []
    for (const part of content) {
        if (typeof part === 'string') {
            if (part) parts.push({ text: part })
            continue
        }
        if (!part || typeof part !== 'object') continue
        if (part.type === 'text' && typeof part.text === 'string') {
            if (part.text) parts.push({ text: part.text })
        } else if (part.type === 'image_url') {
            const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
            const inline = inlineDataFromDataUrl(url)
            if (inline) parts.push(inline)
            else if (url) parts.push({ text: `[image omitted: ${String(url).slice(0, 120)}]` })
        } else if (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
            parts.push({ inlineData: { mimeType: part.mimeType, data: part.data } })
        } else if (part.type === 'input_text' && typeof part.text === 'string') {
            if (part.text) parts.push({ text: part.text })
        }
    }
    return parts
}

const SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'])

/**
 * JSON Schema -> the strict `Schema` subset Gemini REST accepts.
 *
 * Strips unsupported keywords (`$schema`, `additionalProperties`, `default`,
 * `format`, `$ref`, `const`, `examples`, `anyOf`, `oneOf`, `allOf`) and prevents
 * empty `OBJECT` properties or missing `ARRAY` items anywhere in the schema tree
 * (which Gemini rejects with HTTP 400).
 */
export function toGeminiSchema(schema, depth = 0) {
    if (!schema || typeof schema !== 'object' || depth > 12) return undefined
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        const nonNull = schema.oneOf.find((b) => b?.type !== 'null') ?? schema.oneOf[0]
        return toGeminiSchema(nonNull, depth + 1)
    }
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        return toGeminiSchema(schema.allOf[0], depth + 1)
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        const nonNull = schema.anyOf.find((b) => b?.type !== 'null') ?? schema.anyOf[0]
        const converted = toGeminiSchema(nonNull, depth + 1)
        if (converted) {
            if (schema.anyOf.some((b) => b?.type === 'null')) converted.nullable = true
            if (typeof schema.description === 'string' && schema.description && !converted.description) {
                converted.description = schema.description
            }
            return converted
        }
    }

    const out = {}

    let type = schema.type
    if (Array.isArray(type)) {
        const nonNull = type.filter((t) => t !== 'null')
        if (type.includes('null')) out.nullable = true
        type = nonNull[0]
    }
    if (typeof type === 'string' && SCHEMA_TYPES.has(type)) out.type = type.toUpperCase()

    if (typeof schema.description === 'string' && schema.description) out.description = schema.description
    if (Array.isArray(schema.enum) && schema.enum.length > 0) out.enum = schema.enum.map((v) => String(v))
    if (schema.nullable === true) out.nullable = true

    if (schema.properties && typeof schema.properties === 'object') {
        const props = {}
        for (const [key, value] of Object.entries(schema.properties)) {
            const converted = toGeminiSchema(value, depth + 1)
            props[key] = converted ?? { type: 'STRING' }
        }
        if (Object.keys(props).length > 0) {
            out.properties = props
            if (out.type === undefined) out.type = 'OBJECT'
            if (Array.isArray(schema.required) && schema.required.length > 0) {
                const validReq = schema.required.filter((k) => typeof k === 'string' && Object.hasOwn(props, k))
                if (validReq.length > 0) out.required = validReq
            }
        }
    }

    if (schema.items) {
        out.items = toGeminiSchema(schema.items, depth + 1) ?? { type: 'STRING' }
        if (out.type === undefined) out.type = 'ARRAY'
    } else if (out.type === 'ARRAY') {
        out.items = { type: 'STRING' }
    }

    // Gemini rejects `type: "OBJECT"` with no properties anywhere in the tree.
    if (out.type === 'OBJECT' && (!out.properties || Object.keys(out.properties).length === 0)) {
        if (depth === 0) return undefined
        out.type = 'STRING'
        out.description = out.description ? `${out.description} (JSON object)` : 'JSON object'
    }

    return Object.keys(out).length > 0 ? out : undefined
}

/** One OpenAI or DSH function tool -> one Gemini function declaration. */
export function toDeclaration(tool) {
    const fn = tool?.function ?? tool ?? {}
    const declaration = { name: String(fn.name ?? 'tool') }
    if (typeof fn.description === 'string' && fn.description) declaration.description = fn.description
    const parameters = toGeminiSchema(fn.parameters)
    if (parameters && parameters.type === 'OBJECT' && parameters.properties && Object.keys(parameters.properties).length > 0) {
        declaration.parameters = parameters
    } else if (parameters && parameters.type !== 'OBJECT') {
        declaration.parameters = parameters
    }
    return declaration
}

function toToolConfig(toolChoice) {
    if (toolChoice === undefined || toolChoice === null || toolChoice === 'auto') {
        return { functionCallingConfig: { mode: 'AUTO' } }
    }
    if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } }
    if (toolChoice === 'required' || toolChoice === 'any') return { functionCallingConfig: { mode: 'ANY' } }
    if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
        const name = toolChoice.function?.name
        return {
            functionCallingConfig: {
                mode: 'ANY',
                ...(typeof name === 'string' && name ? { allowedFunctionNames: [name] } : {}),
            },
        }
    }
    return { functionCallingConfig: { mode: 'AUTO' } }
}

/**
 * Validate that every `model` turn containing `functionCall` parts is immediately
 * answered by a `user` turn containing matching `functionResponse` parts (and if
 * a user turn mixes `functionResponse` with non-functionResponse parts like images
 * or text, split the non-functionResponse parts into a separate subsequent user turn).
 * If an assistant turn was interrupted or compacted so its tool responses are missing,
 * degrade its `functionCall` parts to readable text so Gemini never rejects with HTTP 400.
 */
function sanitizeFunctionCallPairing(contents) {
    for (let i = 0; i < contents.length; i += 1) {
        const turn = contents[i]
        if (turn.role !== 'model') continue
        const callParts = turn.parts.filter((p) => p.functionCall)
        if (callParts.length === 0) continue

        const nextTurn = contents[i + 1]
        const respParts = nextTurn?.role === 'user' ? nextTurn.parts.filter((p) => p.functionResponse) : []
        const callIds = callParts.map((p) => p.functionCall.id).filter(Boolean)
        const respIds = new Set(respParts.map((p) => p.functionResponse.id).filter(Boolean))

        const allMatched =
            nextTurn?.role === 'user' &&
            respParts.length === callParts.length &&
            callIds.every((id) => respIds.has(id))

        if (!allMatched) {
            turn.parts = turn.parts.map((p) => {
                if (!p.functionCall) return p
                const { name, args } = p.functionCall
                return { text: `[called ${name}(${JSON.stringify(args ?? {})})]` }
            })
            if (nextTurn?.role === 'user') {
                nextTurn.parts = nextTurn.parts.map((p) => {
                    if (!p.functionResponse) return p
                    const { name, response } = p.functionResponse
                    const out = response?.output !== undefined ? response.output : response
                    return { text: `[${name} returned]\n${typeof out === 'string' ? out : JSON.stringify(out)}` }
                })
            }
        } else if (nextTurn && nextTurn.parts.length > respParts.length) {
            // Separate any trailing non-functionResponse parts (e.g. inline images or user messages)
            // so the functionResponse turn contains ONLY functionResponse parts when required.
            const nonRespParts = nextTurn.parts.filter((p) => !p.functionResponse)
            nextTurn.parts = respParts
            contents.splice(i + 2, 0, { role: 'user', parts: nonRespParts })
        }
    }
}

/**
 * Build the Gemini `request` object and pick the upstream model from an
 * OpenAI-shaped body.
 */
export function convertRequest(body, model, thinkingBudget) {
    /** @type {string[]} */
    const systemTexts = []
    /** @type {{role: 'user'|'model', parts: object[]}[]} */
    const contents = []
    /** call id -> function name */
    const callNames = new Map()
    /** call ids whose signature is lost; their whole exchange degrades to text */
    const degraded = new Set()
    const isClaude = model.upstream.startsWith('claude-') || model.upstream.startsWith('gpt-oss-')

    const push = (role, parts) => {
        const nonEmpty = parts.filter((p) => p && (typeof p.text !== 'string' || p.text.length > 0))
        if (nonEmpty.length === 0) return
        const last = contents[contents.length - 1]
        if (last && last.role === role) {
            last.parts.push(...nonEmpty)
            return
        }
        contents.push({ role, parts: nonEmpty })
    }

    for (const message of body.messages ?? []) {
        if (!message || typeof message !== 'object') continue
        const role = message.role
        if (role === 'system' || role === 'developer') {
            const text =
                typeof message.content === 'string'
                    ? message.content
                    : contentToParts(message.content)
                          .filter((p) => p.text)
                          .map((p) => p.text)
                          .join('\n\n')
            if (text) systemTexts.push(text)
            continue
        }

        if (role === 'tool' || role === 'function') {
            const raw =
                typeof message.content === 'string'
                    ? message.content
                    : contentToParts(message.content)
                          .filter((p) => p.text)
                          .map((p) => p.text)
                          .join('\n')
            const id = message.tool_call_id
            const name = callNames.get(id) ?? message.name ?? 'tool'

            if (degraded.has(id) || !callNames.has(id)) {
                push('user', [{ text: `[${name} returned]\n${raw ?? ''}` }])
                continue
            }
            let parsed
            try {
                parsed = raw && /^\s*[[{]/.test(raw) ? JSON.parse(raw) : undefined
            } catch {
                parsed = undefined
            }
            const inlineImages = Array.isArray(message.content)
                ? contentToParts(message.content).filter((p) => p.inlineData)
                : []
            push('user', [
                {
                    functionResponse: {
                        name,
                        ...(id ? { id } : {}),
                        response: parsed !== undefined ? { output: parsed } : { output: raw ?? '' },
                    },
                },
                ...inlineImages,
            ])
            continue
        }

        if (role === 'assistant') {
            const parts = []
            if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
                parts.push({ thought: true, text: message.reasoning_content })
            }
            parts.push(...contentToParts(message.content))
            const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
            if (calls.length > 0) {
                let turnSig
                for (const call of calls) {
                    const sig = call?.thoughtSignature ?? signatureFor(call?.id)
                    if (sig) {
                        turnSig = sig
                        break
                    }
                }
                for (let i = 0; i < calls.length; i += 1) {
                    const call = calls[i]
                    const fn = call?.function ?? {}
                    const name = String(fn.name ?? 'tool')
                    const id = call?.id
                    if (id) callNames.set(id, name)
                    let args
                    try {
                        args = typeof fn.arguments === 'string' ? (fn.arguments ? JSON.parse(fn.arguments) : {}) : (fn.arguments ?? {})
                    } catch {
                        args = { input: fn.arguments }
                    }
                    // Claude/GPT models on Cloud Code Assist do not require thoughtSignature;
                    // Gemini 3.x requires turnSig on the turn's first functionCall part.
                    if (!turnSig && !isClaude) {
                        if (id) degraded.add(id)
                        parts.push({ text: `[called ${name}(${typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(args)})]` })
                        continue
                    }
                    const ownSig = call?.thoughtSignature ?? signatureFor(id) ?? (i === 0 ? turnSig : undefined)
                    parts.push({
                        functionCall: { name, args, ...(id ? { id } : {}) },
                        ...(ownSig ? { thoughtSignature: ownSig } : {}),
                    })
                }
            }
            push('model', parts)
            continue
        }
        push('user', contentToParts(message.content))
    }

    sanitizeFunctionCallPairing(contents)

    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: '(start)' }] })
    } else if (contents[0].role === 'model') {
        contents.unshift({ role: 'user', parts: [{ text: '(continuing the conversation)' }] })
    }
    // Gemini rejects requests ending with a model turn with HTTP 400
    if (contents[contents.length - 1].role === 'model') {
        contents.push({ role: 'user', parts: [{ text: '(continue)' }] })
    }

    const generationConfig = {}
    const maxOut = Number.isFinite(body.max_completion_tokens)
        ? body.max_completion_tokens
        : Number.isFinite(body.max_tokens)
          ? body.max_tokens
          : undefined
    generationConfig.maxOutputTokens = Math.min(maxOut ?? model.maxOutput, model.maxOutput)
    if (Number.isFinite(body.temperature)) generationConfig.temperature = body.temperature
    if (Number.isFinite(body.top_p)) generationConfig.topP = body.top_p
    if (Array.isArray(body.stop) && body.stop.length > 0) generationConfig.stopSequences = body.stop.slice(0, 4)
    else if (typeof body.stop === 'string') generationConfig.stopSequences = [body.stop]
    if (Number.isFinite(thinkingBudget) && thinkingBudget >= 0) {
        generationConfig.thinkingConfig = {
            thinkingBudget,
            ...(thinkingBudget > 0 ? { includeThoughts: true } : {}),
        }
    } else if (thinkingBudget < 0) {
        generationConfig.thinkingConfig = { includeThoughts: true }
    }

    const request = { contents, generationConfig }

    const declarations = (Array.isArray(body.tools) ? body.tools : [])
        .filter((tool) => tool && (tool.type === 'function' ? tool.function?.name : tool.name))
        .map(toDeclaration)
    if (declarations.length > 0) {
        request.tools = [{ functionDeclarations: declarations }]
        request.toolConfig = toToolConfig(body.tool_choice)
    }

    if (systemTexts.length > 0) {
        request.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] }
    }
    return { request, upstreamModel: model.upstream, toolCount: declarations.length }
}

/** OpenAI-shaped usage from Gemini's `usageMetadata`. */
export function usageFrom(usageMetadata) {
    if (!usageMetadata) return undefined
    const prompt = usageMetadata.promptTokenCount ?? 0
    const candidates = usageMetadata.candidatesTokenCount ?? 0
    const thoughts = usageMetadata.thoughtsTokenCount ?? 0
    const cached = usageMetadata.cachedContentTokenCount ?? 0
    const completion = candidates + thoughts
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: usageMetadata.totalTokenCount ?? prompt + completion,
        prompt_tokens_details: { cached_tokens: cached },
        completion_tokens_details: { reasoning_tokens: thoughts },
    }
}

/** DSH `TokenUsage` from Gemini's `usageMetadata`. */
export function dshUsageFrom(usageMetadata) {
    if (!usageMetadata) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const promptTotal = usageMetadata.promptTokenCount ?? 0
    const cached = usageMetadata.cachedContentTokenCount ?? 0
    const candidates = usageMetadata.candidatesTokenCount ?? 0
    const thoughts = usageMetadata.thoughtsTokenCount ?? 0
    const inputTokens = Math.max(0, promptTotal - cached)
    const outputTokens = candidates + thoughts
    const totalTokens = usageMetadata.totalTokenCount ?? promptTotal + outputTokens
    return {
        inputTokens,
        outputTokens,
        totalTokens,
        ...(cached > 0 ? { cacheReadTokens: cached } : {}),
        ...(thoughts > 0 ? { reasoningTokens: thoughts } : {}),
    }
}

/**
 * Split one Gemini SSE event into visible text, thoughts, function calls, and signature.
 */
export function deltasFrom(response) {
    const candidate = response?.candidates?.[0]
    if (!candidate) return { texts: [], calls: [], finishReason: undefined, thoughts: '', signature: undefined }
    const texts = []
    const calls = []
    let thoughts = ''
    let signature
    for (const part of candidate.content?.parts ?? []) {
        if (typeof part.thoughtSignature === 'string' && part.thoughtSignature) signature = part.thoughtSignature
        if (part.functionCall) {
            calls.push({
                name: String(part.functionCall.name ?? 'tool'),
                args: part.functionCall.args ?? {},
                id: part.functionCall.id,
                signature: part.thoughtSignature,
            })
            continue
        }
        if (typeof part.text !== 'string' || !part.text) continue
        if (part.thought === true) thoughts += part.text
        else texts.push(part.text)
    }
    return { texts, calls, finishReason: candidate.finishReason, thoughts, signature }
}

export const openAiFinish = (reason) => FINISH_REASONS[reason] ?? (reason ? 'stop' : undefined)

export function chunkFrame({ id, model, delta, finishReason, usage }) {
    const chunk = {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: delta ?? {}, finish_reason: finishReason ?? null }],
    }
    if (usage) chunk.usage = usage
    return chunk
}
