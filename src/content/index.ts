// Content script entry: runs on every page. It shows the floating widget, and answers scan / fill / undo / ask
// requests from the service worker.
import type { ContentRequest, StatusMessage } from "../shared/messages";
import { askChat } from "./ask";
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
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    /* extension was reloaded; this page needs a refresh */
  }
}

function handle(msg: ContentRequest): unknown {
  switch (msg.kind) {
    case "lb:ping":
      return { ok: true };
    case "lb:scan":
      return { ok: true, schema: controller.scan(msg.session) };
    case "lb:fill": {
      const r = controller.apply(msg.session, msg.values, msg.append);
      if (r.ok) sendStatus(msg.session);
      return r;
    }
    case "lb:rescan": {
      const r = controller.rescan();
      return r ? { ok: true, ...r } : { ok: false, error: "This page hasn't been scanned yet." };
    }
    case "lb:undo":
      return { ok: true, restored: controller.undo() };
    case "lb:ask":
      return askChat(msg.schema, msg.followUp); // a promise: answered when the reply arrives
  }
}

// After the extension is reloaded or updated, an old copy of this script can be left in an open tab with a
// dead connection (chrome.runtime is gone). Do nothing there; a refresh brings back a working copy.
const connected = typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.runtime.onMessage;
if (connected && !window.__lazyBoiContent) {
  window.__lazyBoiContent = true;
  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
    if (!msg || typeof msg.kind !== "string" || !msg.kind.startsWith("lb:")) return;
    const fail = (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) });
    try {
      const out = handle(msg);
      if (out instanceof Promise) {
        out.then(sendResponse, (e) => sendResponse(fail(e)));
        return true; // keep the channel open for the async answer
      }
      sendResponse(out);
    } catch (e) {
      sendResponse(fail(e));
    }
  });

  if (window.top === window) {
    const start = () =>
      mountWidget({ mode: isChatHost(location.hostname) ? "chat" : "form", backend: chromeBackend, countFields: () => controller.peek() });
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  }
}
