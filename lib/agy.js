/**
 * Subscription credentials and Cloud Code Assist HTTPS client.
 *
 * Reads `~/.gemini/antigravity-cli/antigravity-oauth-token` and refreshes the
 * OAuth access token in memory when within 5 minutes of expiry using the
 * verified OAuth client credentials from `agy.exe`.
 */

import { readFileSync, writeFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'

export const CLI_CONFIG_DIR = join(homedir(), '.gemini', 'antigravity-cli')
export const TOKEN_FILE = join(CLI_CONFIG_DIR, 'antigravity-oauth-token')
export const LOG_DIR = join(homedir(), '.dsh', 'antigravity')
export const LOG_FILE = join(LOG_DIR, 'proxy.log')

/** Public desktop OAuth client pair from `agy.exe` that refreshes the consumer token. */
const OAUTH_CLIENT_ID = ['1071006060591', 'tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'].join('-')
const OAUTH_CLIENT_SECRET = ['GOCSPX', 'K58FWR486LdLJ1mLB8sXC4z6qDAf'].join('-')

export const API_BASE = 'https://daily-cloudcode-pa.googleapis.com'
export const USER_AGENT = 'antigravity-cli/1.4.7'

const REFRESH_SKEW_MS = 5 * 60 * 1000
const MAX_LOG_BYTES = 2 * 1024 * 1024
let logReady = false

/**
 * Compact diagnostic log (`~/.dsh/antigravity/proxy.log`).
 * Never logs prompt contents or credentials.
 */
export function log(line) {
    try {
        if (!logReady) {
            mkdirSync(LOG_DIR, { recursive: true })
            logReady = true
        }
        try {
            if (statSync(LOG_FILE).size > MAX_LOG_BYTES) {
                writeFileSync(LOG_FILE, '')
            }
        } catch {
            /* first write */
        }
        appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
    } catch {
        /* logging must never break a request */
    }
}

/** @type {{ accessToken: string, refreshToken?: string, expiresAt: number, mtimeMs?: number, checkedAt?: number, refreshedAt?: number } | undefined} */
let cached
let inflight

const syncSleepBuffer = new Int32Array(new SharedArrayBuffer(4))
function syncSleep(ms) {
    try {
        Atomics.wait(syncSleepBuffer, 0, 0, ms)
    } catch {
        /* ignore if Atomics.wait is restricted */
    }
}

function readTokenFile(retries = 2) {
    for (let i = 0; i <= retries; i += 1) {
        try {
            const mtimeMs = statSync(TOKEN_FILE).mtimeMs
            const raw = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'))
            const t = raw.token ?? {}
            if (!t.access_token || !t.refresh_token) {
                throw new Error(`${TOKEN_FILE} has no access_token/refresh_token`)
            }
            const parsedExpiry = t.expiry ? Date.parse(t.expiry) : Number.NaN
            const expiresAt = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + (t.expires_in ?? 3599) * 1000
            return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt, mtimeMs }
        } catch (err) {
            if (i === retries) throw err
            syncSleep(40 * (i + 1))
        }
    }
}

async function refreshWith(refreshToken) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            ...attributionHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: OAUTH_CLIENT_ID,
            client_secret: OAUTH_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    if (!res.ok) {
        throw new Error(`token refresh failed: HTTP ${res.status} ${text.slice(0, 300)}`)
    }
    const json = JSON.parse(text)
    if (!json.access_token) throw new Error(`token refresh returned no access_token: ${text.slice(0, 200)}`)
    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt: Date.now() + (json.expires_in ?? 3599) * 1000,
    }
}

/**
 * Obtain a valid OAuth access token, refreshing in memory when within 5 minutes
 * of expiry. Concurrent callers share a single refresh flight.
 */
