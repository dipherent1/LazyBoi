// Playground-only backend: state lives in localStorage and tabs talk over a BroadcastChannel,
// so the form page and the mock chat page can run the whole loop without the extension installed.
import { extractReply } from "../shared/protocol";
import { runRounds, type RoundPorts } from "../shared/rounds";
import type { FieldValue, FormSchema } from "../shared/types";
import { askChat } from "./ask";
import type { ChatTab, Res, WidgetBackend } from "./backend";
import type { FormController } from "./session";

const KEY = "lazyboi.h.store";

interface Entry {
  id: string;
  schema: FormSchema;
  createdAt: number;
  page: string;
}
interface Store {
  sessions: Record<string, Entry>;
  pending: Record<string, string>;
}

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") as Store;
  } catch {
    return { sessions: {}, pending: {} };
  }
}
const write = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s));

export function createLocalBackend(controller: FormController): WidgetBackend {
  const pageId = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel("lazyboi-h");
  const isChat = location.pathname.endsWith("/chat.html");
  const chatId = Math.floor(Math.random() * 1e9);
  const heard = new Map<number, string>(); // chat pages that answered "who"
  const waiters = new Map<string, (m: { ok: boolean; text?: string; error?: string; debug?: unknown }) => void>();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  channel.onmessage = (e) => {
    const m = e.data as {
      kind?: string;
      page?: string;
      session?: string;
      values?: Record<string, FieldValue>;
      id?: number;
      title?: string;
      to?: number;
      reqId?: string;
      schema?: FormSchema;
      followUp?: boolean;
      ok?: boolean;
      text?: string;
      error?: string;
      debug?: unknown;
    };
    if (m?.kind === "fill" && m.page === pageId && m.session && m.values) controller.apply(m.session, m.values);
    if (m?.kind === "undo") controller.undo();
    // Stand-ins for chrome.tabs: chat pages announce themselves and run asks addressed to them.
    if (m?.kind === "who" && isChat) channel.postMessage({ kind: "here", id: chatId, title: document.title });
    if (m?.kind === "here" && typeof m.id === "number") heard.set(m.id, m.title ?? "");
    if (m?.kind === "ask" && isChat && m.to === chatId && m.schema && m.reqId) {
      const reqId = m.reqId;
      void askChat(m.schema, !!m.followUp, 30_000).then((r) => channel.postMessage({ kind: "asked", reqId, ...r }));
    }
    if (m?.kind === "asked" && m.reqId) waiters.get(m.reqId)?.({ ok: !!m.ok, text: m.text, error: m.error, debug: m.debug });
  };

  const newest = (pred: (e: Entry) => boolean = () => true): Entry | undefined =>
    Object.values(read().sessions)
      .filter(pred)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

  async function route(text: string, fallback?: string): Promise<Res<{ summary?: import("../shared/types").FillSummary }>> {
    const ex = extractReply(text);
    if (!ex.ok) return ex;
    const id = ex.reply.session ?? fallback;
    const entry = id ? read().sessions[id] : undefined;
    if (!id || !entry) return { ok: false, error: id ? `No form session "${id}". Copy the form again and re-ask the AI.` : "The reply has no session id." };
    if (entry.page === pageId) {
      const r = controller.apply(id, ex.reply.values);
      return r.ok ? { ok: true, summary: r.summary } : r;
    }
    channel.postMessage({ kind: "fill", page: entry.page, session: id, values: ex.reply.values });
    return { ok: true };
  }

  return {
    async scanAndRegister() {
      const id = "lb-" + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
      const schema = controller.scan(id);
      const store = read();
      store.sessions[id] = { id, schema, createdAt: Date.now(), page: pageId };
      write(store);
      return { ok: true, schema };
    },
    async markCopied() {},
    async fillFromPending() {
      const mine = newest((e) => e.page === pageId);
      if (!mine) return { ok: false, code: "no_session", error: "Copy this form first (press Copy form), then ask your AI." };
      const store = read();
      const text = store.pending[mine.id];
      if (!text) return { ok: false, code: "no_reply", error: "No reply waiting." };
      delete store.pending[mine.id];
      write(store);
      return route(text, mine.id);
    },
    submitReply: (text) => route(text, newest((e) => e.page === pageId)?.id),
    async latestForm() {
      const e = newest();
      if (!e) return { ok: false, error: "No form copied yet. Open the form page and press Copy form first." };
      return { ok: true, schema: e.schema, title: e.schema.page.title || "your form" };
    },
    async queueReply(text) {
      const ex = extractReply(text);
      if (!ex.ok) return ex;
      const entry = ex.reply.session ? read().sessions[ex.reply.session] : newest();
      if (!entry) return { ok: false, error: `No open form matches ${ex.reply.session ?? "this reply"}. Copy the form again and re-ask.` };
      const store = read();
      store.pending[entry.id] = text;
      write(store);
      return { ok: true, session: entry.id, formTitle: entry.schema.page.title || "your form" };
    },
    async undo() {
      const n = controller.undo();
      if (n === 0) channel.postMessage({ kind: "undo" });
      return { ok: true, restored: n };
    },
    async chatTabs() {
      heard.clear();
      channel.postMessage({ kind: "who" });
      await sleep(400);
      const tabs: ChatTab[] = [...heard].map(([tabId, title]) => ({ tabId, host: "mock-chat", title }));
      return { ok: true, tabs };
    },
    async askChat(tabId, session) {
      const entry = read().sessions[session];
      if (!entry) return { ok: false, error: "That form copy has expired. Press Fill with AI again." };
      const ports: RoundPorts = {
        async ask(schema, followUp) {
          const reqId = Math.random().toString(36).slice(2);
          const answer = new Promise<{ ok: boolean; text?: string; error?: string; debug?: unknown }>((resolve) => {
            waiters.set(reqId, resolve);
            setTimeout(() => resolve({ ok: false, error: "The chat tab didn't answer." }), 40_000);
          });
          channel.postMessage({ kind: "ask", to: tabId, reqId, schema, followUp });
          const res = await answer;
          waiters.delete(reqId);
          return res.ok && res.text ? { ok: true, text: res.text } : { ok: false, error: res.error ?? "The chat didn't answer.", debug: res.debug };
        },
        async fill(text, append) {
          const ex = extractReply(text);
          if (!ex.ok) return { ok: false, error: ex.error };
          const r = controller.apply(session, ex.reply.values, append);
          return r.ok ? { ok: true, summary: r.summary } : r;
        },
        async rescan() {
          const r = controller.rescan();
          return r ? { ok: true, ...r } : { ok: false, error: "This page hasn't been scanned yet." };
        },
      };
      const out = await runRounds(entry.schema, ports);
      return out.ok ? { ok: true, summary: out.summary, rounds: out.rounds, note: out.note } : { ok: false, error: out.error, debug: out.debug };
    },
  };
}
