/**
 * dsh-subagent-antigravity
 *
 * Unifies the Antigravity (Google AI Pro) subscription into a self-contained,
 * toggleable DSH plugin for `subagent_fork` (and `subagent`) delegation:
 *
 *   1. Direct `AntigravityLlmAdapter` registered on `ctx.llm` (when `antigravity`
 *      is not already owned by `llm-pi-ai`), plus the loopback OpenAI-compatible
 *      proxy on `127.0.0.1:8791` for `llm-pi-ai` compatibility.
 *   2. Automatic `subagent_fork` / `subagent` route pinning by wrapping
 *      `ctx.subagents.startActivation`, so child sessions always run on the
 *      subscription (`antigravity/gemini-3.8-flash-high` or the user's chosen
 *      setting & effort level) as real native DSH sessions (with header tabs,
 *      live streaming output, full tool access, `send_message` continuation,
 *      and exact token accounting).
 *   3. Fast ~200ms zero-PTY HTTPS plan usage (`antigravity_usage` tool and
 *      `GET /api/dsh-antigravity/usage` endpoint) + runtime settings API
 *      (`GET|POST /api/dsh-antigravity/settings`) for the right-side UI panel.
 *   4. Runtime registration of the `/subagent` skill on `ctx.skills`.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AntigravityLlmAdapter } from './adapter.js'
import { startLoopbackProxy } from './proxy.js'
import { readUsage, formatUsage } from './usage.js'
import {
    MODELS,
    MODEL_FAMILIES,
    EFFORT_LEVELS,
    resolveModel,
    modelIdForFamilyAndEffort,
    familyOfModel,
} from './models.js'
import { log } from './agy.js'

export const name = 'subagent-antigravity'
export const inject = ['tools', 'subagents', 'llm']

const SETTINGS_FILE = join(homedir(), '.dsh', 'antigravity', 'settings.json')
const VALID_EFFORTS = new Set(EFFORT_LEVELS.map((e) => e.id))
const VALID_FAMILIES = new Set(MODEL_FAMILIES.map((f) => f.id))

export const Config = z.object({
    provider: z.string().default('antigravity').description('LLM provider route id used by delegated child sessions.'),
    model: z
        .union(MODELS.map((m) => m.id))
        .default('gemini-3.8-flash-high')
        .description('Default Antigravity subscription model for delegated subagent_fork children.'),
    effort: z
        .union(EFFORT_LEVELS.map((e) => e.id))
        .default('high')
        .description('Default reasoning effort level for delegated subagent_fork children.'),
    pinSubagentFork: z
        .boolean()
        .default(true)
        .description('Automatically route subagent_fork (and spawn) children to the Antigravity subscription.'),
    port: z
        .number()
        .step(1)
        .min(0)
        .max(65535)
        .default(8791)
        .description('Loopback port for the OpenAI-compatible endpoint (0 disables the loopback listener).'),
    usageTtlMs: z
        .number()
        .step(1)
        .min(10000)
        .default(300000)
        .description('Cache TTL in milliseconds for Antigravity quota checks.'),
})

function loadPersistedSettings(defaults) {
    const base = {
        family: familyOfModel(defaults.model),
        model: defaults.model,
        effort: defaults.effort,
        pinSubagentFork: defaults.pinSubagentFork,
        overrideSubagent: true,
    }
    try {
        const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
        if (raw && typeof raw === 'object') {
            const effort = VALID_EFFORTS.has(raw.effort) ? raw.effort : base.effort
            const family = VALID_FAMILIES.has(raw.family)
                ? raw.family
                : raw.model
                  ? familyOfModel(raw.model)
                  : base.family
            const model =
                raw.model && resolveModel(raw.model)
                    ? modelIdForFamilyAndEffort(family, effort)
                    : modelIdForFamilyAndEffort(family, effort)
            return {
                family,
                model,
                effort,
                pinSubagentFork: typeof raw.pinSubagentFork === 'boolean' ? raw.pinSubagentFork : base.pinSubagentFork,
                overrideSubagent: typeof raw.overrideSubagent === 'boolean' ? raw.overrideSubagent : true,
            }
        }
    } catch {
        /* use defaults */
    }
    return base
}

