window.__ModuleLoader__.load({
  id: "dsh-subagent-antigravity",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;

    const inject = ["slots"];
    const USAGE_ROUTE = "/api/dsh-antigravity/usage";
    const SETTINGS_ROUTE = "/api/dsh-antigravity/settings";
    const STYLE_ID = "dsh-agy-style";
    const SKILL_COMMAND = "/subagent";
    const REFRESH_MS = 5 * 60_000;
    const PANEL_WIDTH = 288;

    const DEFAULT_FAMILIES = [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", bucket: "gemini", bucketLabel: "Gemini Flash / Pro" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", bucket: "claude", bucketLabel: "Claude / GPT-OSS" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", bucket: "claude", bucketLabel: "Claude / GPT-OSS" },
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", bucket: "claude", bucketLabel: "Claude / GPT-OSS" },
    ];

    const DEFAULT_EFFORTS = [
      { id: "low", label: "Low", shortLabel: "Low", budget: 0 },
      { id: "medium", label: "Medium", shortLabel: "Med", budget: 4096 },
      { id: "high", label: "High", shortLabel: "High", budget: 24576 },
      { id: "max", label: "Max", shortLabel: "Max", budget: 32768 },
    ];

    const CSS = [
      // Inline inside the chat window's header (`conversation.session.header.utilities`)
      ".dsh-agy-dock{display:inline-flex;align-items:center;position:relative;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;user-select:none;-webkit-app-region:no-drag;margin-inline-end:4px}",
      // Fallback floating dock when the chat session header is hidden (e.g. blank New Chat hero view)
      ".dsh-agy-dock-floating{position:absolute;right:52px;top:12px;z-index:45;pointer-events:auto}",
      // Compact capsule holding the slim expand/collapse arrow on the side + the simple quota button
      ".dsh-agy-capsule{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(28,29,34,.92));border:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));box-shadow:0 2px 8px rgba(0,0,0,.16)}",
      // Slim arrow button to expand / collapse the settings panel (also supports drag-out / drag-in)
      ".dsh-agy-arrow{box-sizing:border-box;width:16px;height:24px;border:none;border-radius:999px 4px 4px 999px;background:transparent;color:var(--dsw-alias-label-secondary,#81858c);display:inline-flex;align-items:center;justify-content:center;padding:0;margin:0;cursor:grab;touch-action:none;transition:background-color .12s,color .12s}",
      ".dsh-agy-arrow:active{cursor:grabbing}",
      ".dsh-agy-arrow:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.22));color:var(--dsw-alias-label-primary,#fff)}",
      ".dsh-agy-arrow.dsh-agy-open{color:var(--dsw-alias-label-primary,#fff);background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.18))}",
      ".dsh-agy-arrow svg{width:10px;height:10px;transition:transform .22s cubic-bezier(.22,1,.36,1)}",
      ".dsh-agy-arrow.dsh-agy-open svg{transform:rotate(180deg)}",
      // Simple circular/pill quota & /subagent button
      ".dsh-agy-btn{box-sizing:border-box;min-width:28px;height:24px;border-radius:999px;border:none;background:var(--dsw-specific-selector,rgba(128,128,128,.12));color:var(--dsw-alias-label-secondary,#81858c);display:inline-flex;align-items:center;justify-content:center;padding:0 7px;margin:0;flex:none;cursor:pointer;user-select:none;font:700 10px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-.03em;font-variant-numeric:tabular-nums;transition:background-color .12s,color .12s,box-shadow .12s}",
      ".dsh-agy-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.22));color:var(--dsw-alias-label-primary,#fff)}",
      ".dsh-agy-btn:disabled{opacity:.55;cursor:default}",
      ".dsh-agy-btn.dsh-agy-armed{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-button-info-fill,#3b82f6) 35%,transparent)}",
      ".dsh-agy-btn.dsh-agy-armed:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,#2563eb);color:#fff}",
      ".dsh-agy-btn.dsh-agy-warn:not(.dsh-agy-armed){color:var(--dsw-alias-state-warn-primary,#d97706)}",
      ".dsh-agy-btn.dsh-agy-bad:not(.dsh-agy-armed){color:var(--dsw-alias-state-error-primary,#dc2626)}",
      // Right-border drag handle strip inside the chat window
      ".dsh-agy-edge-pull{position:fixed;width:6px;height:48px;z-index:9989;cursor:ew-resize;pointer-events:auto;-webkit-app-region:no-drag;border-radius:4px 0 0 4px;transition:background-color .15s}",
      ".dsh-agy-edge-pull:hover{background:color-mix(in srgb,var(--dsw-alias-button-info-fill,#3b82f6) 45%,transparent)}",
      // Clipping container aligned to the chat window's right border so the drawer slides cleanly out of the chat border
      ".dsh-agy-drawer-clip{position:fixed;width:" +
        (PANEL_WIDTH + 24) +
        "px;z-index:9991;pointer-events:none;overflow:hidden;display:flex;justify-content:flex-end;padding:12px 0 16px 16px;box-sizing:border-box}",
      // Slide-out drawer panel anchored to the right border of the chat column with smooth spring/drag transition
      ".dsh-agy-drawer{position:relative;width:" +
        PANEL_WIDTH +
        "px;max-height:calc(100vh - 110px);box-sizing:border-box;display:flex;flex-direction:column;gap:11px;padding:12px 12px 12px 16px;border-radius:14px 0 0 14px;background:var(--dsw-alias-bg-layer-2,rgba(24,25,30,.96));border:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-right:none;box-shadow:-8px 10px 30px rgba(0,0,0,.42);backdrop-filter:blur(16px);color:var(--dsw-alias-label-primary,#f3f4f6);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:12px;line-height:1.35;overflow-y:auto;user-select:none;-webkit-app-region:no-drag;transform:translate3d(105%,0,0);opacity:0;pointer-events:none;transition:transform .26s cubic-bezier(.22,1,.36,1),opacity .2s ease}",
      ".dsh-agy-drawer.dsh-agy-drawer-open{transform:translate3d(0,0,0);opacity:1;pointer-events:auto}",
      ".dsh-agy-drawer.dsh-agy-drawer-dragging{transition:none;pointer-events:auto}",
      // Left-edge drag grip bar inside the drawer so user can drag-swipe it closed back into the chat window's right border
      ".dsh-agy-grip{position:absolute;left:4px;top:50%;transform:translateY(-50%);width:6px;height:42px;border-radius:999px;cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center}",
      ".dsh-agy-grip::after{content:'';width:3px;height:28px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.2));transition:background-color .15s}",
      ".dsh-agy-grip:hover::after{background:var(--dsw-alias-label-secondary,#9ca3af)}",
      ".dsh-agy-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      ".dsh-agy-title{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary,#f3f4f6);display:flex;align-items:center;gap:6px}",
      ".dsh-agy-dot{width:7px;height:7px;border-radius:999px;background:#10b981;flex:none}",
      ".dsh-agy-dot.warn{background:#f59e0b}",
      ".dsh-agy-dot.bad{background:#ef4444}",
      ".dsh-agy-hdr-actions{display:flex;align-items:center;gap:4px}",
      ".dsh-agy-icon-btn{background:transparent;border:none;color:var(--dsw-alias-label-tertiary,#8b9098);cursor:pointer;padding:3px 5px;border-radius:6px;font-size:11px;line-height:1;display:inline-flex;align-items:center;gap:3px}",
      ".dsh-agy-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary,#fff)}",
      ".dsh-agy-sec{display:flex;flex-direction:column;gap:5px}",
      ".dsh-agy-sec-lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#8b9098);display:flex;align-items:center;justify-content:space-between}",
      // Model / Setting list showing usage left right on each option
      ".dsh-agy-models{display:flex;flex-direction:column;gap:4px}",
      ".dsh-agy-model-opt{box-sizing:border-box;width:100%;text-align:left;padding:6px 8px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.08));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));color:var(--dsw-alias-label-primary,#e5e7eb);cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:background-color .12s,border-color .12s}",
      ".dsh-agy-model-opt:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}",
      ".dsh-agy-model-opt.active{border-color:var(--dsw-alias-button-info-fill,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-button-info-fill,#3b82f6) 14%,transparent)}",
      ".dsh-agy-model-row{display:flex;align-items:center;justify-content:space-between;gap:6px}",
      ".dsh-agy-model-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#fff)}",
      ".dsh-agy-model-pct{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#a1a6b0)}",
      ".dsh-agy-model-pct.warn{color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
      ".dsh-agy-model-pct.bad{color:var(--dsw-alias-state-error-primary,#ef4444)}",
      ".dsh-agy-model-sub{display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b9098);font-variant-numeric:tabular-nums}",
      ".dsh-agy-bar{height:3px;width:100%;border-radius:999px;background:rgba(128,128,128,.22);overflow:hidden}",
      ".dsh-agy-bar-fill{height:100%;border-radius:999px;background:#3b82f6;transition:width .25s ease}",
      ".dsh-agy-bar-fill.warn{background:#f59e0b}",
      ".dsh-agy-bar-fill.bad{background:#ef4444}",
      // Effort segmented control
      ".dsh-agy-efforts{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.22));padding:3px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.07))}",
      ".dsh-agy-effort-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);font:600 11px/1 system-ui,-apple-system,'Segoe UI',sans-serif;padding:6px 4px;border-radius:6px;cursor:pointer;transition:background-color .12s,color .12s}",
      ".dsh-agy-effort-btn:hover{color:var(--dsw-alias-label-primary,#fff)}",
      ".dsh-agy-effort-btn.active{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}",
      // Quota detail breakdown
      ".dsh-agy-quotas{display:flex;flex-direction:column;gap:6px;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(0,0,0,.18));border:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.06))}",
      ".dsh-agy-qrow{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-variant-numeric:tabular-nums;gap:6px}",
      ".dsh-agy-qname{color:var(--dsw-alias-label-secondary,#9ca3af);font-weight:500}",
      ".dsh-agy-qval{color:var(--dsw-alias-label-primary,#e5e7eb);font-weight:600}",
      // Footer toggle for /subagent
      ".dsh-agy-ftr{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:6px;border-top:0.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.08))}",
      ".dsh-agy-arm-btn{width:100%;border:0.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.04));color:var(--dsw-alias-label-primary,#e5e7eb);border-radius:8px;padding:6px 10px;font:600 11px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:background-color .12s,border-color .12s}",
      ".dsh-agy-arm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}",
      ".dsh-agy-arm-btn:disabled{opacity:.5;cursor:default}",
      ".dsh-agy-arm-btn.armed{background:color-mix(in srgb,var(--dsw-alias-button-info-fill,#3b82f6) 20%,transparent);border-color:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff}",
      ".dsh-agy-badge{font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(128,128,128,.2);color:var(--dsw-alias-label-secondary,#9ca3af)}",
      ".dsh-agy-arm-btn.armed .dsh-agy-badge{background:var(--dsw-alias-button-info-fill,#3b82f6);color:#fff}",
      ".dsh-agy-err{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:11px;word-break:break-word}",
    ].join("");

    function ensureStyle() {
      if (typeof document === "undefined") return;
      let style = document.getElementById(STYLE_ID);
      if (style === null) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        style.dataset.plugin = "dsh-subagent-antigravity";
        document.head.appendChild(style);
      }
      style.textContent = CSS;
    }

    function removeStyle() {
      if (typeof document === "undefined") return;
      const style = document.getElementById(STYLE_ID);
      if (style !== null) style.remove();
    }

    function removeLegacyMirror() {
      if (typeof document === "undefined") return;
      const prev = window.__dshAgyUsage;
      if (prev && typeof prev.dispose === "function") {
        try {
          prev.dispose();
        } catch (_e) {}
      }
      delete window.__dshAgyUsage;
      for (const stale of document.querySelectorAll(".dsh-agy-mirror")) stale.remove();
    }

    const pctOf = (entry) => (entry && typeof entry.remaining === "number" ? entry.remaining : undefined);

    function isArmedDraft(draft) {
      if (typeof draft !== "string") return false;
      const trimmed = draft.trimStart();
      return trimmed === SKILL_COMMAND || trimmed.startsWith(SKILL_COMMAND + " ") || trimmed.startsWith(SKILL_COMMAND + "\n");
    }

    // Shared reactive store for usage, settings, drawer open/drag state, and composer draft sync
    const agyStore = {
      draft: "",
      phase: "plain",
      claimName: undefined,
      inputActions: null,
      composerMounted: false,
      headerUtilitiesMounted: 0,
      expanded: false,
      dragOffsetPx: null,
      usage: null,
      settings: {
        family: "gemini-3.8-flash",
        model: "gemini-3.8-flash-high",
        effort: "high",
        pinSubagentFork: true,
      },
      families: DEFAULT_FAMILIES,
      efforts: DEFAULT_EFFORTS,
      error: undefined,
      saving: false,
      fetchedAt: 0,
      inflight: false,
      listeners: new Set(),

      emit() {
        for (const fn of this.listeners) {
          try {
            fn();
          } catch (_e) {}
        }
      },
      subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
      updateComposer(next) {
        const changed =
          this.draft !== next.draft ||
          this.phase !== next.phase ||
          this.claimName !== next.claimName ||
          this.inputActions !== next.inputActions ||
          this.composerMounted !== next.mounted;
        this.draft = next.draft;
        this.phase = next.phase;
        this.claimName = next.claimName;
        this.inputActions = next.inputActions;
        this.composerMounted = next.mounted;
        if (changed) this.emit();
      },
      setExpanded(val) {
        const next = typeof val === "function" ? val(this.expanded) : Boolean(val);
        if (this.expanded !== next || this.dragOffsetPx !== null) {
          this.expanded = next;
          this.dragOffsetPx = null;
          this.emit();
        }
      },
      setDragOffset(px) {
        if (this.dragOffsetPx !== px) {
          this.dragOffsetPx = px;
          this.emit();
        }
      },
      isArmed() {
        return this.claimName === "subagent" || isArmedDraft(this.draft);
      },
      isBusy() {
        return this.phase === "adjudicating" || this.phase === "submitting";
      },
      canToggle() {
        return this.composerMounted && !this.isBusy() && this.inputActions && typeof this.inputActions.setDraft === "function";
      },
      toggleSubagent() {
        if (!this.canToggle()) return;
        const current = typeof this.draft === "string" ? this.draft : "";
        if (this.isArmed()) {
          const stripped = current.replace(/^\s*\/subagent(?:\s+|$)/, "");
          this.inputActions.setDraft(stripped);
        } else {
          const clean = current.replace(/^\s+/, "");
          this.inputActions.setDraft(clean.length > 0 ? SKILL_COMMAND + " " + clean : SKILL_COMMAND + " ");
        }
      },
      async refresh(force) {
        if (this.inflight) return;
        this.inflight = true;
        try {
          const response = await fetch(USAGE_ROUTE + (force ? "?force=1" : ""), {
            cache: "no-store",
            credentials: "same-origin",
            headers: { accept: "application/json" },
          });
          let body;
          try {
            body = await response.json();
          } catch (_e) {
            body = undefined;
          }
          if (body && body.ok && body.groups) {
            this.usage = body;
            if (body.settings) this.settings = body.settings;
            if (Array.isArray(body.families) && body.families.length > 0) this.families = body.families;
            if (Array.isArray(body.efforts) && body.efforts.length > 0) this.efforts = body.efforts;
            this.error = undefined;
            this.fetchedAt = Date.now();
          } else {
            this.error = body && body.error ? "http " + response.status + ": " + body.error : "http " + response.status;
          }
        } catch (failure) {
          this.error = "request failed: " + String((failure && failure.message) || failure);
        } finally {
          this.inflight = false;
          this.emit();
        }
      },
      async saveSettings(patch) {
        this.saving = true;
        this.settings = { ...this.settings, ...patch };
        this.emit();
        try {
          const response = await fetch(SETTINGS_ROUTE, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify(patch),
          });
          const body = await response.json();
          if (body && body.ok && body.settings) {
            this.settings = body.settings;
            if (Array.isArray(body.families) && body.families.length > 0) this.families = body.families;
            if (Array.isArray(body.efforts) && body.efforts.length > 0) this.efforts = body.efforts;
          }
        } catch (_err) {
          /* ignore */
        } finally {
          this.saving = false;
          this.emit();
        }
      },
    };

    function useAgyStore() {
      const [, tick] = react.useState(0);
      react.useEffect(() => agyStore.subscribe(() => tick((n) => n + 1)), []);
      return agyStore;
    }

    // Measure the active chat column's right border and header bottom so the slide-out drawer
    // spawns directly from the right border of the chat window (and not over the right sidebar).
    function measureChatWindowEdge() {
      if (typeof document === "undefined") {
        return { rightOffsetPx: 0, topPx: 52 };
      }
      const chatHeader =
        document.querySelector("header[data-window-drag]") ||
        document.querySelector("[data-conversation-scroll]")?.parentElement?.parentElement;
      if (chatHeader) {
        const rect = chatHeader.getBoundingClientRect();
        if (rect.width > 0) {
          const rightOffsetPx = Math.max(0, Math.round(window.innerWidth - rect.right));
          const topPx = Math.max(40, Math.round(rect.bottom + 4));
          return { rightOffsetPx, topPx };
        }
      }
      return { rightOffsetPx: 0, topPx: 52 };
    }

    let activeDragSession = null;

    function startDrawerDrag(event, mode) {
      if (event.button !== undefined && event.button !== 0) return;
      const startX = event.clientX;
      const startOffset = mode === "edge" ? PANEL_WIDTH : agyStore.expanded ? 0 : PANEL_WIDTH;
      let moved = false;
      let latestOffset = startOffset;

      activeDragSession = { startX, moved: false };

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        if (!moved && Math.abs(dx) > 4) {
          moved = true;
          if (activeDragSession) activeDragSession.moved = true;
        }
        if (!moved) return;
        latestOffset = Math.max(0, Math.min(PANEL_WIDTH, startOffset + dx));
        agyStore.setDragOffset(latestOffset);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
        const wasMoved = moved;
        setTimeout(() => {
          activeDragSession = null;
        }, 0);
        if (!wasMoved) {
          agyStore.setDragOffset(null);
          if (mode === "arrow" || mode === "edge") {
            agyStore.setExpanded((v) => !v);
          }
          return;
        }
        const threshold = startOffset === 0 ? PANEL_WIDTH * 0.32 : PANEL_WIDTH * 0.68;
        agyStore.setExpanded(latestOffset < threshold);
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onUp, true);
    }

    function ArrowGlyph() {
      return h(
        "svg",
        { viewBox: "0 0 12 12", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M7.5 2.25L3.75 6L7.5 9.75",
          stroke: "currentColor",
          strokeWidth: "1.6",
          strokeLinecap: "round",
          strokeLinejoin: "round",
        })
      );
    }

    function toneClass(pct) {
      if (typeof pct !== "number") return "";
      if (pct < 8) return "bad";
      if (pct < 25) return "warn";
      return "";
    }

    function formatBucketLine(entry) {
      if (!entry || typeof entry.remaining !== "number") return "n/a";
      const pct = entry.remaining.toFixed(1) + "%";
      const rst = entry.resetsIn && entry.resetsIn !== "available" ? " (" + entry.resetsIn + ")" : "";
      return pct + rst;
    }

    // Capsule button rendered at the top-right of the chat window (`conversation.session.header.utilities`)
    function AntigravityHeaderCapsule(props) {
      const store = useAgyStore();
      const floating = Boolean(props && props.floating);

      const armed = store.isArmed();
      const canToggleComposer = store.canToggle();
      const groups = (store.usage && store.usage.groups) || {};
      const activeFamilyObj =
        store.families.find((f) => f.id === store.settings.family) || store.families[0] || DEFAULT_FAMILIES[0];
      const activeBucketKey = activeFamilyObj.bucket === "claude" ? "claude" : "gemini";
      const activeBucket = groups[activeBucketKey];
      const activeFive = pctOf(activeBucket && activeBucket.fiveHour) ?? pctOf(groups.gemini && groups.gemini.fiveHour);

      let labelText;
      if (store.error !== undefined && store.usage === null) {
        const code = /http (\d{3})/.exec(store.error);
        labelText = code ? code[1] : "!";
      } else {
        labelText = activeFive === undefined ? "\u2026" : Math.round(activeFive) + "%";
      }

      const activeEffortObj =
        store.efforts.find((e) => e.id === store.settings.effort) || store.efforts[2] || DEFAULT_EFFORTS[2];

      const tooltipLines = [
        "Antigravity (" + activeFamilyObj.label + " \u00b7 " + activeEffortObj.label + ")",
        armed
          ? SKILL_COMMAND + " ARMED \u2014 click to remove " + SKILL_COMMAND + " from draft"
          : "Click: toggle " + SKILL_COMMAND + " in composer",
        "Arrow (click or drag left): slide out settings & effort panel from chat border",
        "Alt-click: refresh quota now",
      ];
      if (store.error !== undefined) tooltipLines.push("Error: " + store.error);

      const onMainButtonClick = (event) => {
        if (event && event.altKey === true) {
          void store.refresh(true);
          return;
        }
        if (canToggleComposer) {
          store.toggleSubagent();
        } else {
          store.setExpanded((v) => !v);
        }
      };

      const isVisuallyOpen =
        store.dragOffsetPx !== null ? store.dragOffsetPx < PANEL_WIDTH * 0.5 : store.expanded;

      const btnClasses = ["dsh-agy-btn"];
      if (armed) btnClasses.push("dsh-agy-armed");
      else if (activeFive !== undefined && activeFive < 8) btnClasses.push("dsh-agy-bad");
      else if (activeFive !== undefined && activeFive < 25) btnClasses.push("dsh-agy-warn");

      const arrowClasses = ["dsh-agy-arrow"];
      if (isVisuallyOpen) arrowClasses.push("dsh-agy-open");

      return h(
        "div",
        {
          className: "dsh-agy-dock" + (floating ? " dsh-agy-dock-floating" : ""),
          "data-agy-dock": "true",
        },
        h(
          "div",
          { className: "dsh-agy-capsule" },
          h(
            "button",
            {
              type: "button",
              className: arrowClasses.join(" "),
              onPointerDown: (e) => {
                e.preventDefault();
                startDrawerDrag(e, "arrow");
              },
              title: isVisuallyOpen
                ? "Click or drag right to collapse Antigravity panel"
                : "Click or drag left to expand Antigravity settings & effort level",
              "aria-label": isVisuallyOpen ? "Collapse Antigravity settings" : "Expand Antigravity settings",
              "aria-expanded": isVisuallyOpen ? "true" : "false",
            },
            h(ArrowGlyph, null)
          ),
          h(
            "button",
            {
              type: "button",
              className: btnClasses.join(" "),
              onClick: onMainButtonClick,
              onMouseDown: (e) => e.preventDefault(),
              title: tooltipLines.join("\n"),
              "aria-label": "Antigravity quota and /subagent toggle",
              "aria-pressed": armed ? "true" : "false",
            },
            labelText
          )
        )
      );
    }

    // Mounted in `conversation.session.header.utilities` (top-right inside the chat header)
    function ChatHeaderUtilityEntry() {
      react.useEffect(() => {
        agyStore.headerUtilitiesMounted += 1;
        agyStore.emit();
        return () => {
          agyStore.headerUtilitiesMounted = Math.max(0, agyStore.headerUtilitiesMounted - 1);
          agyStore.emit();
        };
      }, []);
      return h(AntigravityHeaderCapsule, { floating: false });
    }

    // Mounted in `conversation.input.right` to sync composer draft and show a fallback top-right
    // chat button when the session is in its blank "New Chat" hero state (where utilities are hidden).
    function ComposerSyncBridge(props) {
      const useInput = props && props.useInput;
      const inputActions = props && props.inputActions;
      const draft = typeof useInput === "function" ? useInput((s) => (s && typeof s.draft === "string" ? s.draft : "")) : "";
      const phase = typeof useInput === "function" ? useInput((s) => (s && s.phase ? s.phase : "plain")) : "plain";
      const claimName = typeof useInput === "function" ? useInput((s) => (s && s.claim ? s.claim.name : undefined)) : undefined;

      react.useEffect(() => {
        agyStore.updateComposer({
          draft,
          phase,
          claimName,
          inputActions: inputActions || null,
          mounted: true,
        });
      }, [draft, phase, claimName, inputActions]);

      react.useEffect(() => {
        return () => {
          agyStore.updateComposer({
            draft: "",
            phase: "plain",
            claimName: undefined,
            inputActions: null,
            mounted: false,
          });
        };
      }, []);

      return null;
    }

    // Slide-out drawer + fallback blank-chat header capsule mounted in `shell.overlay`,
    // dynamically aligned to the chat window's right border.
    function ChatWindowRightDrawerOverlay() {
      const store = useAgyStore();
      const drawerRef = react.useRef(null);
      const [edge, setEdge] = react.useState(() => measureChatWindowEdge());

      react.useEffect(() => {
        void agyStore.refresh(false);
        const id = setInterval(() => void agyStore.refresh(false), REFRESH_MS);
        return () => clearInterval(id);
      }, []);

      react.useEffect(() => {
        const updateGeometry = () => {
          const next = measureChatWindowEdge();
          setEdge((prev) =>
            prev.rightOffsetPx === next.rightOffsetPx && prev.topPx === next.topPx ? prev : next
          );
        };
        updateGeometry();
        window.addEventListener("resize", updateGeometry);
        const id = setInterval(updateGeometry, 400);
        return () => {
          window.removeEventListener("resize", updateGeometry);
          clearInterval(id);
        };
      }, [store.expanded, store.dragOffsetPx, store.headerUtilitiesMounted, store.composerMounted]);

      // Close drawer on outside click or Escape
      react.useEffect(() => {
        if (!store.expanded && store.dragOffsetPx === null) return;
        const onPointerDown = (e) => {
          if (activeDragSession) return;
          const target = e.target;
          if (target && target.closest && target.closest("[data-agy-dock]")) return;
          if (drawerRef.current && drawerRef.current.contains(target)) return;
          store.setExpanded(false);
        };
        const onKeyDown = (e) => {
          if (e.key === "Escape") store.setExpanded(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [store.expanded, store.dragOffsetPx]);

      const armed = store.isArmed();
      const canToggleComposer = store.canToggle();
      const groups = (store.usage && store.usage.groups) || {};
      const activeFamilyObj =
        store.families.find((f) => f.id === store.settings.family) || store.families[0] || DEFAULT_FAMILIES[0];
      const activeBucketKey = activeFamilyObj.bucket === "claude" ? "claude" : "gemini";
      const activeBucket = groups[activeBucketKey];
      const activeFive = pctOf(activeBucket && activeBucket.fiveHour) ?? pctOf(groups.gemini && groups.gemini.fiveHour);
      const activeEffortObj =
        store.efforts.find((e) => e.id === store.settings.effort) || store.efforts[2] || DEFAULT_EFFORTS[2];

      const drawerClasses = ["dsh-agy-drawer"];
      if (store.dragOffsetPx !== null) {
        drawerClasses.push("dsh-agy-drawer-dragging");
      } else if (store.expanded) {
        drawerClasses.push("dsh-agy-drawer-open");
      }

      const drawerStyle =
        store.dragOffsetPx !== null
          ? {
              transform: "translate3d(" + Math.round(store.dragOffsetPx) + "px, 0, 0)",
              opacity: Math.max(0.15, 1 - store.dragOffsetPx / (PANEL_WIDTH * 1.15)),
            }
          : undefined;

      const bucketUsageForFamily = (fam) => {
        const bKey = fam.bucket === "claude" ? "claude" : "gemini";
        const b = groups[bKey];
        if (!b) return { five: undefined, week: undefined, fiveEntry: undefined, weekEntry: undefined };
        return {
          five: pctOf(b.fiveHour),
          week: pctOf(b.weekly),
          fiveEntry: b.fiveHour,
          weekEntry: b.weekly,
        };
      };

      // If the user is on a blank New Chat screen where `conversation.session.header.utilities` is hidden,
      // render the capsule at the top-right of the chat pane so it is still right there in the chat header.
      const showBlankChatFallbackCapsule = store.composerMounted && store.headerUtilitiesMounted === 0;

      return h(
        react.Fragment,
        null,
        showBlankChatFallbackCapsule
          ? h(
              "div",
              {
                style: {
                  position: "fixed",
                  right: edge.rightOffsetPx + 18 + "px",
                  top: Math.max(12, edge.topPx - 36) + "px",
                  zIndex: 9990,
                  pointerEvents: "auto",
                },
              },
              h(AntigravityHeaderCapsule, { floating: false })
            )
          : null,
        // Subtle right-border drag strip along the chat window's top-right edge
        h("div", {
          className: "dsh-agy-edge-pull",
          style: {
            right: edge.rightOffsetPx + "px",
            top: Math.max(8, edge.topPx - 40) + "px",
          },
          onPointerDown: (e) => startDrawerDrag(e, "edge"),
          title: "Drag left or click to slide out Antigravity panel from chat border",
        }),
        // Clipping wrapper anchored to the right border of the chat column
        h(
          "div",
          {
            className: "dsh-agy-drawer-clip",
            style: {
              right: edge.rightOffsetPx + "px",
              top: edge.topPx + "px",
            },
          },
          h(
            "div",
            {
              ref: drawerRef,
              className: drawerClasses.join(" "),
              style: drawerStyle,
              role: "dialog",
              "aria-label": "Antigravity Settings & Usage",
              "aria-hidden": !store.expanded && store.dragOffsetPx === null ? "true" : "false",
            },
            // Left-edge drag handle to swipe-close back into the chat window's right border
            h("div", {
              className: "dsh-agy-grip",
              onPointerDown: (e) => {
                e.preventDefault();
                startDrawerDrag(e, "grip");
              },
              title: "Drag right to slide panel closed",
            }),
            // Header
            h(
              "div",
              { className: "dsh-agy-hdr" },
              h(
                "div",
                { className: "dsh-agy-title" },
                h("span", { className: "dsh-agy-dot " + toneClass(activeFive) }),
                h("span", null, "Antigravity Subagents")
              ),
              h(
                "div",
                { className: "dsh-agy-hdr-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-agy-icon-btn",
                    onClick: () => void store.refresh(true),
                    title: "Refresh live usage over HTTPS",
                  },
                  "\u21bb Refresh"
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "dsh-agy-icon-btn",
                    onClick: () => store.setExpanded(false),
                    title: "Slide panel closed",
                  },
                  "\u2715"
                )
              )
            ),

            store.error ? h("div", { className: "dsh-agy-err" }, store.error) : null,

            // Setting / Model selector with live usage left per option
            h(
              "div",
              { className: "dsh-agy-sec" },
              h(
                "div",
                { className: "dsh-agy-sec-lbl" },
                h("span", null, "Setting (Model & Usage Left)"),
                h("span", null, store.settings.model)
              ),
              h(
                "div",
                { className: "dsh-agy-models" },
                store.families.map((fam) => {
                  const isSelected = store.settings.family === fam.id;
                  const u = bucketUsageForFamily(fam);
                  const primaryPct = u.five !== undefined ? u.five : u.week;
                  const tone = toneClass(primaryPct);
                  return h(
                    "button",
                    {
                      key: fam.id,
                      type: "button",
                      className: "dsh-agy-model-opt" + (isSelected ? " active" : ""),
                      onClick: () => void store.saveSettings({ family: fam.id }),
                    },
                    h(
                      "div",
                      { className: "dsh-agy-model-row" },
                      h("span", { className: "dsh-agy-model-name" }, fam.label),
                      h(
                        "span",
                        { className: "dsh-agy-model-pct " + tone },
                        primaryPct !== undefined ? primaryPct.toFixed(1) + "% left" : "\u2026"
                      )
                    ),
                    h(
                      "div",
                      { className: "dsh-agy-bar" },
                      h("div", {
                        className: "dsh-agy-bar-fill " + tone,
                        style: { width: Math.max(0, Math.min(100, primaryPct ?? 0)) + "%" },
                      })
                    ),
                    h(
                      "div",
                      { className: "dsh-agy-model-sub" },
                      h("span", null, fam.bucketLabel),
                      h(
                        "span",
                        null,
                        u.fiveEntry
                          ? "5h: " +
                              formatBucketLine(u.fiveEntry) +
                              (u.weekEntry ? " \u00b7 wk: " + u.weekEntry.remaining.toFixed(0) + "%" : "")
                          : "quota syncing\u2026"
                      )
                    )
                  );
                })
              )
            ),

            // Effort level selector
            h(
              "div",
              { className: "dsh-agy-sec" },
              h(
                "div",
                { className: "dsh-agy-sec-lbl" },
                h("span", null, "Effort Level"),
                h(
                  "span",
                  null,
                  activeEffortObj.budget > 0
                    ? (activeEffortObj.budget / 1024).toFixed(0) + "k think tokens"
                    : "thinking off"
                )
              ),
              h(
                "div",
                { className: "dsh-agy-efforts", role: "radiogroup", "aria-label": "Effort level" },
                store.efforts.map((eff) => {
                  const active = store.settings.effort === eff.id;
                  return h(
                    "button",
                    {
                      key: eff.id,
                      type: "button",
                      role: "radio",
                      "aria-checked": active ? "true" : "false",
                      className: "dsh-agy-effort-btn" + (active ? " active" : ""),
                      title: eff.description || eff.label,
                      onClick: () => void store.saveSettings({ effort: eff.id }),
                    },
                    eff.shortLabel || eff.label
                  );
                })
              )
            ),

            // Quota Windows Summary
            groups.gemini || groups.claude
              ? h(
                  "div",
                  { className: "dsh-agy-sec" },
                  h(
                    "div",
                    { className: "dsh-agy-sec-lbl" },
                    h("span", null, "Plan Quota Windows"),
                    store.fetchedAt > 0
                      ? h("span", null, Math.max(0, Math.round((Date.now() - store.fetchedAt) / 1000)) + "s ago")
                      : null
                  ),
                  h(
                    "div",
                    { className: "dsh-agy-quotas" },
                    groups.gemini
                      ? h(
                          "div",
                          { className: "dsh-agy-qrow" },
                          h("span", { className: "dsh-agy-qname" }, "Gemini 5h"),
                          h("span", { className: "dsh-agy-qval" }, formatBucketLine(groups.gemini.fiveHour))
                        )
                      : null,
                    groups.claude && groups.claude.fiveHour
                      ? h(
                          "div",
                          { className: "dsh-agy-qrow" },
                          h("span", { className: "dsh-agy-qname" }, "Claude/GPT 5h"),
                          h("span", { className: "dsh-agy-qval" }, formatBucketLine(groups.claude.fiveHour))
                        )
                      : null,
                    groups.claude && groups.claude.weekly
                      ? h(
                          "div",
                          { className: "dsh-agy-qrow" },
                          h("span", { className: "dsh-agy-qname" }, "Claude/GPT Week"),
                          h("span", { className: "dsh-agy-qval" }, formatBucketLine(groups.claude.weekly))
                        )
                      : null
                  )
                )
              : null,

            // Footer: /subagent arm toggle
            h(
              "div",
              { className: "dsh-agy-ftr" },
              h(
                "button",
                {
                  type: "button",
                  className: "dsh-agy-arm-btn" + (armed ? " armed" : ""),
                  disabled: !canToggleComposer,
                  onClick: () => store.toggleSubagent(),
                },
                h("span", null, "Delegate with " + SKILL_COMMAND),
                h("span", { className: "dsh-agy-badge" }, armed ? "ARMED" : "OFF")
              )
            )
          )
        )
      );
    }

    function apply(ctx) {
      if (typeof window === "undefined" || typeof document === "undefined") return;
      removeLegacyMirror();
      ensureStyle();
      ctx.effect(() => () => {
        removeStyle();
        removeLegacyMirror();
      }, "dsh-subagent-antigravity: style cleanup");

      // 1. Mount the capsule button directly in the chat window's top-right header utility bar.
      ctx.slots.inject("conversation.session.header.utilities", () =>
        ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "dsh-subagent-antigravity-header",
            order: 5,
            label: () => "Antigravity",
          },
          ChatHeaderUtilityEntry
        )
      );

      // 2. Headless composer sync bridge in `conversation.input.right` so the header button & drawer
      //    can read/toggle `/subagent` in the active chat draft.
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "dsh-subagent-antigravity-sync",
            order: 50,
            label: () => "Antigravity Sync",
          },
          ComposerSyncBridge
        )
      );

      // 3. Slide-out/drag drawer anchored to the chat window's right border.
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          {
            name: "shell.overlay",
            id: "dsh-subagent-antigravity-panel",
            order: 90,
            label: () => "Antigravity Panel",
          },
          ChatWindowRightDrawerOverlay
        )
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
