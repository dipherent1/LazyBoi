// The on-page widget. Always there, floating:
//  • form pages: a dock on the right edge: Fill with AI, Copy form (scans + copies), Paste into form (fills it)
//  • chat pages: a small bar next to the message box  Paste (form → message box)  ·  Copy (AI reply → form)
// Every button explains itself on hover. Nothing is ever sent or submitted for you.
import { getHiddenHosts, HIDDEN_HOSTS_KEY, setHostHidden } from "../shared/prefs";
import { buildPrompt } from "../shared/protocol";
import type { FillSummary } from "../shared/types";
import type { ChatTab, WidgetBackend } from "./backend";
import { diagnose, findComposer, findLatestReply, tryInsert } from "./chat";
import { copyText, h, icon } from "./dom";
import { WIDGET_HOST_ID } from "./scanner";

export interface WidgetOptions {
  mode: "form" | "chat";
  backend: WidgetBackend;
  /** Form mode: how many fillable fields this page has right now. Seeing 2+ makes the widget shake once. */
  countFields?: () => number;
}

type Tone = "ok" | "warn" | "error";

const CSS = `
:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
/* Flat surface with thin borders. */
.dock { --bg: #e8ecf2; --ink: #4a5468; --muted: #8791a3; --accent: #4a5fd8; --hi: rgba(255,255,255,.95); --lo: rgba(150,163,186,.62);
  --line: 1px solid rgba(60,70,90,.16);

  position: fixed; right: 0; top: 40vh; z-index: 2147483646; display: flex; align-items: flex-start; color: var(--ink); }
.dock.off { display: none; }
.ico { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; display: block; }
/* Form pages: a faint sliver on the right edge. Hover it and it glides out; move away and it glides back. */
.dock:not(.inline) { transform: translateX(calc(100% - 16px)); transition: transform .34s cubic-bezier(.2,.8,.2,1) .5s; }
.dock:not(.inline) .pill { opacity: .45; transition: opacity .25s ease .5s; }
.dock:not(.inline).has-form .pill { opacity: .9; } /* a form was found on this page */
.dock:not(.inline):hover, .dock:not(.inline).peek, .dock:not(.inline).dragging { transform: none; transition-delay: 0s; }
.dock:not(.inline):hover .pill, .dock:not(.inline).peek .pill, .dock:not(.inline).dragging .pill { opacity: 1; transition-delay: 0s; }
/* A wider invisible hover zone around the sliver. */
.dock:not(.inline)::before { content: ""; position: absolute; left: -16px; top: -14px; bottom: -14px; width: 16px; }
/* When a form is detected: a little shake and a soft glow, once. */
.dock:not(.inline).notice { animation: lbnudge 1.2s cubic-bezier(.36,.07,.19,.97); }
@keyframes lbnudge {
  0%, 100% { transform: translateX(calc(100% - 16px)); }
  12% { transform: translateX(calc(100% - 42px)); }
  26% { transform: translateX(calc(100% - 16px)); }
  40% { transform: translateX(calc(100% - 34px)); }
  54% { transform: translateX(calc(100% - 16px)); }
  68% { transform: translateX(calc(100% - 26px)); }
  82% { transform: translateX(calc(100% - 16px)); }
}
@media (prefers-reduced-motion: reduce) { .dock:not(.inline).notice { animation: none; } }
.pill { position: relative; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 8px 10px 14px;
  background: var(--bg); border: var(--line); border-right: 0; border-radius: 22px 0 0 22px; }
.top { display: flex; align-items: center; width: 100%; gap: 2px; }
.hide { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 2px; display: flex; border-radius: 50%; }
.hide .ico { width: 14px; height: 14px; }
.hide:hover { color: var(--accent); }
.grip { flex: 1; height: 16px; cursor: grab; display: flex; align-items: center; justify-content: center;
  color: var(--muted); user-select: none; touch-action: none; }
.grip .ico { width: 14px; height: 14px; stroke-width: 3; }
.grip:hover { color: var(--ink); }
.grip:active { cursor: grabbing; }
.btn { position: relative; border: 0; cursor: pointer; color: var(--ink); background: var(--bg); border: var(--line);
  transition: background .15s, color .15s; }
.btn:hover { color: var(--accent); }
.btn:active { background: rgba(60,70,90,.08); color: var(--accent); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.btn:disabled { opacity: .55; cursor: default; }
.btn.icon { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.btn.word { min-width: 68px; padding: 8px 15px; border-radius: 999px; font-size: 12.5px; font-weight: 600; letter-spacing: .02em; }
.btn[data-tip]::after { content: attr(data-tip); position: absolute; right: calc(100% + 16px); top: 50%;
  transform: translateY(-50%) translateX(6px); width: max-content; max-width: 240px; text-align: left; white-space: normal;
  font: 500 12px/1.45 system-ui, sans-serif; letter-spacing: 0; padding: 9px 12px; border-radius: 12px;
  background: var(--bg); color: var(--ink); border: var(--line);
  opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s; }
.btn[data-tip]:hover::after { opacity: 1; transform: translateY(-50%); transition-delay: .25s; }
/* A tooltip never shows on top of an open message, list or paste box. */
.dock:has(.toast:not([hidden])) .btn[data-tip]::after, .dock:has(.panel:not([hidden])) .btn[data-tip]::after { display: none; }
.toast, .panel { position: absolute; right: calc(100% + 14px); top: 0; background: var(--bg); color: var(--ink);
  border: var(--line); border-radius: 16px; font-size: 13px; line-height: 1.45; }
.toast { display: flex; align-items: center; gap: 10px; padding: 11px 14px; width: max-content; max-width: 320px; cursor: pointer; }
.toast[hidden], .panel[hidden] { display: none; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: #34b36b ; }
.dot.warn { background: #e0a030; } .dot.error { background: #e0584f; }
.act { border: 0; border-radius: 999px; padding: 6px 13px; background: var(--bg); color: var(--accent); border: var(--line);
  font-size: 12px; font-weight: 700; cursor: pointer; flex: none; }
.act:active { background: rgba(60,70,90,.08); }
.panel { width: 320px; padding: 14px; }
.ptitle { display: flex; align-items: center; justify-content: space-between; font-weight: 700; margin-bottom: 10px; }
.pclose { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 2px; display: flex; }
.pclose .ico { width: 16px; height: 16px; }
.pclose:hover { color: var(--accent); }
.panel textarea { width: 100%; height: 110px; resize: vertical; border: var(--line); border-radius: 12px; padding: 10px;
  background: var(--bg); color: var(--ink); font: 12px/1.4 ui-monospace, Consolas, monospace; }
.panel textarea:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.perr { color: #c4453d; font-size: 12px; margin-top: 6px; }
.prow { display: flex; gap: 10px; margin-top: 10px; }
.mini { flex: 1; border: var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; padding: 8px 10px; font-size: 12.5px; cursor: pointer; }
.mini:active { background: rgba(60,70,90,.08); }
.mini.primary { color: var(--accent); font-weight: 700; }
.mini:disabled { opacity: .55; cursor: default; }
.tabrow { display: block; width: 100%; text-align: left; border: 0; background: var(--bg); color: var(--ink); border: var(--line);
  border-radius: 12px; padding: 9px 12px; margin-top: 10px; cursor: pointer; font-size: 12.5px; }
.tabrow:hover, .tabrow:focus-visible { background: rgba(60,70,90,.08); outline: none; }
.tabrow b { display: block; font-size: 11.5px; color: var(--accent); }
.tabrow span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
.pnote { color: var(--muted); font-size: 11.5px; margin-top: 12px; }
/* Chat pages: a small bar that floats next to the message box instead of the screen edge. */
.dock.inline { left: auto; top: 0; }
.dock.inline .top { display: none; }
.dock.inline .pill { flex-direction: row; align-items: center; gap: 0; padding: 5px; border: var(--line); border-radius: 999px;
  opacity: .6; transition: opacity .25s ease; }
.dock.inline:hover .pill, .dock.inline.peek .pill { opacity: 1; }
/* Idle: just a small chip beside the message box. Hover it and Paste / Copy unfold to its left. */
.dock.inline .chip { width: 30px; height: 30px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--accent); border: var(--line); user-select: none; }
.dock.inline .chip .ico { width: 15px; height: 15px; }
.dock.inline .btns { display: none; align-items: center; gap: 8px; margin: 0 8px 0 4px; }
.dock.inline:hover .btns, .dock.inline.peek .btns { display: flex; animation: lbpop .24s cubic-bezier(.2,.8,.2,1); }
@keyframes lbpop { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
.dock.inline .btn.word { min-width: 0; padding: 6px 14px; font-size: 12px; }
.dock.inline .toast, .dock.inline .panel { right: 0; left: auto; top: auto; bottom: calc(100% + 12px); }
.dock.inline .btn[data-tip]::after { right: auto; left: 50%; top: auto; bottom: calc(100% + 14px); transform: translateX(-50%) translateY(4px); }
.dock.inline .btn[data-tip]:hover::after { transform: translateX(-50%); }
@media (prefers-reduced-motion: reduce) { .dock, .btn { transition: none; } }
`;

