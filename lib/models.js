/**
 * The model table for the Antigravity subscription (Google AI Pro via Cloud Code Assist).
 *
 * `agy models` advertises `gemini-3.8-flash-{low,medium,high}`, which are CLI-side
 * aliases for the single Cloud Code Assist catalogue entry `gemini-3.8-flash-tiered`
 * (1M context, 64k output) with different `thinkingConfig.thinkingBudget` caps.
 *
 * Cloud Code Assist also serves `claude-sonnet-5-5-{low,medium,high}`,
 * `claude-opus-5-5-{low,medium,high}`, and `gpt-oss-120b-medium` on a separate
 * quota bucket (Anthropic / GPT-OSS Vertex).
 */

export const PROJECT = 'aicode-consumers'

const FLASH = 'gemini-3.8-flash-tiered'

export const EFFORT_LEVELS = [
    { id: 'low', label: 'Low', shortLabel: 'Low', budget: 0, description: 'Fastest response, thinking disabled (0 token budget)' },
    { id: 'medium', label: 'Medium', shortLabel: 'Med', budget: 4096, description: 'Balanced reasoning (4,096 token budget)' },
    { id: 'high', label: 'High', shortLabel: 'High', budget: 24576, description: 'Deep reasoning (24,576 token budget)' },
    { id: 'max', label: 'Max', shortLabel: 'Max', budget: 32768, description: 'Maximum reasoning (32,768 token budget)' },
]

export const MODEL_FAMILIES = [
    {
        id: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
        bucket: 'gemini',
        bucketLabel: 'Gemini Flash / Pro',
        description: '1M context, 64k output — draws on the Gemini Flash/Pro quota',
    },
    {
        id: 'claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5',
        bucket: 'claude',
        bucketLabel: 'Claude / GPT-OSS',
        description: '1M context, 128k output — draws on the Claude/GPT quota',
    },
    {
        id: 'claude-opus-5-5',
        label: 'Claude Opus 5.5',
        bucket: 'claude',
        bucketLabel: 'Claude / GPT-OSS',
        description: '1M context, 128k output — draws on the Claude/GPT quota',
    },
    {
        id: 'gpt-oss-120b',
        label: 'GPT-OSS 120B',
        bucket: 'claude',
        bucketLabel: 'Claude / GPT-OSS',
        description: 'Open-weight 120B model — draws on the Claude/GPT quota',
    },
]

export const MODELS = [
    {
        id: 'gemini-3.8-flash-high',
        family: 'gemini-3.8-flash',
        upstream: FLASH,
        name: 'Gemini 3.8 Flash (High) — Antigravity subscription',
        description: 'Fast 256k-context Gemini 3.8 Flash with high thinking budget (24k tokens) on Google AI Pro.',
        contextWindow: 256000,
        maxOutput: 16384,
        thinkingBudget: 24576,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'gemini-3.8-flash-medium',
        family: 'gemini-3.8-flash',
        upstream: FLASH,
        name: 'Gemini 3.8 Flash (Medium) — Antigravity subscription',
        description: 'Gemini 3.8 Flash with balanced thinking budget (4k tokens) on Google AI Pro.',
        contextWindow: 256000,
        maxOutput: 16384,
        thinkingBudget: 4096,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'gemini-3.8-flash-low',
        family: 'gemini-3.8-flash',
        upstream: FLASH,
        name: 'Gemini 3.8 Flash (Low) — Antigravity subscription',
        description: 'Lowest-latency Gemini 3.8 Flash with thinking disabled (0 budget) on Google AI Pro.',
        contextWindow: 256000,
        maxOutput: 16384,
        thinkingBudget: 0,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-sonnet-5-5-high',
        family: 'claude-sonnet-5-5',
        upstream: 'claude-sonnet-5-5-high',
        name: 'Claude Sonnet 5.5 (High) — Antigravity subscription',
        description: 'Claude Sonnet 5.5 (High) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-sonnet-5-5-medium',
        family: 'claude-sonnet-5-5',
        upstream: 'claude-sonnet-5-5-medium',
        name: 'Claude Sonnet 5.5 (Medium) — Antigravity subscription',
        description: 'Claude Sonnet 5.5 (Medium) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-sonnet-5-5-low',
        family: 'claude-sonnet-5-5',
        upstream: 'claude-sonnet-5-5-low',
        name: 'Claude Sonnet 5.5 (Low) — Antigravity subscription',
        description: 'Claude Sonnet 5.5 (Low) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-opus-5-5-high',
        family: 'claude-opus-5-5',
        upstream: 'claude-opus-5-5-high',
        name: 'Claude Opus 5.5 (High) — Antigravity subscription',
        description: 'Claude Opus 5.5 (High) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-opus-5-5-medium',
        family: 'claude-opus-5-5',
        upstream: 'claude-opus-5-5-medium',
        name: 'Claude Opus 5.5 (Medium) — Antigravity subscription',
        description: 'Claude Opus 5.5 (Medium) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'claude-opus-5-5-low',
        family: 'claude-opus-5-5',
        upstream: 'claude-opus-5-5-low',
        name: 'Claude Opus 5.5 (Low) — Antigravity subscription',
        description: 'Claude Opus 5.5 (Low) via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 1000000,
        maxOutput: 128000,
        thinkingBudget: -1,
        inputModalities: ['text', 'image'],
    },
    {
        id: 'gpt-oss-120b-medium',
        family: 'gpt-oss-120b',
        upstream: 'gpt-oss-120b-medium',
        name: 'GPT-OSS 120B (Medium) — Antigravity subscription',
        description: 'GPT-OSS 120B via Antigravity subscription (draws on the Claude/GPT quota bucket).',
        contextWindow: 131072,
        maxOutput: 65536,
        thinkingBudget: -1,
        inputModalities: ['text'],
    },
]

