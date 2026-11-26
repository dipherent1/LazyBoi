// Playground harness: runs the same scanner/filler/widget directly in a page, without the extension.
// Loaded by playground pages when the URL has ?harness. Exposes window.lazyBoi for manual and automated tests.
import { buildPrompt, extractReply } from "./shared/protocol";
import type { FieldValue, FormSchema } from "./shared/types";
import { createLocalBackend } from "./content/backend-local";
import { fill, undo, type Snapshot } from "./content/filler";
import { FormController } from "./content/session";
import { mountWidget } from "./content/widget";

const controller = new FormController();
let lastSnapshot: Snapshot | null = null;

const newId = () => "lb-" + Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");

function requireScan() {
  if (!controller.current) throw new Error("Call lazyBoi.scan() first.");
  return controller.current;
}

const api = {
  scan: (session = newId()): FormSchema => controller.scan(session),
  prompt: () => buildPrompt(requireScan().schema),
  extract: extractReply,
  /** Apply pasted chat text or a values object to the form (no preview step). */
  apply(input: string | Record<string, FieldValue>) {
    const c = requireScan();
    let values: Record<string, FieldValue>;
    if (typeof input === "string") {
      const ex = extractReply(input);
      if (!ex.ok) throw new Error(ex.error);
      if (ex.reply.session && ex.reply.session !== c.schema.session) {
        throw new Error(`Session mismatch: reply is for ${ex.reply.session}, page is ${c.schema.session}.`);
      }
      values = ex.reply.values;
    } else values = input;
    const r = controller.apply(c.session, values);
    if (!r.ok) throw new Error(r.error);
    return r.summary;
  },
  /** Fill directly, no overlay (for automated checks). */
  fill(values: Record<string, FieldValue>) {
    const c = requireScan();
    const items = Object.entries(values).flatMap(([id, value]) => {
      const binding = c.bindings.get(id);
      return binding ? [{ binding, value }] : [];
    });
    const { results, snapshot } = fill(items, { highlight: false });
    lastSnapshot = snapshot;
    return results;
  },
  undo: () => (lastSnapshot ? undo(lastSnapshot) : 0),
  /** Find a field id by (partial) label, for tests. */
  id(label: string, group?: string) {
    const f = requireScan().schema.fields.find(
      (x) => x.label.toLowerCase().includes(label.toLowerCase()) && (!group || (x.group ?? "").toLowerCase().includes(group.toLowerCase())),
    );
    return f?.id;
  },
};

declare global {
  interface Window {
    lazyBoi: typeof api;
  }
}
window.lazyBoi = api;

const chatMode = location.pathname.endsWith("/chat.html");
const start = () => mountWidget({ mode: chatMode ? "chat" : "form", backend: createLocalBackend(controller) });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