interface Prefs {
  top?: number;
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
  try {
    // A constructable stylesheet isn't subject to a page's inline-style CSP, unlike a <style> element.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    root.append(h("style", {}, CSS));
  }

  const dock = h("div", { class: opts.mode === "chat" ? "dock off inline" : "dock off" });
  const pill = h("div", { class: "pill" });
  const grip = h("div", { class: "grip", title: "Drag to move" }, icon("grip"));
  const hideBtn = h("button", { class: "hide", type: "button", title: "Hide lazyBoi on this site", "aria-label": "Hide lazyBoi on this site" }, icon("x"));
  const toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  toastBox.hidden = true;
  const panel = h("div", { class: "panel" });
  panel.hidden = true;
  const picker = h("div", { class: "panel" }); // "Ask which chat?" list
  picker.hidden = true;
  dock.append(toastBox, panel, picker, pill);
  pill.append(h("div", { class: "top" }, grip, hideBtn));
  root.append(dock);

  const button = (kind: "icon" | "word", text: string | Node, label: string, tip: string) =>
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
  function toast(msg: string, tone: Tone = "ok", action?: { label: string; run: () => Promise<void> | void }, sticky = false) {
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
    if (!sticky) toastTimer = window.setTimeout(hideToast, action ? 8000 : 3500);
  }
  cleanups.push(() => window.clearTimeout(toastTimer));

