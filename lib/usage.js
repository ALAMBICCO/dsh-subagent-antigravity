/**
 * Fast, zero-PTY Antigravity quota reader.
 *
 * Queries Cloud Code Assist (`v1internal:fetchAvailableModels` and
 * `v1internal:retrieveUserQuotaSummary`) over HTTPS in ~200ms using the
 * stored OAuth token in `~/.gemini/antigravity-cli/antigravity-oauth-token`.
 * Never spawns `agy.exe` or `node-pty`.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { postInternal } from './agy.js'

const CACHE_FILE = join(homedir(), '.dsh', 'antigravity', 'usage.json')
const DEFAULT_TTL_MS = 5 * 60_000

let memoryCache = null
let inflightUsage = null

/** Convert an ISO reset timestamp to a compact relative duration ("4h 23m" or "available"). */
function formatResetsIn(isoString) {
    if (!isoString) return 'available'
    const diffMs = new Date(isoString).getTime() - Date.now()
    if (!Number.isFinite(diffMs) || diffMs <= 0) return 'available'
    const totalMins = Math.max(1, Math.round(diffMs / 60000))
    const hours = Math.floor(totalMins / 60)
    const mins = totalMins % 60
    return hours > 0 ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`) : `${mins}m`
}

/** Fetch live quota numbers directly from Cloud Code Assist over HTTPS (~200ms). */
export async function captureUsage() {
    const [fam, quotaSummary] = await Promise.all([
        postInternal('v1internal:fetchAvailableModels', {}),
        postInternal('v1internal:retrieveUserQuotaSummary', {}).catch(() => null),
    ])

    const models = fam?.models ?? {}
    const geminiQuota =
        models['gemini-3.8-flash-tiered']?.quotaInfo ??
        models['gemini-3-flash']?.quotaInfo ??
        models['gemini-2.5-pro']?.quotaInfo ??
        Object.values(models).find((m) => m?.modelProvider === 'MODEL_PROVIDER_GOOGLE' && m?.quotaInfo?.remainingFraction !== undefined)?.quotaInfo

    const claudeModelQuota =
        models['claude-sonnet-5-5-high']?.quotaInfo ??
        models['claude-opus-5-5-high']?.quotaInfo ??
        models['gpt-oss-120b-medium']?.quotaInfo

    const summaryGroups = Array.isArray(quotaSummary?.groups) ? quotaSummary.groups : []
    const geminiSummaryGroup = summaryGroups.find((g) => /(gemini|google)/i.test(g.displayName ?? '') && !/argon/i.test(g.displayName ?? ''))
    const claudeSummaryGroup = summaryGroups.find((g) => /(claude|gpt|anthropic)/i.test(g.displayName ?? ''))

    const extractBucket = (group, kind) => {
        if (!group || !Array.isArray(group.buckets)) return undefined
        const hit = group.buckets.find((b) =>
            kind === 'weekly'
                ? b.window === 'weekly' || /weekly/i.test(b.displayName ?? '') || /weekly/i.test(b.bucketId ?? '')
                : b.window === '5h' || /5h|five hour/i.test(b.displayName ?? '') || /5h/i.test(b.bucketId ?? ''),
        )
        if (!hit || typeof hit.remainingFraction !== 'number') return undefined
        return {
            remaining: Number((hit.remainingFraction * 100).toFixed(2)),
            resetsIn: formatResetsIn(hit.resetTime),
            ...(hit.resetTime ? { resetTime: hit.resetTime } : {}),
        }
    }

    const geminiFiveHour =
        extractBucket(geminiSummaryGroup, '5h') ??
        (geminiQuota && typeof geminiQuota.remainingFraction === 'number'
            ? {
                  remaining: Number((geminiQuota.remainingFraction * 100).toFixed(2)),
                  resetsIn: formatResetsIn(geminiQuota.resetTime),
                  ...(geminiQuota.resetTime ? { resetTime: geminiQuota.resetTime } : {}),
              }
            : undefined)
    const geminiWeekly = extractBucket(geminiSummaryGroup, 'weekly')

    const claudeFiveHour =
        extractBucket(claudeSummaryGroup, '5h') ??
        (claudeModelQuota && typeof claudeModelQuota.remainingFraction === 'number'
            ? {
                  remaining: Number((claudeModelQuota.remainingFraction * 100).toFixed(2)),
                  resetsIn: formatResetsIn(claudeModelQuota.resetTime),
                  ...(claudeModelQuota.resetTime ? { resetTime: claudeModelQuota.resetTime } : {}),
              }
            : undefined)
    const claudeWeekly = extractBucket(claudeSummaryGroup, 'weekly')

    if (!geminiFiveHour && !claudeFiveHour) {
        throw new Error('Cloud Code Assist returned no quota information')
    }

    return {
        gemini: {
            label: 'Gemini Flash, Pro',
            ...(geminiWeekly ? { weekly: geminiWeekly } : {}),
            ...(geminiFiveHour ? { fiveHour: geminiFiveHour } : {}),
        },
        claude: {
            label: 'Claude, GPT-OSS',
            ...(claudeWeekly ? { weekly: claudeWeekly } : {}),
            ...(claudeFiveHour ? { fiveHour: claudeFiveHour } : {}),
        },
    }
}

/** Cached read: fresh within `ttlMs` (in-memory first, then disk), else capture over HTTPS. */
export async function readUsage({ ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
    if (!force && memoryCache?.groups && Date.now() - memoryCache.capturedAt < ttlMs) {
        const age = Date.now() - memoryCache.capturedAt
        return { ...memoryCache, stale: false, ageMs: age }
    }

    let cached = memoryCache
    if (!cached) {
        try {
            cached = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
            if (cached?.groups && cached.capturedAt) memoryCache = cached
        } catch {
            cached = undefined
        }
    }

    const age = cached?.capturedAt ? Date.now() - cached.capturedAt : Number.POSITIVE_INFINITY
    if (!force && cached?.groups && age < ttlMs) return { ...cached, stale: false, ageMs: age }

    if (!inflightUsage) {
        inflightUsage = (async () => {
            const groups = await captureUsage()
            const record = { capturedAt: Date.now(), groups }
            memoryCache = record
            let tmp = null
            try {
                mkdirSync(join(CACHE_FILE, '..'), { recursive: true })
                tmp = `${CACHE_FILE}.${randomUUID().slice(0, 8)}.tmp`
                const payload = JSON.stringify(record, null, 2)
                writeFileSync(tmp, payload, 'utf8')
                try {
                    renameSync(tmp, CACHE_FILE)
                    tmp = null
                } catch {
                    writeFileSync(CACHE_FILE, payload, 'utf8')
                }
            } catch {
                /* cache write is optional */
            } finally {
                if (tmp) {
                    try {
                        unlinkSync(tmp)
                    } catch {
                        /* ignore */
                    }
                }
            }
            return { ...record, stale: false, ageMs: 0 }
        })().finally(() => {
            inflightUsage = null
        })
    }

    try {
        return await inflightUsage
    } catch (error) {
        if (cached?.groups) return { ...cached, stale: true, ageMs: age, error: String(error?.message ?? error) }
        throw error
    }
}

const remaining = (entry) => (entry && typeof entry.remaining === 'number' ? `${entry.remaining.toFixed(2)}% left` : 'n/a')
const resets = (entry) => (entry?.resetsIn && entry.resetsIn !== 'available' ? `, resets in ${entry.resetsIn}` : '')

/** One compact line for the model, or the full breakdown for a human. */
export function formatUsage(record, { verbose = false } = {}) {
    const groups = record?.groups ?? {}
    const capturedAt = typeof record?.capturedAt === 'number' ? record.capturedAt : Date.now()
    const line = (label, group) => {
        if (!group) return `${label}: n/a`
        const parts = []
        if (group.fiveHour) parts.push(`5-hour ${remaining(group.fiveHour)}${resets(group.fiveHour)}`)
        if (group.weekly) parts.push(`weekly ${remaining(group.weekly)}${resets(group.weekly)}`)
        return parts.length > 0 ? `${label}: ${parts.join('; ')}` : `${label}: n/a`
    }
    const parts = [
        line('Gemini Flash/Pro (the 3.8-flash bucket subagents draw on)', groups.gemini),
        line('Claude/GPT-OSS', groups.claude),
    ]
    const age = Math.max(0, Math.round((Date.now() - capturedAt) / 1000))
    if (!verbose) return `${parts.join('. ')}. (captured ${age}s ago${record?.stale ? ', stale' : ''})`
    return ['Antigravity plan usage (Google AI Pro)', ...parts.map((p) => `- ${p}`), `captured ${age}s ago`].join('\n')
}
