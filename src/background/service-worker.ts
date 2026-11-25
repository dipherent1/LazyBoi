// Session manager: creates sessions on scan, routes replies to the right tab by session ID,
// and serves the on-page widget (form pages and chat pages).
import type {
  ContentRequest,
  ContentScanResponse,
  Fail,
  PopupRequest,
  ReplyResponse,
  ScanResponse,
  StatusMessage,
  WidgetRequest,
} from "../shared/messages";
import { extractReply } from "../shared/protocol";
import { SESSION_TTL_MS, type SessionRecord } from "../shared/types";

const KEY = "sessions";
const PENDING = "pending";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function load(): Promise<Record<string, SessionRecord>> {
  const data = await chrome.storage.session.get(KEY);
  return (data[KEY] as Record<string, SessionRecord> | undefined) ?? {};
}

async function save(sessions: Record<string, SessionRecord>): Promise<void> {
  await chrome.storage.session.set({ [KEY]: sessions });
}

async function loadPending(): Promise<Record<string, string>> {
  const data = await chrome.storage.session.get(PENDING);
  return (data[PENDING] as Record<string, string> | undefined) ?? {};
}

async function savePending(p: Record<string, string>): Promise<void> {
  await chrome.storage.session.set({ [PENDING]: p });
}

function isLive(s: SessionRecord): boolean {
  return s.status !== "expired" && Date.now() - s.createdAt < SESSION_TTL_MS;
}

function newId(existing: Record<string, SessionRecord>): string {
  for (;;) {
    const id = "lb-" + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    if (!existing[id]) return id;
  }
}

async function update(id: string, patch: Partial<SessionRecord>): Promise<void> {
  const all = await load();
  const s = all[id];
  if (!s) return;
  all[id] = { ...s, ...patch, updatedAt: Date.now() };
  await save(all);
}