function savePersistedSettings(settings) {
    let tmp = null
    try {
        mkdirSync(join(SETTINGS_FILE, '..'), { recursive: true })
        tmp = `${SETTINGS_FILE}.${randomUUID().slice(0, 8)}.tmp`
        const payload = JSON.stringify(settings, null, 2)
        writeFileSync(tmp, payload, 'utf8')
        try {
            renameSync(tmp, SETTINGS_FILE)
            tmp = null
        } catch {
            writeFileSync(SETTINGS_FILE, payload, 'utf8')
        }
    } catch {
        /* ignore */
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

function readJsonBody(req, maxBytes = 16384) {
    return new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (c) => {
            size += c.length
            if (size > maxBytes) {
                reject(new Error('request body too large'))
                req.destroy()
            } else {
                chunks.push(c)
            }
        })
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8')
                resolve(text ? JSON.parse(text) : {})
            } catch (err) {
                reject(new Error(`invalid JSON: ${err.message}`))
            }
        })
        req.on('error', reject)
    })
}

const SUBAGENT_SKILL_CONTENT = `# /subagent

The user says \`/subagent\` to mean: *"you decide whether and where to delegate — feel free to use the Antigravity subagents."* Treat it as standing permission for the rest of the task, not a single call. Decide the split yourself; do not ask which parts to delegate unless the goal itself is ambiguous.

## The tools

- \`subagent_fork(description, prompt, cwd?)\` — **a native DSH child session with full tool access, running on the Google AI Pro (Antigravity) subscription**. It is seeded with this conversation's completed turns and can run all session tools (read/write files, shell commands, grep, glob, web search, etc.). Because it is a real DSH session it opens as a **tab**, streams live output, accepts follow-ups via \`send_message\`, and carries its own **token meter**.
- \`send_message(agent_id, message)\` — **continue or steer a \`subagent_fork\` child**. Children report back via \`send_message\`, and you can send follow-up instructions to a child in any status (running or idle).
- \`list_agents(scope?)\` / \`interrupt_agent(agent_id)\` — inspect or stop active children.
- \`antigravity_usage(refresh?)\` — **plan quota check (~200ms over HTTPS)**: reports 5-hour and weekly quota remaining for Gemini Flash/Pro (the \`gemini-3.8-flash\` bucket) and Claude/GPT-OSS.

\`subagent_fork\` publishes immediately as a background child and settles later (do not sleep or busy-poll for it; you are notified automatically when it sends a message or finishes). Start independent \`subagent_fork\` calls together in one assistant message and continue useful work while they run.

## Hard rule: never spend the paid API on delegation

The point of this skill is that children run on the **Antigravity subscription**, at no API cost.

- **Use \`subagent_fork\`** — its children are automatically routed to \`antigravity/gemini-3.8-flash-high\` (or \`claude-sonnet-5-5-high\` / \`claude-opus-5-5-high\`).
- **Never** fall back to a paid API model when delegating.
- A single focused answer is cheaper than a child. Do not delegate trivial single-file questions just to "be thorough".

## Budget & Fan-out

\`subagent_fork\` runs over the direct Antigravity Cloud Code Assist HTTPS stream with zero PTY memory overhead and a host cap of \`maxActiveSubagents: 12\`. Fan out 2–8 tight, well-scoped \`subagent_fork\` children in parallel in a single assistant turn when work splits cleanly across subsystems, lenses, or hypotheses.

## How to brief \`subagent_fork\` (Context & Token Hygiene)

1. **Brief with delta only**: \`subagent_fork\` already sees this conversation's completed turns (but not the in-flight one), so state **only what is new** — the specific task, the files/scope it owns, whether it may edit files or is read-only, and how you want its answer shaped.
2. **Mandate parallel tool-call batching inside every child**: Instruct every child: *"You MUST batch multiple tool calls (\`read\`, \`grep\`, \`glob\`) into a single turn whenever inspecting multiple files or directories. Never execute sequential single-file reads across separate turns when they can be emitted in parallel in one response."* Cutting a child from 30 sequential turns to 5–6 batched turns reduces input token amplification and wall-clock time by ~5x.
3. **Avoid double-delivery into the parent context**: When a \`subagent_fork\` child finishes its turn, DSH automatically delivers its **final assistant reply** to the parent as a settlement notice. Tell children to return their report as their **final assistant reply** (NOT via \`send_message\` unless sending a brief mid-task progress ping), otherwise the full report is injected into the parent context twice!
4. **Cap report length**: Instruct every child to keep its closing report concise (e.g. **≤ 400–600 words** or a compact table of file:line findings + minimal diffs) and to save any long raw dumps to a file if needed. Four children returning 3,000-word essays twice will add ~40k tokens to the parent context in a single turn.
5. **Keep parent context under ~180k before forking**: If the parent session has grown past ~180k tokens, compact the parent before fanning out \`subagent_fork\` children so the parent and all Flash children share the same compacted prefix rather than each child hitting its 204.8k compaction threshold independently on Turn 1.`

