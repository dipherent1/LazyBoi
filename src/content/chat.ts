// Chat-page helpers: find the message box, put text in it (never sends), find the AI's lazyBoi reply.
import { extractReply } from "../shared/protocol";
import type { Reply } from "../shared/types";
import { fire, setNative } from "./filler";
import { WIDGET_HOST_ID } from "./scanner";

export { CHAT_HOSTS, isChatHost } from "../shared/chat-hosts";

const CANDIDATES = "textarea, [contenteditable]:not([contenteditable='false'])";
// Known message boxes first (ChatGPT, Claude and other rich composers), then a general heuristic.
const KNOWN_COMPOSERS = ["#prompt-textarea", "div.ProseMirror[contenteditable='true']", "[contenteditable='true'][role='textbox']"];

function usable(el: HTMLElement): boolean {
  if (el.closest(`#${WIDGET_HOST_ID}`)) return false;
  const c = el as HTMLTextAreaElement;
  if (c.readOnly || c.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 80 || r.height < 14) return false;
  const cv = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof cv === "function" ? cv.call(el) : true;
}

/** Lowest on screen first, then widest. */
function lowestFirst(list: HTMLElement[]): HTMLElement[] {
  return [...list].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.bottom - ra.bottom || rb.width - ra.width;
  });
}

/** The message box: a known composer if the page has one, otherwise the lowest text input on screen. */
export function findComposer(doc: Document = document): HTMLElement | null {
  for (const sel of KNOWN_COMPOSERS) {
    const hit = lowestFirst(Array.from(doc.querySelectorAll<HTMLElement>(sel)).filter(usable))[0];
    if (hit) return hit;
  }
  return lowestFirst(Array.from(doc.querySelectorAll<HTMLElement>(CANDIDATES)).filter(usable))[0] ?? null;
}

export type InsertStatus = "ok" | "no-box" | "rejected";

// ChatGPT is the one chat where a synthetic paste of a big prompt is risky (it can turn long pastes into an
// attachment), so there we type the text in line by line instead. Everywhere else, paste first.
const TYPED_HOSTS = ["chatgpt.com", "chat.openai.com"];

/** Put text in the message box without sending it. */
export function tryInsert(text: string, doc: Document = document): InsertStatus {
  const el = findComposer(doc);
  if (!el) return "no-box";
  el.focus();

  if (el.tagName === "TEXTAREA") {
    const ta = el as HTMLTextAreaElement;
    const prefix = ta.value && !ta.value.endsWith("\n") ? ta.value + "\n\n" : ta.value;
    setNative(ta, "value", prefix + text);
    fire(ta, "input");
    return "ok";
  }

  const probe = (text.split("\n")[0] ?? "").slice(0, 20);
  const has = () => (el.textContent ?? "").includes(probe);
  // Caret at the end, so anything the user already typed stays.
  const sel = doc.getSelection();
  const range = doc.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);

  const paste = () => {
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {
      /* ignore */
    }
  };
  const typed = () => {
    try {
      text.split("\n").forEach((line, i) => {
        if (i > 0) doc.execCommand("insertParagraph", false);
        if (line) doc.execCommand("insertText", false, line);
      });
    } catch {
      /* ignore */
    }
  };

  const host = doc.defaultView?.location.hostname ?? "";
  const typedFirst = TYPED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  for (const attempt of typedFirst ? [typed, paste] : [paste, typed]) {
    attempt();
    if (has()) return "ok";
  }
  return "rejected";
}

export function insertIntoComposer(text: string, doc: Document = document): boolean {
  return tryInsert(text, doc) === "ok";
}

const SEND_SELECTORS = [
  "button[data-testid='send-button']",
  "#composer-submit-button",
  "button[aria-label*='send' i]",
  "button[type='submit']",
];

/** The Send button belonging to a message box: search outward from the box for an enabled one. */
export function findSendButton(composer: HTMLElement): HTMLButtonElement | null {
  const ok = (b: HTMLButtonElement) => !b.disabled && b.getAttribute("aria-disabled") !== "true" && !b.closest(`#${WIDGET_HOST_ID}`);
  let node: HTMLElement | null = composer;
  // Climb a few levels, but never as far as <body>: a stray "Send" elsewhere on the page isn't this box's button.
  for (let i = 0; node && node.tagName !== "BODY" && node.tagName !== "HTML" && i < 7; i++, node = node.parentElement) {
    for (const sel of SEND_SELECTORS) {
      const b = Array.from(node.querySelectorAll<HTMLButtonElement>(sel)).find(ok);
      if (b) return b;
    }
    const byText = Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find((b) => ok(b) && /^send$/i.test((b.textContent ?? "").trim()));
    if (byText) return byText;
  }
  return null;
}

/** True while the chat is still writing its answer (a Stop button is showing). */
export function isStreaming(doc: Document = document): boolean {
  return !!doc.querySelector("[data-testid='stop-button'], button[aria-label*='stop' i]");
}

/** The most recent lazyBoi reply on the page (code blocks first, then any text). */
export function findLatestReply(doc: Document = document): { text: string; reply: Reply } | null {
  // Where the page marks assistant messages, only look there, so our own request is never mistaken for a reply.
  const assistant = Array.from(doc.querySelectorAll("[data-message-author-role='assistant']"));
  const roots: ParentNode[] = assistant.length ? assistant : [doc];
  const blocks = roots.flatMap((r) => Array.from(r.querySelectorAll("pre"))).filter((p) => !p.closest(`#${WIDGET_HOST_ID}`));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const t = blocks[i]!.textContent ?? "";
    if (!t.includes("values")) continue;
    const r = extractReply(t);
    if (r.ok) return { text: t, reply: r.reply };
  }
  const body = assistant.length
    ? assistant.map((a) => a.textContent ?? "").join("\n")
    : (doc.body?.innerText ?? doc.body?.textContent ?? "");
  const r = extractReply(body);
  return r.ok ? { text: body, reply: r.reply } : null;
}

/** Page structure only (no conversation text), so a broken chat site can be debugged. */
export function diagnose(doc: Document = document): Record<string, unknown> {
  const describe = (el: Element | null) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          role: el.getAttribute("role") || undefined,
          testid: el.getAttribute("data-testid") || undefined,
          aria: el.getAttribute("aria-label") || undefined,
          class: (el.getAttribute("class") ?? "").slice(0, 80) || undefined,
          editable: (el as HTMLElement).isContentEditable || undefined,
          width: Math.round(el.getBoundingClientRect().width),
          height: Math.round(el.getBoundingClientRect().height),
        }
      : null;
  const composer = findComposer(doc);
  const inputs = Array.from(doc.querySelectorAll<HTMLElement>(CANDIDATES)).slice(0, 8).map((e) => describe(e));
  return {
    host: doc.defaultView?.location.hostname,
    composer: describe(composer),
    sendButton: describe(composer ? findSendButton(composer) : null),
    candidateInputs: inputs,
    assistantMessages: doc.querySelectorAll("[data-message-author-role='assistant']").length,
    preBlocks: doc.querySelectorAll("pre").length,
    streaming: isStreaming(doc),
    userAgent: (doc.defaultView?.navigator.userAgent ?? "").slice(0, 90),
  };
}