const BY_ID = new Map(MODELS.map((model) => [model.id, model]))

/** Resolve a requested model id to its catalog entry. */
export function resolveModel(requested) {
    if (requested === undefined || requested === null || requested === '') return MODELS[0]
    if (typeof requested !== 'string') return undefined
    const direct = BY_ID.get(requested)
    if (direct) return direct
    if (requested === FLASH || requested === 'gemini-3.8-flash') return MODELS[0]
    if (requested.startsWith('gemini-3.8-flash')) {
        if (requested.includes('low')) return BY_ID.get('gemini-3.8-flash-low')
        if (requested.includes('medium')) return BY_ID.get('gemini-3.8-flash-medium')
        return MODELS[0]
    }
    if (requested.includes('claude-sonnet')) {
        if (requested.includes('low')) return BY_ID.get('claude-sonnet-5-5-low')
        if (requested.includes('medium')) return BY_ID.get('claude-sonnet-5-5-medium')
        return BY_ID.get('claude-sonnet-5-5-high')
    }
    if (requested.includes('claude-opus')) {
        if (requested.includes('low')) return BY_ID.get('claude-opus-5-5-low')
        if (requested.includes('medium')) return BY_ID.get('claude-opus-5-5-medium')
        return BY_ID.get('claude-opus-5-5-high')
    }
    if (requested.includes('gpt-oss')) return BY_ID.get('gpt-oss-120b-medium')
    if (requested.includes('argon') || requested.includes('pro')) return MODELS[0]
    return undefined
}

/** Resolve the concrete model ID for a family + effort combination. */
export function modelIdForFamilyAndEffort(family, effort) {
    const cleanEffort = effort === 'max' || effort === 'xhigh' ? 'high' : effort === 'low' || effort === 'medium' ? effort : 'high'
    if (family === 'claude-sonnet-5-5') return `claude-sonnet-5-5-${cleanEffort}`
    if (family === 'claude-opus-5-5') return `claude-opus-5-5-${cleanEffort}`
    if (family === 'gpt-oss-120b') return 'gpt-oss-120b-medium'
    return `gemini-3.8-flash-${cleanEffort}`
}

/** Infer the family ID from a concrete model ID. */
export function familyOfModel(modelId) {
    const m = resolveModel(modelId)
    return m?.family ?? 'gemini-3.8-flash'
}

/** Map a reasoning effort identifier to a Gemini thinkingTokenBudget. */
export function budgetForEffort(effort, fallback) {
    if (fallback < 0) return -1
    switch (typeof effort === 'string' ? effort.toLowerCase() : '') {
        case 'none':
        case 'off':
        case 'minimal':
        case 'low':
            return 0
        case 'medium':
            return 4096
        case 'high':
            return 24576
        case 'xhigh':
        case 'max':
            return 32768
        default:
            return fallback
    }
}