function registerUsageTool(ctx, config) {
    const usageTool = defineTool({
        name: 'antigravity_usage',
        description:
            'Report Antigravity plan quota remaining (5h and weekly windows for Gemini Flash/Pro and Claude/GPT-OSS; cached 5 min, fetched directly over HTTPS in ~200ms).',
        isConcurrencySafe: true,
        parameters: {
            refresh: { type: 'boolean', description: 'Bypass 5-minute cache.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    ok: { type: 'boolean', required: true },
                    usage: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: String(value.usage ?? 'usage unavailable') }],
        },
        async execute(args) {
            const record = await readUsage({
                force: args?.refresh === true,
                ttlMs: Number.isFinite(config.usageTtlMs) ? config.usageTtlMs : undefined,
            })
            return { ok: true, usage: formatUsage(record, { verbose: true }) }
        },
    })

    ctx.effect(() => ctx.tools.register(usageTool), 'antigravity: usage tool')
}

export function apply(ctx, config = {}) {
    const routeProvider = config.provider || 'antigravity'
    const defaultModel = config.model || 'gemini-3.8-flash-high'
    const defaultEffort = config.effort || 'high'
    const defaultPinFork = config.pinSubagentFork !== false
    const port = Number.isFinite(config.port) ? config.port : 8791

    let runtimeSettings = loadPersistedSettings({
        model: defaultModel,
        effort: defaultEffort,
        pinSubagentFork: defaultPinFork,
    })

    const getSettings = () => runtimeSettings

    const updateSettings = (patch = {}) => {
        const nextEffort = VALID_EFFORTS.has(patch.effort) ? patch.effort : runtimeSettings.effort
        let nextFamily = runtimeSettings.family
        if (VALID_FAMILIES.has(patch.family)) {
            nextFamily = patch.family
        } else if (typeof patch.model === 'string' && resolveModel(patch.model)) {
            nextFamily = familyOfModel(patch.model)
        }
        const nextModel = modelIdForFamilyAndEffort(nextFamily, nextEffort)
        const nextPin = typeof patch.pinSubagentFork === 'boolean' ? patch.pinSubagentFork : runtimeSettings.pinSubagentFork
        const nextOverride =
            typeof patch.overrideSubagent === 'boolean' ? patch.overrideSubagent : runtimeSettings.overrideSubagent

        runtimeSettings = {
            family: nextFamily,
            model: nextModel,
            effort: nextEffort,
            pinSubagentFork: nextPin,
            overrideSubagent: nextOverride,
        }
        savePersistedSettings(runtimeSettings)
        log(
            `settings updated: family=${runtimeSettings.family} model=${runtimeSettings.model} effort=${runtimeSettings.effort} pinFork=${runtimeSettings.pinSubagentFork}`,
        )
        return runtimeSettings
    }

    log(
        `apply provider=${routeProvider} model=${runtimeSettings.model} effort=${runtimeSettings.effort} pinFork=${runtimeSettings.pinSubagentFork} port=${port}`,
    )

    // 1. Register the direct in-process LlmAdapter on `ctx.llm` unless another
    //    adapter (such as a user-configured llm-pi-ai entry) already owns the route.
    ctx.effect(() => {
        const existing = ctx.llm.listProviders().some((p) => p.id === routeProvider)
        if (existing) {
            log(`provider "${routeProvider}" already owned on ctx.llm; using loopback proxy on port ${port}`)
            return () => {}
        }
        try {
            const adapter = new AntigravityLlmAdapter(ctx, getSettings)
            const disposeAdapter = ctx.llm.registerAdapter([routeProvider], adapter)
            log(`registered direct AntigravityLlmAdapter for route "${routeProvider}"`)
            return () => {
                try {
                    disposeAdapter()
                } catch {
                    /* ignore */
                }
            }
        } catch (error) {
            log(`direct adapter registration skipped (${error?.message ?? error})`)
            return () => {}
        }
    }, 'antigravity: llm adapter')

    // 2. Start the loopback OpenAI-compatible HTTP proxy (127.0.0.1:8791) so
    //    `llm-pi-ai` routes and external callers continue to work.
    if (port > 0) {
        ctx.effect(() => startLoopbackProxy(port, getSettings), 'antigravity: loopback proxy')
    }

    // 3. Pin `subagent_fork` (and `spawn`) activations to the Antigravity route
    //    automatically, honoring the live UI panel settings (model & effort).
    ctx.effect(() => {
        const subagents = ctx.subagents
        const originalStartActivation = subagents.startActivation.bind(subagents)
        const wrappedStartActivation = async function (spec) {
            const currentSettings = getSettings()
            if (
                currentSettings.pinSubagentFork &&
                spec &&
                (spec.provider === 'fork' || spec.provider === 'spawn') &&
                spec.request
            ) {
                const currentOpts = spec.request.agentOptions ?? {}
                const chosenModel = currentSettings.overrideSubagent
                    ? currentSettings.model
                    : resolveModel(currentOpts.model)
                      ? currentOpts.model
                      : currentSettings.model
                const chosenEffort = currentSettings.overrideSubagent
                    ? currentSettings.effort
                    : (currentOpts.reasoningEffort ?? currentSettings.effort)
                spec = {
                    ...spec,
                    request: {
                        ...spec.request,
                        agentOptions: {
                            ...currentOpts,
                            provider: routeProvider,
                            model: chosenModel,
                            reasoningEffort: chosenEffort,
                        },
                    },
                }
            }
            return originalStartActivation(spec)
        }
        subagents.startActivation = wrappedStartActivation
        return () => {
            if (subagents.startActivation === wrappedStartActivation) {
                subagents.startActivation = originalStartActivation
            }
        }
    }, 'antigravity: pin subagent_fork route')

    // 4. Register the fast HTTPS `antigravity_usage` tool.
    registerUsageTool(ctx, config)

    // 5. Register the `/subagent` skill on `ctx.skills` when available.
    ctx.inject(['skills'], (scope) => {
        scope.effect(() => {
            try {
                return scope.skills.register({
                    name: 'subagent',
                    description:
                        'Use when the user types /subagent, or when a task splits into independent pieces that can run at once, needs breadth (many files, many hypotheses, many drafts), or wants a second opinion from another model. Fans work out to gemini-3.8-flash children on the Antigravity subscription via subagent_fork (native DSH session with full tool access, sees this conversation, tab + live output + token meter).',
                    source: 'plugin:dsh-subagent-antigravity',
                    content: SUBAGENT_SKILL_CONTENT,
                })
            } catch {
                /* skill already registered */
                return () => {}
            }
        }, 'antigravity: subagent skill')
    })

    // 6. Mount `/api/dsh-antigravity/{usage,settings}` on `webServer` for the right-side UI panel.
    const apiRoute = {
        name: 'antigravity-api-route',
        inject: ['webServer'],
        apply(scope) {
            scope.effect(
                () =>
                    scope.webServer.register({
                        kind: 'prefix',
                        path: '/api/dsh-antigravity',
                        handler: async (req, res) => {
                            const url = new URL(req.url ?? '/', 'http://dsh.local')
                            const send = (status, body) => {
                                if (res.destroyed || res.writableEnded) return
                                res.writeHead(status, {
                                    'content-type': 'application/json; charset=utf-8',
                                    'cache-control': 'no-store',
                                })
                                res.end(JSON.stringify(body))
                            }

                            if (url.pathname.endsWith('/settings')) {
                                if (req.method === 'GET') {
                                    return send(200, {
                                        ok: true,
                                        settings: getSettings(),
                                        families: MODEL_FAMILIES,
                                        efforts: EFFORT_LEVELS,
                                        models: MODELS,
                                    })
                                }
                                if (req.method === 'POST') {
                                    try {
                                        const body = await readJsonBody(req)
                                        const updated = updateSettings(body)
                                        return send(200, {
                                            ok: true,
                                            settings: updated,
                                            families: MODEL_FAMILIES,
                                            efforts: EFFORT_LEVELS,
                                            models: MODELS,
                                        })
                                    } catch (error) {
                                        return send(400, { ok: false, error: String(error?.message ?? error) })
                                    }
                                }
                                return send(405, { ok: false, error: 'method not allowed' })
                            }

                            if (!url.pathname.endsWith('/usage')) {
                                return send(404, { ok: false, error: 'unknown route' })
                            }
                            try {
                                const record = await readUsage({
                                    force: url.searchParams.get('force') === '1',
                                    ttlMs: Number.isFinite(config.usageTtlMs) ? config.usageTtlMs : undefined,
                                })
                                send(200, {
                                    ok: true,
                                    capturedAt: record.capturedAt,
                                    ageMs: record.ageMs,
                                    stale: record.stale,
                                    groups: record.groups,
                                    settings: getSettings(),
                                    families: MODEL_FAMILIES,
                                    efforts: EFFORT_LEVELS,
                                    text: formatUsage(record),
                                })
                            } catch (error) {
                                send(500, { ok: false, error: String(error?.message ?? error) })
                            }
                        },
                    }),
                'antigravity: api route',
            )
        },
    }
    if (typeof ctx.plugin === 'function') ctx.plugin(apiRoute)
}
