import type { ScanResponse, WidgetRequest } from "../shared/messages";
import type { WidgetBackend } from "./backend";

const send = <T>(msg: WidgetRequest) => chrome.runtime.sendMessage(msg) as Promise<T>;

export const chromeBackend: WidgetBackend = {
  async scanAndRegister() {
    const r = await send<ScanResponse>({ kind: "w:scan" });
    return r.ok ? { ok: true, schema: r.session.schema } : r;
  },
  async markCopied(session) {
    await send({ kind: "w:copied", session });
  },
  fillFromPending: () => send({ kind: "w:fill" }),
  submitReply: (text) => send({ kind: "w:reply", text }),
  latestForm: () => send({ kind: "w:latest" }),
  queueReply: (text) => send({ kind: "w:queue", text }),
  undo: () => send({ kind: "w:undo" }),
  chatTabs: () => send({ kind: "w:chatTabs" }),
  askChat: (tabId, session) => send({ kind: "w:ask", tabId, session }),
};