async function newestLive(filter: (s: SessionRecord) => boolean = () => true): Promise<SessionRecord | null> {
  const all = await load();
  return (
    Object.values(all)
      .filter((s) => isLive(s) && filter(s))
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function sendToTab<T>(tabId: number, msg: ContentRequest): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const pong = await sendToTab<{ ok: boolean }>(tabId, { kind: "lb:ping" });
    if (pong?.ok) return;
  } catch {
    /* not injected yet */
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function scanTab(tabId: number): Promise<ScanResponse> {
  try {
    await ensureContentScript(tabId);
  } catch {
    return { ok: false, error: "lazyBoi can't run on this page (browser pages, the Web Store and some PDFs are off limits)." };
  }
  const all = await load();
  const id = newId(all);
  let res: ContentScanResponse;
  try {
    res = await sendToTab<ContentScanResponse>(tabId, { kind: "lb:scan", session: id });
  } catch (e) {
    return { ok: false, error: `Couldn't scan the page: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return res;
  // A rescan replaces the tab's earlier sessions (their DOM bindings are gone).
  for (const s of Object.values(all)) if (s.tabId === tabId && s.status !== "expired") s.status = "expired";
  const tab = await chrome.tabs.get(tabId);
  const now = Date.now();
  const rec: SessionRecord = {
    id,
    tabId,
    url: tab.url ?? res.schema.page.url,
    title: res.schema.page.title || tab.title || "",
    schema: res.schema,
    status: "scanned",
    createdAt: now,
    updatedAt: now,
  };
  all[id] = rec;
  await save(all);
  return { ok: true, session: rec };
}

async function routeReply(text: string, fallbackSession?: string): Promise<ReplyResponse> {
  const ex = extractReply(text);
  if (!ex.ok) return ex;
  const notes: string[] = [];
  let sessionId = ex.reply.session;
  if (!sessionId) {
    if (!fallbackSession) return { ok: false, error: 'The reply has no "session" id, and there is no scanned form to match it to.' };
    sessionId = fallbackSession;
    notes.push(`The reply had no session id; matched it to the form (${sessionId}).`);
  }
  const all = await load();
  const rec = all[sessionId];
  if (!rec) return { ok: false, error: `No form session "${sessionId}". Copy the form again and re-ask the AI.` };
  if (!isLive(rec)) return { ok: false, error: `Session ${sessionId} has expired (rescanned, reloaded, or older than 30 minutes). Copy the form again.` };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(rec.tabId);
  } catch {
    await update(sessionId, { status: "expired" });
    return { ok: false, error: "The tab with that form was closed." };
  }

  try {
    const res = await sendToTab<{ ok: boolean; error?: string }>(rec.tabId, { kind: "lb:preview", session: sessionId, values: ex.reply.values, notes });
    if (!res?.ok) {
      await update(sessionId, { status: "expired" });
      return { ok: false, error: res?.error ?? "The form page didn't respond." };
    }
  } catch {
    await update(sessionId, { status: "expired" });
    return { ok: false, error: "The form page was reloaded or navigated away. Copy the form again." };
  }

  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const switchedTab = active?.id !== rec.tabId;
  if (switchedTab) {
    await chrome.tabs.update(rec.tabId, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  }
  await update(sessionId, { status: "previewing" });
  return { ok: true, session: sessionId, tabId: rec.tabId, switchedTab };
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

async function handlePopup(msg: PopupRequest): Promise<unknown> {
  switch (msg.kind) {
    case "popup:getState": {
      const rec = await newestLive((s) => s.tabId === msg.tabId);
      return { ok: true, session: rec };
    }
    case "popup:scan":
      return scanTab(msg.tabId);
    case "popup:markCopied":
      await update(msg.session, { status: "awaiting_reply" });
      return { ok: true };
    case "popup:reply":
      return routeReply(msg.text, msg.fallbackSession);
  }
}

// ---------------------------------------------------------------------------
// Widget (content scripts on form pages and chat pages)
// ---------------------------------------------------------------------------

async function handleWidget(msg: WidgetRequest, tabId: number): Promise<unknown> {
  switch (msg.kind) {
    case "w:scan":
      return scanTab(tabId);

    case "w:copied":
      await update(msg.session, { status: "awaiting_reply" });
      return { ok: true };

    case "w:latest": {
      const rec = await newestLive();
      if (!rec) return { ok: false, error: "No form copied yet. Open the form page and press 📋 first." } satisfies Fail;
      await update(rec.id, { status: "awaiting_reply" });
      return { ok: true, schema: rec.schema, title: rec.schema.page.title || rec.title || "your form" };
    }

    case "w:queue": {
      const ex = extractReply(msg.text);
      if (!ex.ok) return ex;
      const rec = ex.reply.session ? (await load())[ex.reply.session] : await newestLive();
      if (!rec || !isLive(rec)) {
        return { ok: false, error: `No open form matches ${ex.reply.session ?? "this reply"}. Copy the form again and re-ask.` } satisfies Fail;
      }
      const pending = await loadPending();
      pending[rec.id] = msg.text;
      await savePending(pending);
      return { ok: true, session: rec.id, formTitle: rec.schema.page.title || rec.title || "your form" };
    }

    case "w:fill": {
      const rec = await newestLive((s) => s.tabId === tabId);
      if (!rec) return { ok: false, code: "no_session", error: "Copy this form first (press 📋), then ask your AI." } satisfies Fail;
      const pending = await loadPending();
      const text = pending[rec.id];
      if (!text) return { ok: false, code: "no_reply", error: "No reply waiting." } satisfies Fail;
      delete pending[rec.id];
      await savePending(pending);
      return routeReply(text, rec.id);
    }

    case "w:reply": {
      const mine = await newestLive((s) => s.tabId === tabId);
      return routeReply(msg.text, mine?.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: PopupRequest | WidgetRequest | StatusMessage, sender, sendResponse) => {
  const fail = (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });

  if (msg?.kind === "lb:status") {
    // Only accept status updates from the tab that owns the session.
    void load().then((all) => {
      const s = all[msg.session];
      if (s && sender.tab?.id === s.tabId) void update(msg.session, { status: msg.status });
    });
    return;
  }
  if (msg?.kind?.startsWith("w:")) {
    if (sender.tab?.id === undefined) return;
    handleWidget(msg as WidgetRequest, sender.tab.id).then(sendResponse, fail);
    return true;
  }
  if (!msg?.kind?.startsWith("popup:") || sender.tab) return; // popup messages only from extension pages
  handlePopup(msg as PopupRequest).then(sendResponse, fail);
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void load().then(async (all) => {
    const pending = await loadPending();
    let changed = false;
    for (const [id, s] of Object.entries(all)) {
      if (s.tabId === tabId) {
        delete all[id];
        delete pending[id];
        changed = true;
      }
    }
    if (changed) {
      await save(all);
      await savePending(pending);
    }
  });
});
