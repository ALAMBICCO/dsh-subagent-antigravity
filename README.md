# dsh-subagent-antigravity

Route native DeepSeek Harness **`subagent_fork`** child sessions onto your **Google AI Pro (Antigravity)** subscription (`daily-cloudcode-pa.googleapis.com`) with zero API billing, real-time token streaming, full DSH tool calling, ~200 ms HTTPS quota checks, and a vertically centered right-side UI panel for live usage, model setting, effort level, and `/subagent` toggling.

```
parent session (any model route — e.g. deepseek-flash or google-vertex)
  └── subagent_fork → native DSH child session (header tab, live output, token meter, send_message)
        └── AntigravityLlmAdapter / Loopback Proxy (provider: "antigravity", dynamic model & effort)
              └── daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
```

## Features

1. **Native `subagent_fork` Delegation (No TUI / No PTY):**
   - Automatically pins `subagent_fork` child sessions to `antigravity/<selected-model>` and `<selected-effort>` by wrapping `ctx.subagents.startActivation`.
   - Every delegated child is a **first-class DSH session**: it opens as a navigable tab, streams real SSE text and tool-call deltas as they arrive, supports `send_message` continuation and `interrupt_agent`, and reports exact `usageMetadata` to DSH's token meter.
   - Zero vendor preset tampering required: works out of the box with shipped `standard`, `cordis`, and `ptc` presets.

2. **Direct In-Process `LlmAdapter` + Loopback OpenAI Proxy:**
   - Registers `AntigravityLlmAdapter` directly on `ctx.llm` (`provider: "antigravity"`) so child sessions require zero `cordis.patch.yml` / `llm-pi-ai` boilerplate.
   - Also starts a loopback OpenAI-compatible proxy on `127.0.0.1:8791/v1` (`GET /v1/models`, `POST /v1/chat/completions`, `GET /health`) for compatibility with `llm-pi-ai` or external local tools.
   - Full bidirectional tool calling: converts JSON Schemas to Gemini's strict uppercase `Schema` subset (collapsing `anyOf`/`oneOf`/`allOf` and ensuring `ARRAY` items), pairs parallel `functionCall` / `functionResponse` turns (separating inline tool-result images into a follow-up user turn), caches and replays Gemini 3.x cryptographic `thoughtSignature` tokens in `~/.dsh/antigravity/tool-signatures.json` (bounded to 600 entries), and gracefully degrades foreign/unsigned parent history turns to readable text.

3. **Instant HTTPS Plan Usage (`~200 ms`, Zero PTY):**
   - Queries `v1internal:fetchAvailableModels` and `v1internal:retrieveUserQuotaSummary` directly over HTTPS using the CLI's OAuth token (`~/.gemini/antigravity-cli/antigravity-oauth-token`), refreshing tokens automatically in memory.
   - Exposed via the `antigravity_usage` model tool and `GET /api/dsh-antigravity/usage` (`?force=1` bypasses the 5-minute cache).

4. **Vertically Centered Right-Side UI Panel (`shell.overlay` + `conversation.input.right`):**
   - Renders a compact capsule vertically centered on the right edge of the DSH UI (`shell.overlay`), featuring:
     - **Simple Quota & `/subagent` Button:** Shows the remaining 5-hour quota percentage for the active setting (amber under 25%, red under 8%, solid blue when `/subagent` is armed). Click to toggle `/subagent ` in the active composer draft; Alt-click to force a live quota refresh.
     - **Slim Side Arrow:** Expands and collapses the floating settings popover panel.
   - **Expanded Settings & Usage Popover:**
     - **Setting (Model & Usage Left):** Choose between `Gemini 3.8 Flash`, `Claude Sonnet 5.5`, `Claude Opus 5.5`, and `GPT-OSS 120B`, each displaying its live remaining quota percentage, progress bar, and reset countdown.
     - **Effort Level:** Choose `Low` (0 budget), `Med` (4k), `High` (24k), or `Max` (32k) thinking token budget. Persisted to `~/.dsh/antigravity/settings.json` via `GET|POST /api/dsh-antigravity/settings` and applied immediately to new `subagent_fork` activations.
     - **Delegate with `/subagent` Toggle:** Synced with the active conversation composer via a headless bridge in `conversation.input.right`.

## Supported Models

| Model ID | Family | Upstream | Context Window | Max Output | Thinking Budget | Quota Bucket |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-3.8-flash-high` *(default)* | `gemini-3.8-flash` | `gemini-3.8-flash-tiered` | 1,048,576 | 65,536 | 24,576 | Gemini Flash/Pro |
| `gemini-3.8-flash-medium` | `gemini-3.8-flash` | `gemini-3.8-flash-tiered` | 1,048,576 | 65,536 | 4,096 | Gemini Flash/Pro |
| `gemini-3.8-flash-low` | `gemini-3.8-flash` | `gemini-3.8-flash-tiered` | 1,048,576 | 65,536 | 0 | Gemini Flash/Pro |
| `claude-sonnet-5-5-high` | `claude-sonnet-5-5` | `claude-sonnet-5-5-high` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `claude-sonnet-5-5-medium` | `claude-sonnet-5-5` | `claude-sonnet-5-5-medium` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `claude-sonnet-5-5-low` | `claude-sonnet-5-5` | `claude-sonnet-5-5-low` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `claude-opus-5-5-high` | `claude-opus-5-5` | `claude-opus-5-5-high` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `claude-opus-5-5-medium` | `claude-opus-5-5` | `claude-opus-5-5-medium` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `claude-opus-5-5-low` | `claude-opus-5-5` | `claude-opus-5-5-low` | 1,000,000 | 128,000 | adaptive | Claude / GPT-OSS |
| `gpt-oss-120b-medium` | `gpt-oss-120b` | `gpt-oss-120b-medium` | 131,072 | 65,536 | adaptive | Claude / GPT-OSS |
