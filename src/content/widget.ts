// The on-page widget: a slim dock on the right edge.
//  • form pages: emoji buttons  📋 Copy form  ·  ✨ Fill form
//  • chat pages: word buttons   Paste (form → message box)  ·  Copy (AI reply → form)
// Every button explains itself on hover. Nothing is ever sent or submitted for you.
import { getHiddenHosts, HIDDEN_HOSTS_KEY, setHostHidden } from "../shared/prefs";
import { buildPrompt } from "../shared/protocol";
import type { WidgetBackend } from "./backend";
import { findComposer, findLatestReply, insertIntoComposer } from "./chat";
import { copyText, h } from "./dom";
import { WIDGET_HOST_ID } from "./scanner";

export interface WidgetOptions {
  mode: "form" | "chat";
  backend: WidgetBackend;
  /** Form mode: how many fillable fields the page has (widget stays hidden below 2). */
  countFields?: () => number;
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
.badge { position: absolute; right: -4px; bottom: -4px; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 10px;
  background: #22c55e; color: #052e13; font-size: 10.5px; font-weight: 800; display: flex; align-items: center; justify-content: center;
  border: 2px solid #1b182a; pointer-events: none; }
.btn[data-tip]::after { content: attr(data-tip); position: absolute; right: calc(100% + 14px); top: 50%;
  transform: translateY(-50%) translateX(6px); width: max-content; max-width: 240px; text-align: left; white-space: normal;
  font: 500 12px/1.45 system-ui, sans-serif; letter-spacing: 0; padding: 9px 11px; border-radius: 11px;
  background: #12101c; color: #ececf3; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 10px 28px rgba(0,0,0,.4);
  opacity: 0; pointer-events: none; transition: opacity .15s, transform .15s; }
.btn[data-tip]:hover::after { opacity: 1; transform: translateY(-50%); transition-delay: .25s; }
.toast, .panel { position: absolute; right: calc(100% + 12px); top: 0; background: #12101c; color: #ececf3;
  border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 12px 34px rgba(0,0,0,.42); font-size: 13px; line-height: 1.45; }
.toast { display: flex; align-items: center; gap: 9px; padding: 10px 12px; width: max-content; max-width: 300px; }
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
.perr { color: #fca5a5; font-size: 12px; min-height: 0; margin-top: 6px; }
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

export function mountWidget(opts: WidgetOptions): { refresh(): void; destroy(): void } {
  document.getElementById(WIDGET_HOST_ID)?.remove();
  const { backend } = opts;
  const host = h("div", { id: WIDGET_HOST_ID });
  const root = host.attachShadow({ mode: "open" });
  root.append(h("style", {}, CSS));

  // Tucked away by default: only a thin edge shows until you hover it.
  const dock = h("div", { class: opts.mode === "chat" ? "dock off inline" : "dock off collapsed" });
  const pill = h("div", { class: "pill" });
  const grip = h("div", { class: "grip", title: "Drag to move · double-click to tuck away" }, "⋮⋮");
  const toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  toastBox.hidden = true;
  const panel = h("div", { class: "panel" });
  panel.hidden = true;
  dock.append(toastBox, panel, pill);
  const hideBtn = h("button", { class: "hide", type: "button", title: "Hide lazyBoi on this site", "aria-label": "Hide lazyBoi on this site" }, "×");
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
    toastTimer = window.setTimeout(hideToast, action ? 7000 : 3500);
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

  // ---- paste panel (form mode fallback when no reply is waiting) ----
  const ta = h("textarea", { placeholder: "Paste the AI's reply here (the whole message is fine)", "aria-label": "AI reply" });
  const perr = h("div", { class: "perr" });
  const pasteClip = h("button", { class: "mini", type: "button" }, "Paste clipboard");
  const go = h("button", { class: "mini primary", type: "button" }, "Preview & fill");
  const closeX = h("button", { class: "pclose", type: "button", title: "Close (Esc)", "aria-label": "Close" }, "×");
  panel.append(h("div", { class: "ptitle" }, "Paste the AI's reply", closeX), ta, perr, h("div", { class: "prow" }, pasteClip, go));
  closeX.addEventListener("click", () => closePanel());

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
      if (r.ok) closePanel();
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
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!panel.hidden && !e.composedPath().includes(host)) closePanel();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && !panel.hidden) closePanel();
    },
    true,
  );

  // ---- buttons ----
  let badge: HTMLElement | null = null;

  if (opts.mode === "form") {
    const copyBtn = button("emoji", "📋", "Copy form", "Copy form: reads this page's fields and copies a prompt for your AI chat.");
    const fillBtn = button("emoji", "✨", "Fill form", "Fill form: shows the AI's reply as a preview and fills this form. You still press Submit.");
    badge = h("span", { class: "badge" }, "0");
    copyBtn.append(badge);
    pill.append(copyBtn, fillBtn);

    guard(copyBtn, async () => {
      const r = await backend.scanAndRegister();
      if (!r.ok) return toast(r.error, "error");
      const n = r.schema.fields.length;
      if (!n) return toast("No fillable fields found on this page.", "error");
      if (!(await copyText(buildPrompt(r.schema)))) return toast("Couldn't copy to the clipboard.", "error");
      await backend.markCopied(r.schema.session);
      toast(`Copied ${n} field${n === 1 ? "" : "s"}. Press Paste in your AI chat.`);
    });

    guard(fillBtn, async () => {
      const r = await backend.fillFromPending();
      if (r.ok) return;
      if (r.code === "no_session") return toast(r.error, "error");
      openPanel(); // nothing waiting: let the user paste a reply
    });
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
          toast(r.ok ? "Preview opened on the form tab." : r.error, r.ok ? "ok" : "error");
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
    if (p.collapsed === false) dock.classList.remove("collapsed"); // only open if the user left it open
  });

  // ---- visibility ----
  let tooFew = opts.mode === "form";
  let overlayOpen = false;
  let hiddenHere = false;
  const hostName = location.hostname;
  const applyVisibility = () => dock.classList.toggle("off", tooFew || overlayOpen || hiddenHere);
  void getHiddenHosts().then((list) => {
    hiddenHere = list.includes(hostName);
    applyVisibility();
  });
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      const c = changes[HIDDEN_HOSTS_KEY];
      if (area === "local" && c) {
        hiddenHere = ((c.newValue as string[] | undefined) ?? []).includes(hostName);
        applyVisibility();
      }
    });
  }
  const onHide = () => {
    toast("Hidden on this site. Turn it back on from the lazyBoi toolbar icon.");
    window.setTimeout(() => {
      void setHostHidden(hostName, true).then(() => {
        hiddenHere = true;
        applyVisibility();
      });
    }, 2600);
  };
  dock.querySelectorAll(".hide").forEach((b) => b.addEventListener("click", onHide));
  document.addEventListener("lazyboi-overlay", ((e: CustomEvent<{ open: boolean }>) => {
    overlayOpen = e.detail.open;
    applyVisibility();
  }) as EventListener);

  function refresh() {
    if (opts.mode !== "form" || !opts.countFields) return;
    const n = opts.countFields();
    if (badge) badge.textContent = n > 99 ? "99+" : String(n);
    tooFew = n < 2;
    applyVisibility();
  }

  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 700);
  };
  const observer = new MutationObserver(schedule);
  if (opts.mode === "form") {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class", "disabled"] });
  }
  applyVisibility();
  refresh();

  document.documentElement.append(host);

  // Chat mode: sit just above the message box, right-aligned, and follow it as it moves or grows.
  let placeTimer = 0;
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
  if (opts.mode === "chat") {
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        place();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("input", schedule, true);
    placeTimer = window.setInterval(place, 700);
    place();
    void getHiddenHosts().then(schedule);
  }

  return {
    refresh,
    destroy() {
      observer.disconnect();
      window.clearInterval(placeTimer);
      host.remove();
    },
  };
}
