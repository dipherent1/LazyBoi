// Content script entry: runs on every page. It shows the floating widget, and answers scan / fill / undo
// requests from the service worker.
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

function sendStatus(session: string) {
  const msg: StatusMessage = { kind: "lb:status", session, status: "filled" };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function handle(msg: ContentRequest): unknown {
  switch (msg.kind) {
    case "lb:ping":
      return { ok: true };
    case "lb:scan":
      return { ok: true, schema: controller.scan(msg.session) };
    case "lb:fill": {
      const r = controller.apply(msg.session, msg.values);
      if (r.ok) sendStatus(msg.session);
      return r;
    }
    case "lb:undo":
      return { ok: true, restored: controller.undo() };
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
    const start = () => mountWidget({ mode: isChatHost(location.hostname) ? "chat" : "form", backend: chromeBackend });
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
}
