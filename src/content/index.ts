// Content script entry: runs on every page. It answers scan/preview requests from the service worker
// and shows the on-page widget (form pages: when there are fields; chat pages: always).
import type { ContentRequest, StatusMessage } from "../shared/messages";
import { chromeBackend } from "./backend-chrome";
import { isChatHost } from "./chat";
import { FormController } from "./session";
import { mountWidget } from "./widget";

declare global {
  interface Window {
    __lazyBoiContent?: boolean;
  }
}

const controller = new FormController();

function sendStatus(session: string, status: StatusMessage["status"]) {
  const msg: StatusMessage = { kind: "lb:status", session, status };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function handle(msg: ContentRequest): unknown {
  switch (msg.kind) {
    case "lb:ping":
      return { ok: true };
    case "lb:scan":
      return { ok: true, schema: controller.scan(msg.session) };
    case "lb:preview":
      return controller.preview(msg.session, msg.values, msg.notes, (s) => sendStatus(msg.session, s));
  }
}

if (!window.__lazyBoiContent) {
  window.__lazyBoiContent = true;
  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
    if (!msg || typeof msg.kind !== "string" || !msg.kind.startsWith("lb:")) return;
    try {
      sendResponse(handle(msg));
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  if (window.top === window) {
    const start = () =>
      mountWidget({
        mode: isChatHost(location.hostname) ? "chat" : "form",
        backend: chromeBackend,
        countFields: () => controller.peek(),
      });
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
}