  /** Report a fill, with Undo. Used after any fill that touched this page's form (or the form tab, from chat). */
  function reportFill(s: FillSummary, where = "", note = "") {
    const d = describeFill(s, where);
    const text = note ? `${d.text} Then: ${note}` : d.text;
    const tone: Tone = note ? "warn" : d.tone;
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

  /** A toast button that copies page-structure info (no chat text) so a misbehaving chat site can be fixed. */
  const debugAction = (info: unknown) => ({
    label: "Copy debug info",
    run: async () => {
      const ok = await copyText(JSON.stringify(info, null, 2));
      toast(ok ? "Debug info copied. It has page structure only, no chat text." : "Couldn't copy the debug info.", ok ? "ok" : "error");
    },
  });

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
  const closeX = h("button", { class: "pclose", type: "button", title: "Close (Esc)", "aria-label": "Close" }, icon("x"));
  panel.append(h("div", { class: "ptitle" }, "Paste the AI's reply", closeX), ta, perr, h("div", { class: "prow" }, pasteClip, go));

  function openPanel(message = "") {
    hideToast();
    panel.hidden = false;
    dock.classList.add("peek");
    perr.textContent = message;
    ta.focus();
  }
  function closePanel() {
    const wasOpen = !panel.hidden || !picker.hidden;
    panel.hidden = true;
    picker.hidden = true;
    ta.value = "";
    perr.textContent = "";
    if (wasOpen && toastBox.hidden) dock.classList.remove("peek");
  }

  /** "Ask which chat?": a list of open chat tabs, shown every time. */
  function openPicker(tabs: ChatTab[], onPick: (t: ChatTab) => void) {
    hideToast();
    closePanel();
    const x = h("button", { class: "pclose", type: "button", title: "Close (Esc)", "aria-label": "Close" }, icon("x"));
    x.addEventListener("click", () => closePanel());
    const rows = tabs.map((t) => {
      const b = h("button", { class: "tabrow", type: "button" }, h("b", {}, t.host || "chat"), h("span", {}, t.title || "(untitled)"));
      b.addEventListener("click", () => {
        closePanel();
        onPick(t);
      });
      return b;
    });
    picker.replaceChildren(
      h("div", { class: "ptitle" }, "Ask which chat?", x),
      ...rows,
      h("div", { class: "pnote" }, "lazyBoi puts the form in that chat, presses Send, waits for the reply, and fills this page. You can undo."),
    );
    picker.hidden = false;
    dock.classList.add("peek");
    (rows[0] as HTMLElement | undefined)?.focus();
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
    if ((!panel.hidden || !picker.hidden) && !e.composedPath().includes(host)) closePanel();
  }) as EventListener, true);
  listen(document, "keydown", ((e: KeyboardEvent) => {
    if (e.key === "Escape" && (!panel.hidden || !picker.hidden)) closePanel();
  }) as EventListener, true);

  // ---- buttons ----
  if (opts.mode === "form") {
    const copyBtn = button("icon", icon("copy"), "Copy form", "Copy form: scans this page and copies a prompt for your AI chat.");
    const fillBtn = button("icon", icon("clipboard-check"), "Paste into form", "Paste into form: fills this form from the AI's reply. You can undo, and you press Submit yourself.");
    const aiBtn = button(
      "icon",
      icon("zap"),
      "Fill with AI",
      "Fill with AI: pick one of your open chat tabs. lazyBoi sends the form there, waits for the reply, and fills this page. You can undo.",
    );
    pill.append(aiBtn, copyBtn, fillBtn);

    let asking = false;
    guard(aiBtn, async () => {
      if (asking) return toast("Still waiting on the chat. This can take a minute.", "warn");
      const r = await backend.scanAndRegister(); // scan happens now, when you press the button
      if (!r.ok) return toast(r.error, "error");
      if (!r.schema.fields.length) return toast("No fillable fields found on this page.", "error");
      const t = await backend.chatTabs();
      if (!t.ok) return toast(t.error, "error");
      if (!t.tabs.length) return toast("No chat tab is open. Open claude.ai, ChatGPT or another supported chat, then press Fill with AI again.", "error");
      openPicker(t.tabs, async (tab) => {
        asking = true;
        toast(`Asking ${tab.host || "the chat"}… this can take a minute.`, "ok", undefined, true);
        try {
          const a = await backend.askChat(tab.tabId, r.schema.session);
          if (!a.ok) toast(a.error, "error", a.debug ? debugAction(a.debug) : undefined);
          else if (a.summary) {
            const rounds = a.rounds ?? 1;
            reportFill(a.summary, rounds > 1 ? ` in ${rounds} rounds, as new fields appeared` : "", a.note);
          }
        } catch (e) {
          toast(friendly(e), "error");
        } finally {
          asking = false;
        }
      });
    });

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
    listen(document, "lazyboi-filled", ((e: CustomEvent<FillSummary>) => {
      if (!asking) reportFill(e.detail); // while Fill with AI is working, the combined result is reported once at the end
    }) as EventListener);
  } else {
    const pasteBtn = button("word", "Paste", "Paste form", "Paste: puts the form you copied into this chat's message box. You press Send.");
    const copyBtn = button("word", "Copy", "Copy reply", "Copy: copies the AI's lazyBoi reply so your form can fill from it.");
    const hideInline = h("button", { class: "hide", type: "button", title: "Hide lazyBoi on this site", "aria-label": "Hide lazyBoi on this site" }, icon("x"));
    pill.append(h("div", { class: "btns" }, pasteBtn, copyBtn, hideInline), h("div", { class: "chip", "aria-hidden": "true" }, icon("star")));

    guard(pasteBtn, async () => {
      const r = await backend.latestForm();
      if (!r.ok) return toast(r.error, "error");
      const prompt = buildPrompt(r.schema);
      const status = tryInsert(prompt);
      if (status === "ok") return toast(`“${r.title}” is in the message box. Press Send.`);
      const copied = await copyText(prompt);
      const why = status === "no-box" ? "Couldn't find the message box" : "The message box didn't accept the text";
      toast(copied ? `${why}. The prompt is copied: paste it yourself.` : `${why}.`, copied ? "warn" : "error", debugAction(diagnose()));
    });

    guard(copyBtn, async () => {
      const found = findLatestReply();
      if (!found) return toast("No lazyBoi reply here yet. Wait until the chat finishes writing.", "error", debugAction(diagnose()));
      const clean = "```lazyboi\n" + JSON.stringify(found.reply) + "\n```";
      const copied = await copyText(clean);
      const q = await backend.queueReply(clean);
      if (!q.ok) return toast(`${copied ? "Copied, but " : ""}${q.error.charAt(0).toLowerCase()}${q.error.slice(1)}`, "warn");
      toast(`Reply copied. Press Paste into form on “${q.formTitle}”.`, "ok", {
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
    dock.classList.add("dragging");
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
    dock.classList.remove("dragging");
    savePrefs({ top: dock.getBoundingClientRect().top });
  };
  grip.addEventListener("pointerup", endDrag);
  grip.addEventListener("pointercancel", endDrag);

  void loadPrefs().then((p) => {
    if (opts.mode === "form" && typeof p.top === "number") dock.style.top = `${clampTop(p.top)}px`;
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
    cleanups.push(() => chrome.storage?.onChanged?.removeListener(onChanged));
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
    // Anchored by its right edge, so it unfolds leftwards on hover without moving the chip.
    const hgt = dock.offsetHeight;
    const c = findComposer();
    let right: number;
    let top: number;
    if (c) {
      const r = c.getBoundingClientRect();
      right = document.documentElement.clientWidth - r.right; // not innerWidth: that includes the scrollbar
      top = r.top - hgt - 10;
      if (top < 8) top = r.bottom + hgt + 18 <= window.innerHeight ? r.bottom + 10 : 8;
    } else {
      right = 16;
      top = window.innerHeight - hgt - 16;
    }
    // Keep the unfolded bar (about 210px) on screen even beside a very narrow message box.
    right = Math.min(right, document.documentElement.clientWidth - 8 - 210);
    dock.style.right = `${Math.max(8, right)}px`;
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

  // ---- form mode: notice forms, including ones that appear later (a modal), and give a small shake ----
  let hasForm = false;
  let lastCount = 0;
  let lastShake = 0;
  let cost = 0; // how long a count takes, so heavy pages are polled less often
  dock.addEventListener("animationend", (e) => {
    if ((e as AnimationEvent).animationName === "lbnudge") dock.classList.remove("notice");
  });
  const shake = () => {
    if (hiddenHere || Date.now() - lastShake < 5000) return;
    lastShake = Date.now();
    dock.classList.remove("notice");
    void dock.offsetWidth; // restart the animation
    dock.classList.add("notice");
    // animationend normally clears it; this covers a tab that was hidden while it played.
    window.setTimeout(() => dock.classList.remove("notice"), 4000);
  };
  const checkForForm = () => {
    if (!opts.countFields || document.visibilityState === "hidden") return;
    const t0 = performance.now();
    let n = 0;
    try {
      n = opts.countFields();
    } catch {
      return; // page not ready
    }
    cost = performance.now() - t0;
    const had = hasForm;
    hasForm = n >= 2;
    dock.classList.toggle("has-form", hasForm);
    // Shake when a form shows up, or when 3+ new fields appear at once (a modal opening on a busy page).
    if (hasForm && (!had || n - lastCount >= 3)) shake();
    lastCount = n;
  };
  if (opts.mode === "form" && opts.countFields) {
    const seen = new WeakSet<Node>();
    const observers: MutationObserver[] = [];
    let timer = 0;
    let poll = 0;
    // Pages like LinkedIn render modals inside open shadow roots, which a page-level observer can't see into.
    const watch = (root: Node) => {
      if (seen.has(root)) return;
      seen.add(root);
      const o = new MutationObserver(schedule);
      o.observe(root, { childList: true, subtree: true });
      observers.push(o);
    };
    const discover = (root: ParentNode) => {
      for (const el of Array.from(root.querySelectorAll("*"))) {
        if (el.id === WIDGET_HOST_ID) continue; // never watch ourselves
        const sr = el.shadowRoot;
        if (sr && !seen.has(sr)) {
          watch(sr);
          discover(sr);
        }
      }
    };
    // Count 600ms after the FIRST change in a burst (not the last: a page that never stops changing would
    // never get counted), and not more often than every ~1.2s, or every 40x a slow count's cost on heavy pages.
    let lastRun = 0;
    let runCost = 0;
    function schedule() {
      if (timer) return;
      const minGap = Math.max(1200, runCost * 40);
      const delay = Math.max(600, minGap - (Date.now() - lastRun));
      timer = window.setTimeout(() => {
        timer = 0;
        const t0 = performance.now();
        discover(document);
        checkForForm();
        runCost = performance.now() - t0;
        lastRun = Date.now();
      }, delay);
    }
    watch(document.documentElement);
    discover(document);
    window.setTimeout(() => {
      discover(document);
      checkForForm();
    }, 900); // once the page has settled
    // Safety net for changes no observer sees (a class toggle that reveals a hidden form); slower on heavy pages.
    const tick = () => {
      checkForForm();
      poll = window.setTimeout(tick, Math.min(12000, Math.max(2500, cost * 60)));
    };
    poll = window.setTimeout(tick, 2500);
    cleanups.push(() => {
      window.clearTimeout(timer);
      window.clearTimeout(poll);
      observers.forEach((o) => o.disconnect());
    });
  }

  // Modals must not see us as "outside": a click or focus change on the widget would otherwise close
  // the dialog (click-outside and focus-trap handlers). Keep these events from leaving the widget,
  // and don't let a press on a button steal focus from the dialog.
  for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "touchstart", "touchend", "focusin", "focusout", "contextmenu"]) {
    host.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === "mousedown") {
        const t = e.composedPath()[0] as HTMLElement | undefined;
        if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName)) e.preventDefault();
      }
    });
  }

  // Put the widget in the browser's top layer so a modal's overlay can't cover it. A native modal
  // <dialog> also blocks everything outside itself, so while one is open the widget lives inside it.
  const placeHost = () => {
    let dlg: Element | null = null;
    try {
      dlg = document.querySelector("dialog:modal");
    } catch {
      /* engine without :modal */
    }
    const parent: Element = dlg ?? document.documentElement;
    const moved = host.parentNode !== parent;
    if (moved) parent.append(host);
    try {
      const open = host.matches(":popover-open");
      if (!open || moved) {
        if (open) host.hidePopover();
        host.popover = "manual";
        host.showPopover();
      }
    } catch {
      /* no popover support; the max z-index still applies */
    }
  };
  placeHost();

  // Some sites (React hydration, client-side navigation) wipe elements they don't know about.
  // If that happens, put the widget back.
  let reattached = 0;
  const keepAttached = () => {
    if (!host.isConnected) {
      if (reattached >= 30) return;
      reattached++;
    }
    placeHost();
  };
  const rootObserver = new MutationObserver(() => {
    if (!host.isConnected) keepAttached();
  });
  rootObserver.observe(document.documentElement, { childList: true });
  const keepTimer = window.setInterval(keepAttached, 500);
  cleanups.push(() => {
    rootObserver.disconnect();
    window.clearInterval(keepTimer);
  });

  return {
    destroy() {
      cleanups.forEach((fn) => fn());
      host.remove();
    },
  };
}
