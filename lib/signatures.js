/**
 * Thought-signature store for Gemini 3.x function calling.
 *
 * Gemini 3.x attaches a cryptographic `thoughtSignature` to `functionCall` parts
 * and rejects follow-up turns without it (HTTP 400). This module caches
 * `call_id -> thoughtSignature` in memory and persists it to
 * `~/.dsh/antigravity/tool-signatures.json` so signatures survive DSH restarts.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const DIR = join(homedir(), '.dsh', 'antigravity')
const FILE = join(DIR, 'tool-signatures.json')

const MAX_ENTRIES = 600

/** @type {Map<string, { signature: string, name?: string }>} */
let cache
let loadedMtimeMs = 0
let saveTimer = null
let dirty = false

function pruneOldest(map) {
    while (map.size > MAX_ENTRIES) {
        const oldest = map.keys().next().value
        if (oldest === undefined) break
        map.delete(oldest)
    }
}

function mergeFromDisk(map) {
    try {
        const st = statSync(FILE)
        if (st.mtimeMs <= loadedMtimeMs) return
        loadedMtimeMs = st.mtimeMs
        const raw = JSON.parse(readFileSync(FILE, 'utf8'))
        const entries = Object.entries(raw ?? {})
        const start = Math.max(0, entries.length - MAX_ENTRIES)
        for (let i = start; i < entries.length; i += 1) {
            const [id, value] = entries[i]
            if (typeof value === 'string' && value && !map.has(id)) {
                map.set(id, { signature: value })
            }
        }
        pruneOldest(map)
    } catch {
        /* first run or unreadable */
    }
}

function load() {
    if (cache) return cache
    cache = new Map()
    mergeFromDisk(cache)
    return cache
}

function flushPersist() {
    if (saveTimer !== null) {
        clearTimeout(saveTimer)
        saveTimer = null
    }
    if (!dirty || !cache) return
    dirty = false
    let tmp = null
    try {
        mkdirSync(DIR, { recursive: true })
        const map = load()
        mergeFromDisk(map)
        pruneOldest(map)
        /** @type {Record<string, string>} */
        const flat = {}
        for (const [id, value] of map) flat[id] = value.signature
        const payload = JSON.stringify(flat)
        tmp = `${FILE}.${randomUUID().slice(0, 8)}.tmp`
        writeFileSync(tmp, payload, 'utf8')
        try {
            renameSync(tmp, FILE)
            tmp = null
        } catch {
            writeFileSync(FILE, payload, 'utf8')
        }
        try {
            loadedMtimeMs = statSync(FILE).mtimeMs
        } catch {
            /* ignore */
        }
    } catch {
        /* best-effort cache */
    } finally {
        if (tmp) {
            try {
                unlinkSync(tmp)
            } catch {
                /* ignore */
            }
        }
    }
}

function persist() {
    dirty = true
    if (saveTimer !== null) return
    saveTimer = setTimeout(flushPersist, 500)
    saveTimer.unref?.()
}

process.once('exit', flushPersist)

/** Remember the signature that belongs to one outgoing function call. */
export function rememberSignature(id, signature, name) {
    if (!id || typeof signature !== 'string' || !signature) return
    const map = load()
    map.delete(id)
    map.set(id, { signature, name })
    pruneOldest(map)
    persist()
}

/** The signature for a call id, or undefined when unknown. */
export function signatureFor(id) {
    if (!id) return undefined
    const map = load()
    const hit = map.get(id)?.signature
    if (hit) return hit
    mergeFromDisk(map)
    return map.get(id)?.signature
}

/** How many signatures are held in memory. */
export const signatureCount = () => load().size
