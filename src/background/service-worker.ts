// Session manager: creates sessions when a form is copied, routes replies to the right tab by session ID,
// and serves the on-page widget (form pages and chat pages).
import type { ContentRequest, ContentScanResponse, Fail, ReplyResponse, ScanResponse, StatusMessage, WidgetRequest } from "../shared/messages";
import { CHAT_HOSTS } from "../shared/chat-hosts";
import { extractReply } from "../shared/protocol";
import { emptySummary, runRounds, type RoundPorts } from "../shared/rounds";
import { SESSION_TTL_MS, type FillSummary, type FormSchema, type SessionRecord } from "../shared/types";

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

async function scanTab(tabId: number): Promise<ScanResponse> {
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

async function routeReply(text: string, fallbackSession?: string, append = false): Promise<ReplyResponse> {
  const ex = extractReply(text);
  if (!ex.ok) return ex;
  const sessionId = ex.reply.session ?? fallbackSession;
  if (!sessionId) return { ok: false, error: 'The reply has no "session" id, and there is no copied form to match it to.' };
  const all = await load();
  const rec = all[sessionId];
  if (!rec) return { ok: false, error: `No form session "${sessionId}". Copy the form again and re-ask the AI.` };
  if (!isLive(rec)) return { ok: false, error: `Session ${sessionId} has expired (recopied, reloaded, or older than 30 minutes). Copy the form again.` };

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(rec.tabId);
  } catch {
    await update(sessionId, { status: "expired" });
    return { ok: false, error: "The tab with that form was closed." };
  }

  let summary: FillSummary | undefined;
  try {
    const res = await sendToTab<{ ok: boolean; error?: string; summary?: FillSummary }>(rec.tabId, {
      kind: "lb:fill",
      session: sessionId,
      values: ex.reply.values,
      append,
    });
    if (!res?.ok) {
      await update(sessionId, { status: "expired" });
      return { ok: false, error: res?.error ?? "The form page didn't respond." };
    }
    summary = res.summary;
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
  await update(sessionId, { status: "filled" });
  return { ok: true, session: sessionId, tabId: rec.tabId, switchedTab, summary };
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
      if (!rec) return { ok: false, error: "No form copied yet. Open the form page and press Copy form first." } satisfies Fail;
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
      if (!rec) return { ok: false, code: "no_session", error: "Copy this form first (press Copy form), then ask your AI." } satisfies Fail;
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

    case "w:chatTabs": {
      const found = await chrome.tabs.query({ url: CHAT_HOSTS.map((h) => `*://*.${h}/*`) });
      const tabs = found
        .filter((t) => t.id !== undefined && t.id !== tabId)
        .sort((a, b) => ((b as { lastAccessed?: number }).lastAccessed ?? 0) - ((a as { lastAccessed?: number }).lastAccessed ?? 0))
        .map((t) => {
          let host = "";
          try {
            host = new URL(t.url ?? "").hostname;
          } catch {
            /* keep empty */
          }
          return { tabId: t.id!, host, title: t.title ?? "" };
        });
      return { ok: true, tabs };
    }

    case "w:ask": {
      const rec = (await load())[msg.session];
      if (!rec || !isLive(rec)) return { ok: false, error: "That form copy has expired. Press Fill with AI again." } satisfies Fail;
      const back = async () => {
        try {
          await chrome.tabs.update(rec.tabId, { active: true });
        } catch {
          /* form tab gone */
        }
      };
      // Bring the chat forward while it works: you see it answer, and background tabs get throttled.
      const focusChat = async () => {
        try {
          await chrome.tabs.update(msg.tabId, { active: true });
          const t = await chrome.tabs.get(msg.tabId);
          if (t.windowId !== undefined) await chrome.windows.update(t.windowId, { focused: true });
          return true;
        } catch {
          return false;
        }
      };
      const ports: RoundPorts = {
        async ask(schema, followUp) {
          if (!(await focusChat())) return { ok: false, error: "That chat tab was closed." };
          try {
            const res = await sendToTab<{ ok: boolean; text?: string; error?: string; debug?: unknown }>(msg.tabId, { kind: "lb:ask", schema, followUp });
            if (!res?.ok || !res.text) return { ok: false, error: res?.error ?? "The chat didn't answer.", debug: res?.debug };
            return { ok: true, text: res.text };
          } catch {
            return { ok: false, error: "Couldn't reach that chat tab. Reload it and try again." };
          }
        },
        async fill(text, append) {
          const r = await routeReply(text, rec.id, append); // switches back to the form tab and fills
          return r.ok ? { ok: true, summary: r.summary ?? emptySummary() } : { ok: false, error: r.error };
        },
        async rescan() {
          try {
            const r = await sendToTab<{ ok: boolean; schema: FormSchema; newFieldIds: string[] }>(rec.tabId, { kind: "lb:rescan" });
            if (!r?.ok) return { ok: false, error: "Couldn't rescan the form." };
            await update(rec.id, { schema: r.schema });
            return { ok: true, schema: r.schema, newFieldIds: r.newFieldIds };
          } catch {
            return { ok: false, error: "The form page didn't respond." };
          }
        },
      };
      const out = await runRounds(rec.schema, ports);
      await back(); // a later round may have left us on the chat tab
      if (!out.ok) return { ok: false, error: out.error, debug: out.debug } satisfies Fail;
      await update(rec.id, { status: "filled" });
      return { ok: true, session: rec.id, tabId: rec.tabId, switchedTab: false, summary: out.summary, rounds: out.rounds, note: out.note };
    }

    case "w:undo": {
      const rec = await newestLive((s) => s.status === "filled");
      if (!rec) return { ok: false, error: "Nothing to undo." } satisfies Fail;
      try {
        const r = await sendToTab<{ ok: boolean; restored: number }>(rec.tabId, { kind: "lb:undo" });
        return r?.ok ? { ok: true, restored: r.restored } : ({ ok: false, error: "Couldn't undo." } satisfies Fail);
      } catch {
        return { ok: false, error: "The form page was reloaded, so there's nothing to undo." } satisfies Fail;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: WidgetRequest | StatusMessage, sender, sendResponse) => {
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
});

// Chrome doesn't add a freshly installed or reloaded extension to tabs that were already open, so those tabs
// would have no widget until refreshed. Put the content script into them ourselves.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const t of tabs) {
      if (t.id === undefined || t.discarded) continue;
      try {
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] });
      } catch {
        /* a page we're not allowed into (Web Store, etc.) */
      }
    }
  })();
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