export async function accessToken({ force = false } = {}) {
    const now = Date.now()
    // Prevent refresh stampedes when multiple parallel subagent_fork turns hit 401 simultaneously
    if (force && cached?.refreshedAt && now - cached.refreshedAt < 5_000) {
        return cached.accessToken
    }
    if (inflight) {
        const fresh = await inflight
        return fresh.accessToken
    }
    if (!force && cached && cached.expiresAt - REFRESH_SKEW_MS > now && now - (cached.checkedAt ?? 0) < 10_000) {
        return cached.accessToken
    }
    let diskMtime = 0
    try {
        diskMtime = statSync(TOKEN_FILE).mtimeMs
    } catch {
        /* ignore stat failure */
    }
    if (!force && cached && cached.expiresAt - REFRESH_SKEW_MS > now && (!diskMtime || diskMtime <= (cached.mtimeMs ?? 0))) {
        cached.checkedAt = now
        return cached.accessToken
    }

    let fromDisk
    try {
        fromDisk = readTokenFile()
    } catch (error) {
        if (cached && !force) return cached.accessToken
        throw error
    }

    if (!force && fromDisk.expiresAt - REFRESH_SKEW_MS > Date.now()) {
        cached = {
            accessToken: fromDisk.accessToken,
            refreshToken: fromDisk.refreshToken,
            expiresAt: fromDisk.expiresAt,
            mtimeMs: fromDisk.mtimeMs,
            checkedAt: Date.now(),
        }
        return cached.accessToken
    }

    if (!inflight) {
        const refreshToken = cached?.refreshToken ?? fromDisk.refreshToken
        inflight = (async () => {
            const fresh = await refreshWith(refreshToken)
            const nowMs = Date.now()
            cached = { ...fresh, mtimeMs: fromDisk.mtimeMs, checkedAt: nowMs, refreshedAt: nowMs }
            log(`token refreshed, valid for ${Math.round((fresh.expiresAt - nowMs) / 1000)}s`)
            return cached
        })().finally(() => {
            inflight = undefined
        })
    }
    const fresh = await inflight
    return fresh.accessToken
}

/** Drop the cached token so the next call re-reads and refreshes. */
export function invalidateToken() {
    cached = undefined
}

async function drainBody(res) {
    try {
        await res.body?.cancel?.()
    } catch {
        /* ignore */
    }
}

/**
 * Open the upstream SSE stream for a prepared Cloud Code Assist Gemini request body.
 */
export async function openStream(request, { model, project, signal }) {
    const body = JSON.stringify({ model, project, request })
    const attempt = async (force) => {
        const token = await accessToken({ force })
        return fetch(`${API_BASE}/v1internal:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: {
                ...attributionHeaders(),
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
                Accept: 'text/event-stream',
            },
            body,
            signal,
        })
    }

    let res = await attempt(false)
    if (res.status === 401) {
        await drainBody(res)
        log('upstream returned 401; forcing a token refresh and retrying once')
        res = await attempt(true)
    }
    return res
}

/**
 * Call a Cloud Code Assist JSON POST endpoint (e.g. `v1internal:fetchAvailableModels`).
 */
export async function postInternal(endpoint, payload = {}, { signal } = {}) {
    const body = JSON.stringify(payload)
    const attempt = async (force) => {
        const token = await accessToken({ force })
        return fetch(`${API_BASE}/${endpoint}`, {
            method: 'POST',
            headers: {
                ...attributionHeaders(),
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
            },
            body,
            signal: signal ?? AbortSignal.timeout(10000),
        })
    }

    let res = await attempt(false)
    if (res.status === 401) {
        await drainBody(res)
        res = await attempt(true)
    }
    if (!res.ok) {
        const failure = await describeFailure(res)
        throw new Error(`${endpoint} failed (${failure.status}): ${failure.message}`)
    }
    return res.json()
}

/** Extract a concise error summary from a failed upstream response. */
export async function describeFailure(res) {
    let text = ''
    try {
        text = await res.text()
    } catch {
        /* body already consumed */
    }
    let message = text.slice(0, 600)
    try {
        const json = JSON.parse(text)
        const err = json.error ?? json
        message = `${err.status ?? err.code ?? ''} ${err.message ?? ''}`.trim() || message
    } catch {
        /* keep raw head */
    }
    return { status: res.status, message }
}
