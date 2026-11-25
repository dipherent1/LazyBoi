// Filler: writes values so framework-controlled inputs register them (PRD F1–F6), plus undo.
import type { FieldValue } from "../shared/types";
import type { Binding } from "./scanner";

export type FillStatus = "filled" | "skipped" | "not_found" | "invalid";

export interface FillResult {
  fieldId: string;
  label: string;
  status: FillStatus;
  message?: string;
}

/** Previous state used by undo. Rich text keeps its HTML. */
type SnapValue = FieldValue | { html: string };

export interface Snapshot {
  entries: { binding: Binding; value: SnapValue }[];
}

// ---------------------------------------------------------------------------
// Low-level DOM helpers
// ---------------------------------------------------------------------------

function nativeSetter(el: Element, prop: "value" | "checked"): ((v: unknown) => void) | undefined {
  // Walk the prototype chain so instance-level overrides (React's value tracker) are bypassed.
  for (let proto = Object.getPrototypeOf(el); proto; proto = Object.getPrototypeOf(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc?.set) return desc.set;
  }
  return undefined;
}

export function setNative(el: Element, prop: "value" | "checked", v: unknown): void {
  const set = nativeSetter(el, prop);
  if (set) set.call(el, v);
  else (el as unknown as Record<string, unknown>)[prop] = v;
}

export function fire(el: Element, type: string): void {
  const view = el.ownerDocument.defaultView ?? window;
  const ev =
    type === "input" && typeof view.InputEvent === "function"
      ? new view.InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText" })
      : new view.Event(type, { bubbles: true, composed: true });
  el.dispatchEvent(ev);
}

function focus(el: HTMLElement): void {
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
}

function blur(el: HTMLElement): void {
  fire(el, "blur");
  fire(el, "focusout");
}

function toggleTo(el: HTMLInputElement, want: boolean): void {
  if (el.checked === want) return;
  el.click(); // fires input/change the way frameworks expect
  if (el.checked !== want) {
    setNative(el, "checked", want);
    fire(el, "input");
    fire(el, "change");
  }
}

function flash(els: HTMLElement[]): void {
  for (const el of els) {
    const target = (el as HTMLInputElement).type === "radio" || (el as HTMLInputElement).type === "checkbox" ? el.closest("label") ?? el : el;
    const t = target as HTMLElement;
    const prev = t.style.outline;
    const prevOffset = t.style.outlineOffset;
    t.style.outline = "2px solid #7c5cff";
    t.style.outlineOffset = "2px";
    setTimeout(() => {
      t.style.outline = prev;
      t.style.outlineOffset = prevOffset;
    }, 1600);
  }
}

// ---------------------------------------------------------------------------
// Read / write per binding kind
// ---------------------------------------------------------------------------

export function readValue(b: Binding): FieldValue {
  const el = b.elements[0]!;
  switch (b.kind) {
    case "input":
    case "textarea":
      return (el as HTMLInputElement).value;
    case "select": {
      const sel = el as HTMLSelectElement;
      return sel.multiple ? Array.from(sel.selectedOptions).map((o) => o.value) : sel.value;
    }
    case "radio": {
      const i = b.elements.findIndex((e) => (e as HTMLInputElement).checked);
      return i >= 0 ? b.field.options?.[i]?.value ?? "" : "";
    }
    case "checkbox":
      return (el as HTMLInputElement).checked;
    case "checkbox-group":
      return b.elements.flatMap((e, i) => ((e as HTMLInputElement).checked ? [b.field.options?.[i]?.value ?? ""] : []));
    case "richtext":
      return (el.textContent ?? "").trim();
  }
}

function snapshotValue(b: Binding): SnapValue {
  return b.kind === "richtext" ? { html: b.elements[0]!.innerHTML } : readValue(b);
}

const flat = (s: string) => s.replace(/\s+/g, "");

function writeRichText(el: HTMLElement, text: string): void {
  focus(el);
  const doc = el.ownerDocument;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let ok = false;
  try {
    const sel = doc.getSelection();
    if (sel && typeof doc.execCommand === "function") {
      const range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // Editors (LinkedIn, Draft.js, ProseMirror…) understand typed text + paragraph breaks.
      ok = doc.execCommand("delete", false);
      lines.forEach((line, i) => {
        if (i > 0) ok = doc.execCommand("insertParagraph", false) && ok;
        if (line) ok = doc.execCommand("insertText", false, line) && ok;
      });
    }
  } catch {
    ok = false;
  }
  if (!ok || flat(el.textContent ?? "") !== flat(text)) {
    el.replaceChildren(...lines.flatMap((line, i) => (i ? [doc.createElement("br"), doc.createTextNode(line)] : [doc.createTextNode(line)])));
    fire(el, "input");
  }
  blur(el);
}

function write(b: Binding, value: SnapValue): void {
  const el = b.elements[0]!;
  if (typeof value === "object" && !Array.isArray(value)) {
    // Rich-text undo.
    el.innerHTML = value.html;
    fire(el, "input");
    return;
  }
  switch (b.kind) {
    case "input":
    case "textarea": {
      focus(el);
      setNative(el, "value", String(value));
      fire(el, "input");
      fire(el, "change");
      blur(el);
      return;
    }
    case "select": {
      const sel = el as HTMLSelectElement;
      focus(sel);
      if (sel.multiple) {
        const want = Array.isArray(value) ? value : [String(value)];
        for (const o of Array.from(sel.options)) o.selected = want.includes(o.value);
      } else {
        setNative(sel, "value", String(value));
      }
      fire(sel, "input");
      fire(sel, "change");
      blur(sel);
      return;
    }
    case "radio": {
      const i = b.field.options?.findIndex((o) => o.value === value) ?? -1;
      if (i >= 0) toggleTo(b.elements[i] as HTMLInputElement, true);
      else {
        // Undo to "nothing selected": radios can't be unchecked by clicking.
        for (const e of b.elements) {
          if ((e as HTMLInputElement).checked) {
            setNative(e, "checked", false);
            fire(e, "change");
          }
        }
      }
      return;
    }
    case "checkbox":
      toggleTo(el as HTMLInputElement, value === true);
      return;
    case "checkbox-group": {
      const want = Array.isArray(value) ? value : [];
      b.elements.forEach((e, i) => toggleTo(e as HTMLInputElement, want.includes(b.field.options?.[i]?.value ?? "\u0000")));
      return;
    }
    case "richtext":
      writeRichText(el, String(value));
      return;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FillItem {
  binding: Binding;
  value: FieldValue;
}

export function fill(items: FillItem[], opts: { highlight?: boolean } = {}): { results: FillResult[]; snapshot: Snapshot } {
  const results: FillResult[] = [];
  const snapshot: Snapshot = { entries: [] };
  for (const { binding, value } of items) {
    const base = { fieldId: binding.field.id, label: binding.field.label };
    if (!binding.elements.every((e) => e.isConnected)) {
      results.push({ ...base, status: "not_found", message: "Field is no longer on the page." });
      continue;
    }
    try {
      snapshot.entries.push({ binding, value: snapshotValue(binding) });
      write(binding, value);
      results.push({ ...base, status: "filled" });
      if (opts.highlight !== false) flash(binding.elements);
    } catch (e) {
      results.push({ ...base, status: "invalid", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results, snapshot };
}

export function undo(snapshot: Snapshot): number {
  let n = 0;
  for (const { binding, value } of [...snapshot.entries].reverse()) {
    if (!binding.elements.every((e) => e.isConnected)) continue;
    try {
      write(binding, value);
      n++;
    } catch {
      /* best effort */
    }
  }
  return n;
}
