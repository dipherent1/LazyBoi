// Runs inside a chat tab: put the form prompt in the message box, press Send, wait for lazyBoi's reply.
// Only ever triggered by the user pressing the Fill with AI button and picking this tab.
import { buildFollowUpPrompt, buildPrompt } from "../shared/protocol";
import type { FormSchema } from "../shared/types";
import { diagnose, findComposer, findLatestReply, findSendButton, isStreaming, tryInsert } from "./chat";

export type AskResult = { ok: true; text: string } | { ok: false; error: string; debug?: unknown };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const fail = (error: string): AskResult => ({ ok: false, error, debug: diagnose() });

function composerText(el: HTMLElement): string {
  return el.tagName === "TEXTAREA" ? (el as HTMLTextAreaElement).value : (el.textContent ?? "");
}

function pressEnter(el: HTMLElement) {
  for (const type of ["keydown", "keypress", "keyup"]) {
    el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }
}

/** Click Send (or press Enter) and confirm the message left the box. */
async function pressSend(probe: string): Promise<boolean> {
  const composer = findComposer();
  if (!composer) return false;
  const sent = () => {
    const c = findComposer();
    return !c || !composerText(c).includes(probe);
  };
  // The Send button usually enables a moment after the text lands.
  let btn: HTMLButtonElement | null = null;
  for (let i = 0; i < 30 && !btn; i++) {
    btn = findSendButton(composer);
    if (!btn) await sleep(100);
  }
  if (btn) btn.click();
  else pressEnter(composer);
  for (let i = 0; i < 40; i++) {
    if (sent()) return true;
    await sleep(100);
  }
  if (btn) {
    pressEnter(composer); // the click did nothing: try Enter
    for (let i = 0; i < 30; i++) {
      if (sent()) return true;
      await sleep(100);
    }
  }
  return sent();
}

/**
 * Wait until a reply for this session is on the page that differs from `baseline` (the previous reply, so a
 * follow-up round doesn't re-read the last answer), the chat has stopped writing, and the text is stable.
 */
export async function waitForReply(session: string, timeoutMs: number, baseline = ""): Promise<AskResult> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = "";
  while (Date.now() < deadline) {
    const found = findLatestReply();
    const text = found && found.reply.session === session ? JSON.stringify(found.reply) : "";
    if (text && text !== baseline && !isStreaming()) {
      if (text === lastSeen) return { ok: true, text: "```lazyboi\n" + text + "\n```" };
      lastSeen = text; // seen once; confirm on the next poll that it's complete
    } else lastSeen = "";
    await sleep(700);
  }
  return fail("No reply from the chat in time. If it's still writing, wait until it finishes, then press Copy on the chat page.");
}

export async function askChat(schema: FormSchema, followUp = false, timeoutMs = 120_000): Promise<AskResult> {
  const prompt = followUp ? buildFollowUpPrompt(schema) : buildPrompt(schema);
  const before = findLatestReply();
  const baseline = before && before.reply.session === schema.session ? JSON.stringify(before.reply) : "";
  const status = tryInsert(prompt);
  if (status === "no-box") return fail("Couldn't find this chat's message box.");
  if (status === "rejected") return fail("This chat's message box didn't accept the text.");
  const probe = (prompt.split("\n")[0] ?? "").slice(0, 20);
  if (!(await pressSend(probe))) {
    return fail("The form is in the chat's message box, but I couldn't press Send. Press Send yourself, then press Copy.");
  }
  return waitForReply(schema.session, timeoutMs, baseline);
}
