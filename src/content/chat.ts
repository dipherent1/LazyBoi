// Chat-page helpers: find the message box, put text in it (never sends), find the AI's lazyBoi reply.
import { extractReply } from "../shared/protocol";
import type { Reply } from "../shared/types";
import { fire, setNative } from "./filler";
import { OVERLAY_HOST_ID, WIDGET_HOST_ID } from "./scanner";

export const CHAT_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "grok.com",
  "chat.mistral.ai",
  "poe.com",
];

export function isChatHost(host: string): boolean {
  return CHAT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

const CANDIDATES = "textarea, [contenteditable]:not([contenteditable='false'])";

function usable(el: HTMLElement): boolean {
  if (el.closest(`#${OVERLAY_HOST_ID}, #${WIDGET_HOST_ID}`)) return false;
  const c = el as HTMLTextAreaElement;
  if (c.readOnly || c.disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 80 || r.height < 14) return false;
  const cv = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof cv === "function" ? cv.call(el) : true;
}

/** The message box: the lowest text input on screen (ties go to the widest). */
export function findComposer(doc: Document = document): HTMLElement | null {
  const c = Array.from(doc.querySelectorAll<HTMLElement>(CANDIDATES)).filter(usable);
  c.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.bottom - ra.bottom || rb.width - ra.width;
  });
  return c[0] ?? null;
}

/** Put text in the message box without sending it. Returns false if nothing accepted it. */
export function insertIntoComposer(text: string, doc: Document = document): boolean {
  const el = findComposer(doc);
  if (!el) return false;
  el.focus();

  if (el.tagName === "TEXTAREA") {
    const ta = el as HTMLTextAreaElement;
    const prefix = ta.value && !ta.value.endsWith("\n") ? ta.value + "\n\n" : ta.value;
    setNative(ta, "value", prefix + text);
    fire(ta, "input");
    return true;
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

  // Rich composers (ProseMirror etc.) handle a paste event best, newlines included.
  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  } catch {
    /* ignore */
  }
  if (has()) return true;
  try {
    doc.execCommand("insertText", false, text);
  } catch {
    /* ignore */
  }
  return has();
}

/** The most recent lazyBoi reply on the page (code blocks first, then any text). */
export function findLatestReply(doc: Document = document): { text: string; reply: Reply } | null {
  const blocks = Array.from(doc.querySelectorAll("pre")).filter((p) => !p.closest(`#${WIDGET_HOST_ID}`));
  for (let i = blocks.length - 1; i >= 0; i--) {
    const t = blocks[i]!.textContent ?? "";
    if (!t.includes("values")) continue;
    const r = extractReply(t);
    if (r.ok) return { text: t, reply: r.reply };
  }
  const body = doc.body?.innerText ?? doc.body?.textContent ?? "";
  const r = extractReply(body);
  return r.ok ? { text: body, reply: r.reply } : null;
}
