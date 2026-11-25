// Popup (PRD U1, U2, U5): scan, copy prompt, paste reply.
import type { GetStateResponse, PopupRequest, ReplyResponse, ScanResponse } from "../shared/messages";
import { getHiddenHosts, setHostHidden } from "../shared/prefs";
import { buildPrompt } from "../shared/protocol";
import type { SessionRecord } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const scanBtn = $<HTMLButtonElement>("scan");
const copyBtn = $<HTMLButtonElement>("copy");
const sessionBox = $<HTMLDivElement>("session");
const sessionMeta = $<HTMLDivElement>("session-meta");
const fieldList = $<HTMLUListElement>("fields");
const skippedBox = $<HTMLDivElement>("skipped");
const replyBox = $<HTMLTextAreaElement>("reply");
const pasteBtn = $<HTMLButtonElement>("paste");
const previewBtn = $<HTMLButtonElement>("preview");
const statusBox = $<HTMLDivElement>("status");

let tabId: number | undefined;
let session: SessionRecord | null = null;

function send<T>(msg: PopupRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

function setStatus(text: string, kind: "ok" | "error" | "info" = "info") {
  statusBox.textContent = text;
  statusBox.className = `status ${kind}`;
}

function render() {
  if (!session) {
    sessionBox.hidden = true;
    scanBtn.textContent = "Scan this form";
    return;
  }
  const { schema } = session;
  sessionBox.hidden = false;
  scanBtn.textContent = "Rescan";
  sessionMeta.textContent = `${session.id} · ${schema.fields.length} field${schema.fields.length === 1 ? "" : "s"} · ${session.status.replace("_", " ")}`;
  fieldList.replaceChildren(
    ...schema.fields.map((f) => {
      const li = document.createElement("li");
      li.textContent = `${f.group ? f.group + " › " : ""}${f.label}`;
      const t = document.createElement("span");
      t.className = "t";
      t.textContent = f.type;
      li.append(t);
      return li;
    }),
  );
  if (schema.skipped.length) {
    skippedBox.hidden = false;
    skippedBox.textContent = `Not touched (${schema.skipped.length}): ${schema.skipped.map((s) => `${s.label} [${s.reason}]`).join(", ")}`;
  } else skippedBox.hidden = true;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  if (tabId === undefined) return;

  // Per-site switch for the on-page dock.
  const showDock = $<HTMLInputElement>("show-dock");
  let hostName = "";
  try {
    hostName = new URL(tab?.url ?? "").hostname;
  } catch {
    /* no readable URL */
  }
  if (!hostName) showDock.disabled = true;
  else showDock.checked = !(await getHiddenHosts()).includes(hostName);
  showDock.addEventListener("change", () => void setHostHidden(hostName, !showDock.checked));
  const res = await send<GetStateResponse>({ kind: "popup:getState", tabId });
  if (res.ok) session = res.session;
  render();
}

scanBtn.addEventListener("click", async () => {
  if (tabId === undefined) return;
  scanBtn.disabled = true;
  setStatus("Scanning…");
  const res = await send<ScanResponse>({ kind: "popup:scan", tabId });
  scanBtn.disabled = false;
  if (!res.ok) return setStatus(res.error, "error");
  session = res.session;
  render();
  setStatus(session.schema.fields.length ? "Scanned. Copy the prompt into your AI chat." : "No fillable fields found on this page.", session.schema.fields.length ? "ok" : "error");
});

copyBtn.addEventListener("click", async () => {
  if (!session) return;
  try {
    await navigator.clipboard.writeText(buildPrompt(session.schema));
    await send({ kind: "popup:markCopied", session: session.id });
    session.status = "awaiting_reply";
    render();
    setStatus("Prompt copied. Paste it into your chat, then paste the AI's reply below.", "ok");
  } catch (e) {
    setStatus(`Couldn't copy: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
});

pasteBtn.addEventListener("click", async () => {
  try {
    replyBox.value = await navigator.clipboard.readText();
    replyBox.focus();
  } catch {
    setStatus("Clipboard access was blocked. Paste into the box with Ctrl+V.", "error");
  }
});

previewBtn.addEventListener("click", async () => {
  const text = replyBox.value;
  if (!text.trim()) return setStatus("Paste the AI's reply first.", "error");
  previewBtn.disabled = true;
  const res = await send<ReplyResponse>({ kind: "popup:reply", text, fallbackSession: session?.id });
  previewBtn.disabled = false;
  if (!res.ok) return setStatus(res.error, "error");
  setStatus(res.switchedTab ? "Preview opened on the form tab." : "Preview opened on the page.", "ok");
  replyBox.value = "";
  setTimeout(() => window.close(), 700);
});

void init();
