// The on-page widget. Always there, floating:
//  • form pages: a dock on the right edge  📋 Copy form (scans + copies)  ·  ✨ Paste into form (fills it)
//  • chat pages: a small bar next to the message box  Paste (form → message box)  ·  Copy (AI reply → form)
// Every button explains itself on hover. Nothing is ever sent or submitted for you.
import { getHiddenHosts, HIDDEN_HOSTS_KEY, setHostHidden } from "../shared/prefs";
import { buildPrompt } from "../shared/protocol";
import type { FillSummary } from "../shared/types";
import type { WidgetBackend } from "./backend";
import { findComposer, findLatestReply, insertIntoComposer } from "./chat";
import { copyText, h } from "./dom";
import { WIDGET_HOST_ID } from "./scanner";

export interface WidgetOptions {
  mode: "form" | "chat";
  backend: WidgetBackend;
}

type Tone = "ok" | "warn" | "error";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.dock { position: fixed; right: 0; top: 40vh; z-index: 2147483646; display: flex; align-items: flex-start;
  transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s; }
.dock.off { display: none; }
.dock.collapsed { transform: translateX(calc(100% - 14px)); }
.dock.collapsed .pill { border-left: 3px solid #6d4dff; }
.dock.collapsed:hover, .dock.peek { transform: none; }
.pill { position: relative; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 6px 7px 9px;
  background: rgba(27,24,42,.94); border: 1px solid rgba(255,255,255,.1); border-right: 0; border-radius: 20px 0 0 20px;
  box-shadow: -6px 10px 30px rgba(20,10,50,.38); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.top { display: flex; align-items: center; width: 100%; gap: 2px; }
.hide { border: 0; background: none; color: rgba(255,255,255,.35); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 3px; }
.hide:hover { color: #fff; }
.grip { flex: 1; height: 14px; cursor: grab; display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.35); font-size: 11px; letter-spacing: 1px; user-select: none; touch-action: none; }
.grip:hover { color: rgba(255,255,255,.7); }
.grip:active { cursor: grabbing; }
.btn { position: relative; border: 0; cursor: pointer; color: #fff; background: rgba(255,255,255,.08);
  transition: background .15s, transform .15s, box-shadow .15s; }
.btn:hover { background: #6d4dff; transform: scale(1.06); box-shadow: 0 4px 14px rgba(109,77,255,.45); }
.btn:active { transform: scale(.96); }
.btn:focus-visible { outline: 2px solid #b6a6ff; outline-offset: 2px; }
.btn:disabled { opacity: .55; cursor: default; transform: none; }
.btn.emoji { width: 44px; height: 44px; border-radius: 50%; font-size: 21px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.btn.word { min-width: 68px; padding: 9px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 700; letter-spacing: .02em; }
.btn[data-tip]::after { content: attr(data-tip); position: absolute; right: calc(100% + 14px); top: 50%;
  transform: translateY(-50%) translateX(6px); width: max-content; max-width: 240px; text-align: left; white-space: normal;
  font: 500 12px/1.45 system-ui, sans-serif; letter-spacing: 0; padding: 9px 11px; border-radius: 11px;
  background: #12101c; color: #ececf3; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 10px 28px rgba(0,0,0,.4);
  opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s; }
.btn[data-tip]:hover::after { opacity: 1; transform: translateY(-50%); transition-delay: .25s; }
.toast, .panel { position: absolute; right: calc(100% + 12px); top: 0; background: #12101c; color: #ececf3;
  border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 12px 34px rgba(0,0,0,.42); font-size: 13px; line-height: 1.45; }
.toast { display: flex; align-items: center; gap: 9px; padding: 10px 12px; width: max-content; max-width: 320px; cursor: pointer; }
.toast[hidden], .panel[hidden] { display: none; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: #22c55e; }
.dot.warn { background: #f59e0b; } .dot.error { background: #ef4444; }
.act { border: 0; border-radius: 8px; padding: 5px 10px; background: #6d4dff; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; flex: none; }
.act:hover { background: #7d60ff; }
.panel { width: 320px; padding: 12px; }
.ptitle { display: flex; align-items: center; justify-content: space-between; font-weight: 700; margin-bottom: 8px; }
.pclose { border: 0; background: none; color: #9a97ad; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
.pclose:hover { color: #fff; }
.panel textarea { width: 100%; height: 110px; resize: vertical; border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 8px;
  background: #1b182a; color: #ececf3; font: 12px/1.4 ui-monospace, Consolas, monospace; }
.panel textarea:focus { outline: 2px solid #6d4dff; }
.perr { color: #fca5a5; font-size: 12px; margin-top: 6px; }
.prow { display: flex; gap: 8px; margin-top: 8px; }
.mini { flex: 1; border: 1px solid rgba(255,255,255,.18); background: transparent; color: #ececf3; border-radius: 9px; padding: 7px 10px; font-size: 12.5px; cursor: pointer; }
.mini:hover { background: rgba(255,255,255,.08); }
.mini.primary { background: #6d4dff; border-color: #6d4dff; font-weight: 700; }
.mini.primary:hover { background: #7d60ff; }
.mini:disabled { opacity: .55; cursor: default; }
/* Chat pages: a small bar that floats next to the message box instead of the screen edge. */
.dock.inline { right: auto; top: 0; left: 0; transform: none !important; }
.dock.inline .top { display: none; }
.dock.inline .pill { flex-direction: row; gap: 4px; padding: 4px 6px 4px 4px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px;
  box-shadow: 0 6px 20px rgba(20,10,50,.3); }
.dock.inline .btn.word { min-width: 0; padding: 6px 13px; font-size: 12px; }
.dock.inline .hide { font-size: 14px; padding: 0 4px; }
.dock.inline .toast, .dock.inline .panel { right: 0; left: auto; top: auto; bottom: calc(100% + 10px); }
.dock.inline .btn[data-tip]::after { right: auto; left: 50%; top: auto; bottom: calc(100% + 12px); transform: translateX(-50%) translateY(4px); }
.dock.inline .btn[data-tip]:hover::after { transform: translateX(-50%); }
@media (prefers-reduced-motion: reduce) { .dock, .btn { transition: none; } }
`;

interface Prefs {
  top?: number;
  collapsed?: boolean;
}
const PREF_KEY = "lazyboi.widget";

async function loadPrefs(): Promise<Prefs> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const d = await chrome.storage.local.get(PREF_KEY);
      return (d[PREF_KEY] as Prefs | undefined) ?? {};
    }
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}

function savePrefs(p: Prefs): void {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) void chrome.storage.local.set({ [PREF_KEY]: p });
    else localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return /context invalidated|Extension context|Receiving end does not exist/i.test(m) ? "lazyBoi was updated. Refresh this page." : m;
}

const clip = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function describeFill(s: FillSummary, where = ""): { text: string; tone: Tone } {
  if (!s.filled && !s.skipped.length) return { text: "Nothing to fill from that reply.", tone: "warn" };
  let text = `Filled ${s.filled} field${s.filled === 1 ? "" : "s"}${where}.`;
  if (s.skipped.length) {
    const names = s.skipped.slice(0, 2).map((x) => `${x.label} (${clip(x.reason)})`).join("; ");
    text += ` Skipped ${s.skipped.length}: ${names}${s.skipped.length > 2 ? "…" : ""}`;
  }
  return { text, tone: s.skipped.length ? "warn" : "ok" };
}

export function mountWidget(opts: WidgetOptions): { destroy(): void } {
  document.getElementById(WIDGET_HOST_ID)?.remove();
  const { backend } = opts;
  const cleanups: (() => void)[] = [];
  const listen = <T extends EventTarget>(t: T, type: string, fn: EventListener, capture = false) => {
    t.addEventListener(type, fn, capture);
    cleanups.push(() => t.removeEventListener(type, fn, capture));
  };

  const host = h("div", { id: WIDGET_HOST_ID });
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", {}, CSS));

  const dock = h("div", { class: opts.mode === "chat" ? "dock off inline" : "dock off" });
  const pill = h("div", { class: "pill" });
  const grip = h("div", { class: "grip", title: "Drag to move · double-click to tuck away" }, "⋮⋮");
  const hideBtn = h("button", { class: "hide", type: "button", title: "Hide lazyBoi on this site", "aria-label": "Hide lazyBoi on this site" }, "×");
  const toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  toastBox.hidden = true;
  const panel = h("div", { class: "panel" });
  panel.hidden = true;
  dock.append(toastBox, panel, pill);
  pill.append(h("div", { class: "top" }, grip, hideBtn));
  root.append(dock);

  const button = (kind: "emoji" | "word", text: string, label: string, tip: string) =>
    h("button", { class: `btn ${kind}`, type: "button", "aria-label": label, "data-tip": tip }, text);

  // ---- toast ----
  let toastTimer = 0;
  const hideToast = () => {
    toastBox.hidden = true;
    if (panel.hidden) dock.classList.remove("peek");
  };
  toastBox.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest(".act")) hideToast(); // click the toast to dismiss it
  });
  function toast(msg: string, tone: Tone = "ok", action?: { label: string; run: () => Promise<void> | void }) {
    closePanel();
    toastBox.replaceChildren(h("span", { class: `dot ${tone}` }), h("span", {}, msg));
    if (action) {
      const a = h("button", { class: "act", type: "button" }, action.label);
      a.addEventListener("click", async () => {
        hideToast();
        try {
          await action.run();
        } catch (e) {
          toast(friendly(e), "error");
        }
      });
      toastBox.append(a);
    }
    toastBox.hidden = false;
    dock.classList.add("peek");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, action ? 8000 : 3500);
  }
  cleanups.push(() => window.clearTimeout(toastTimer));

  /** Report a fill, with Undo. Used after any fill that touched this page's form (or the form tab, from chat). */
  function reportFill(s: FillSummary, where = "") {
    const { text, tone } = describeFill(s, where);
    const undo = s.filled
      ? {
          label: "Undo",
          run: async () => {
            const u = await backend.undo();
            toast(u.ok ? `Restored ${u.restored} field${u.restored === 1 ? "" : "s"}.` : u.error, u.ok ? "ok" : "error");
          },
        }
      : undefined;
    toast(text, tone, undo);
  }

  function guard(b: HTMLButtonElement, fn: () => Promise<void>) {
    b.addEventListener("click", async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        await fn();
      } catch (e) {
        toast(friendly(e), "error");
      } finally {
        b.disabled = false;
      }
    });
  }

  // ---- paste panel (form mode: when no reply is waiting) ----
  const ta = h("textarea", { placeholder: "Paste the AI's reply here (the whole message is fine)", "aria-label": "AI reply" });
  const perr = h("div", { class: "perr" });
  const pasteClip = h("button", { class: "mini", type: "button" }, "Paste clipboard");
  const go = h("button", { class: "mini primary", type: "button" }, "Fill form");
  const closeX = h("button", { class: "pclose", type: "button", title: "Close (Esc)", "aria-label": "Close" }, "×");
  panel.append(h("div", { class: "ptitle" }, "Paste the AI's reply", closeX), ta, perr, h("div", { class: "prow" }, pasteClip, go));

  function openPanel(message = "") {
    hideToast();
    panel.hidden = false;
    dock.classList.add("peek");
    perr.textContent = message;
    ta.focus();
  }
  function closePanel() {
    if (panel.hidden) return;
    panel.hidden = true;
    ta.value = "";
    perr.textContent = "";
    if (toastBox.hidden) dock.classList.remove("peek");
  }
  closeX.addEventListener("click", () => closePanel());
  pasteClip.addEventListener("click", async () => {
    try {
      ta.value = await navigator.clipboard.readText();
      perr.textContent = "";
    } catch {
      perr.textContent = "The browser blocked clipboard access. Paste with Ctrl+V instead.";
    }
    ta.focus();
  });
  go.addEventListener("click", async () => {
    if (!ta.value.trim()) {
      perr.textContent = "Paste the AI's reply first.";
      return;
    }
    go.disabled = true;
    try {
      const r = await backend.submitReply(ta.value);
      if (r.ok) closePanel(); // the fill itself is reported by the "lazyboi-filled" event
      else perr.textContent = r.error;
    } catch (e) {
      perr.textContent = friendly(e);
    } finally {
      go.disabled = false;
    }
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
    e.stopPropagation();
  });
  panel.addEventListener("keyup", (e) => e.stopPropagation());
  panel.addEventListener("keypress", (e) => e.stopPropagation());
  // Click anywhere else, or press Esc, and the paste box goes away.
  listen(document, "pointerdown", ((e: PointerEvent) => {
    if (!panel.hidden && !e.composedPath().includes(host)) closePanel();
  }) as EventListener, true);
  listen(document, "keydown", ((e: KeyboardEvent) => {
    if (e.key === "Escape" && !panel.hidden) closePanel();
  }) as EventListener, true);

  // ---- buttons ----
  if (opts.mode === "form") {
    const copyBtn = button("emoji", "📋", "Copy form", "Copy form: scans this page and copies a prompt for your AI chat.");
    const fillBtn = button("emoji", "✨", "Paste into form", "Paste into form: fills this form from the AI's reply. You can undo, and you press Submit yourself.");
    pill.append(copyBtn, fillBtn);

    guard(copyBtn, async () => {
      const r = await backend.scanAndRegister();
      if (!r.ok) return toast(r.error, "error");
      const n = r.schema.fields.length;
      if (!n) return toast("No fillable fields found on this page.", "error");
      const copied = await copyText(buildPrompt(r.schema));
      await backend.markCopied(r.schema.session); // the chat's Paste button uses this, not the clipboard
      if (!copied) return toast(`Scanned ${n} field${n === 1 ? "" : "s"}, but the browser blocked the clipboard. Open your AI chat and press Paste anyway.`, "warn");
      toast(`Copied ${n} field${n === 1 ? "" : "s"}. Open your AI chat and press Paste.`);
    });

    guard(fillBtn, async () => {
      const r = await backend.fillFromPending();
      if (r.ok) return; // reported by the "lazyboi-filled" event
      if (r.code === "no_session") return toast(r.error, "error");
      openPanel(); // nothing waiting: let the user paste a reply
    });

    // Any fill on this page (from here or from the chat tab) is reported with Undo.
    listen(document, "lazyboi-filled", ((e: CustomEvent<FillSummary>) => reportFill(e.detail)) as EventListener);
  } else {
    const pasteBtn = button("word", "Paste", "Paste form", "Paste: puts the form you copied into this chat's message box. You press Send.");
    const copyBtn = button("word", "Copy", "Copy reply", "Copy: copies the AI's lazyBoi reply so your form can fill from it.");
    const hideInline = h("button", { class: "hide", type: "button", title: "Hide lazyBoi on this site", "aria-label": "Hide lazyBoi on this site" }, "×");
    pill.append(pasteBtn, copyBtn, hideInline);

    guard(pasteBtn, async () => {
      const r = await backend.latestForm();
      if (!r.ok) return toast(r.error, "error");
      const prompt = buildPrompt(r.schema);
      if (insertIntoComposer(prompt)) return toast(`“${r.title}” is in the message box. Press Send.`);
      const copied = await copyText(prompt);
      toast(copied ? "Couldn't find the message box. The prompt is copied: paste it yourself." : "Couldn't find the message box.", copied ? "warn" : "error");
    });

    guard(copyBtn, async () => {
      const found = findLatestReply();
      if (!found) return toast("No lazyBoi reply here yet. Wait until the chat finishes writing.", "error");
      const clean = "```lazyboi\n" + JSON.stringify(found.reply) + "\n```";
      const copied = await copyText(clean);
      const q = await backend.queueReply(clean);
      if (!q.ok) return toast(`${copied ? "Copied, but " : ""}${q.error.charAt(0).toLowerCase()}${q.error.slice(1)}`, "warn");
      toast(`Reply copied. Press ✨ on “${q.formTitle}”.`, "ok", {
        label: "Fill now",
        run: async () => {
          const r = await backend.submitReply(clean);
          if (!r.ok) return toast(r.error, "error");
          if (r.summary) reportFill(r.summary, " on the form tab");
          else toast("Sent to the form tab.");
        },
      });
    });
  }

  // ---- drag / tuck away ----
  let dragging = false;
  let startY = 0;
  let startTop = 0;
  const clampTop = (t: number) => Math.max(8, Math.min(t, window.innerHeight - dock.offsetHeight - 8));
  grip.addEventListener("pointerdown", (e) => {
    dragging = true;
    startY = e.clientY;
    startTop = dock.getBoundingClientRect().top;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", (e) => {
    if (dragging) dock.style.top = `${clampTop(startTop + e.clientY - startY)}px`;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    savePrefs({ top: dock.getBoundingClientRect().top, collapsed: dock.classList.contains("collapsed") });
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);
  grip.addEventListener("dblclick", () => {
    dock.classList.toggle("collapsed");
    savePrefs({ top: dock.getBoundingClientRect().top, collapsed: dock.classList.contains("collapsed") });
  });

  void loadPrefs().then((p) => {
    if (opts.mode === "form" && typeof p.top === "number") dock.style.top = `${clampTop(p.top)}px`;
    if (opts.mode === "form" && p.collapsed) dock.classList.add("collapsed");
  });

  // ---- per-site hide (the toolbar popup has the switch to bring it back) ----
  const hostName = location.hostname;
  let hiddenHere = true; // stay hidden until we know the site isn't switched off
  const applyVisibility = () => dock.classList.toggle("off", hiddenHere);
  void getHiddenHosts().then((list) => {
    hiddenHere = list.includes(hostName);
    applyVisibility();
    schedulePlace();
  });
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const c = changes[HIDDEN_HOSTS_KEY];
      if (area === "local" && c) {
        hiddenHere = ((c.newValue as string[] | undefined) ?? []).includes(hostName);
        applyVisibility();
        schedulePlace();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    cleanups.push(() => chrome.storage.onChanged.removeListener(onChanged));
  }
  const onHide = () => {
    toast("Hidden on this site. Turn it back on from the lazyBoi toolbar icon.");
    window.setTimeout(() => {
      void setHostHidden(hostName, true).then(() => {
        hiddenHere = true;
        applyVisibility();
      });
    }, 2400);
  };
  dock.querySelectorAll(".hide").forEach((b) => b.addEventListener("click", onHide));

  // ---- chat mode: sit just above the message box, right-aligned, and follow it ----
  let raf = 0;
  const place = () => {
    if (opts.mode !== "chat" || dock.classList.contains("off")) return;
    const w = dock.offsetWidth;
    const hgt = dock.offsetHeight;
    const c = findComposer();
    let left: number;
    let top: number;
    if (c) {
      const r = c.getBoundingClientRect();
      left = r.right - w;
      top = r.top - hgt - 10;
      if (top < 8) top = r.bottom + hgt + 18 <= window.innerHeight ? r.bottom + 10 : 8;
    } else {
      left = window.innerWidth - w - 16;
      top = window.innerHeight - hgt - 16;
    }
    dock.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
    dock.style.top = `${Math.max(8, Math.min(top, window.innerHeight - hgt - 8))}px`;
  };
  function schedulePlace() {
    if (opts.mode !== "chat" || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      place();
    });
  }
  if (opts.mode === "chat") {
    listen(window, "resize", schedulePlace);
    listen(window, "scroll", schedulePlace, true);
    listen(document, "input", schedulePlace, true);
    const t = window.setInterval(place, 700);
    cleanups.push(() => window.clearInterval(t));
  }

  document.documentElement.append(host);
  return {
    destroy() {
      cleanups.forEach((fn) => fn());
      host.remove();
    },
  };
}
