// Playground-only backend: state lives in localStorage and tabs talk over a BroadcastChannel,
// so the form page and the mock chat page can run the whole loop without the extension installed.
import { extractReply } from "../shared/protocol";
import type { FormSchema } from "../shared/types";
import type { Res, WidgetBackend } from "./backend";
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
  channel.onmessage = (e) => {
    const m = e.data as { kind?: string; page?: string; session?: string; values?: Record<string, never> };
    if (m?.kind === "preview" && m.page === pageId && m.session && m.values) controller.preview(m.session, m.values, []);
  };

  const newest = (pred: (e: Entry) => boolean = () => true): Entry | undefined =>
    Object.values(read().sessions)
      .filter(pred)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

  async function route(text: string, fallback?: string): Promise<Res> {
    const ex = extractReply(text);
    if (!ex.ok) return ex;
    const id = ex.reply.session ?? fallback;
    const entry = id ? read().sessions[id] : undefined;
    if (!id || !entry) return { ok: false, error: id ? `No form session "${id}". Copy the form again and re-ask the AI.` : "The reply has no session id." };
    if (entry.page === pageId) return controller.preview(id, ex.reply.values, []);
    channel.postMessage({ kind: "preview", page: entry.page, session: id, values: ex.reply.values });
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
      if (!mine) return { ok: false, code: "no_session", error: "Copy this form first (press 📋), then ask your AI." };
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
      if (!e) return { ok: false, error: "No form copied yet. Open the form page and press 📋 first." };
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
  };
}
