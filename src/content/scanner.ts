// Scanner: turns the live page into a FormSchema plus bindings back to the DOM (PRD S1–S6).
// Uses tagName / property checks instead of instanceof so it works across iframe realms.
import type { Field, FieldOption, FieldType, FormSchema, SkippedField } from "../shared/types";
import { PROTOCOL_VERSION } from "../shared/types";
import { isSensitive } from "../shared/sensitive";

export const WIDGET_HOST_ID = "lazyboi-widget-host";

export type BindingKind = "input" | "textarea" | "select" | "radio" | "checkbox" | "checkbox-group" | "richtext";

export interface Binding {
  field: Field;
  kind: BindingKind;
  /** For radio / checkbox-group, elements[i] corresponds to field.options[i]. */
  elements: HTMLElement[];
}

export interface ScanResult {
  schema: FormSchema;
  bindings: Map<string, Binding>;
}

type InputLike = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Stable IDs across rescans for the same element.
const idCache = new WeakMap<Element, string>();

// ---------------------------------------------------------------------------
// Tree walk (light DOM + open shadow roots + same-origin iframes)
// ---------------------------------------------------------------------------

function collect(root: ParentNode, out: HTMLElement[]): void {
  for (const child of Array.from(root.children) as HTMLElement[]) {
    if (child.id === WIDGET_HOST_ID) continue;
    out.push(child);
    if (child.shadowRoot) collect(child.shadowRoot, out);
    if (child.tagName === "IFRAME") {
      try {
        const doc = (child as HTMLIFrameElement).contentDocument;
        if (doc?.documentElement) collect(doc, out);
      } catch {
        /* cross-origin: not reachable */
      }
    }
    collect(child, out);
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const clean = (s: string | null | undefined): string =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*[*:]+\s*$/, "")
    .replace(/^\s*[*]\s*/, "")
    .trim();

/** Text of an element excluding form controls inside it (e.g. a wrapping <label>). */
function textWithoutControls(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("input, select, textarea, button, script, style, [aria-hidden='true']").forEach((n) => n.remove());
  return clean(clone.textContent);
}

function humanize(s: string): string {
  return clean(
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-[\].]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  );
}

function byIdInRoot(el: Element, id: string): Element | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  return typeof root.getElementById === "function" ? root.getElementById(id) : null;
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}

function ariaLabel(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    const t = ids
      .split(/\s+/)
      .map((id) => byIdInRoot(el, id))
      .filter((n): n is Element => !!n)
      .map((n) => textWithoutControls(n))
      .join(" ");
    if (clean(t)) return clean(t);
  }
  return clean(el.getAttribute("aria-label"));
}

function labelElementText(el: HTMLElement): string {
  const labels = (el as InputLike).labels;
  if (labels && labels.length) {
    const t = textWithoutControls(labels[0]!);
    if (t) return t;
  }
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const lab = root.querySelector?.(`label[for="${cssEscape(el.id)}"]`);
    if (lab) {
      const t = textWithoutControls(lab);
      if (t) return t;
    }
  }
  const wrap = el.closest("label");
  if (wrap) return textWithoutControls(wrap);
  return "";
}

const CONTROL_SELECTOR = "input, select, textarea, [contenteditable]";

/** Nearest meaningful text before the element (siblings, then ancestors' siblings). */
function precedingText(el: Element, maxLevels = 3): string {
  const controlCount = (n: Element) => (n.matches(CONTROL_SELECTOR) ? 1 : 0) + n.querySelectorAll(CONTROL_SELECTOR).length;
  const own = controlCount(el);
  let node: Element | null = el;
  for (let level = 0; node && level < maxLevels; level++) {
    // Text before a container that also holds other fields describes that container, not this field.
    if (level > 0 && controlCount(node) > own) break;
    let sib: Node | null = node.previousSibling;
    while (sib) {
      if (sib.nodeType === 3) {
        const t = clean(sib.textContent);
        if (t) return t.slice(0, 120);
      } else if (sib.nodeType === 1) {
        const e = sib as Element;
        if (!e.matches(CONTROL_SELECTOR) && !e.querySelector(CONTROL_SELECTOR)) {
          const t = clean(e.textContent);
          if (t) return t.slice(0, 120);
        } else break;
      }
      sib = sib.previousSibling;
    }
    node = node.parentElement;
  }
  return "";
}

function labelFor(el: HTMLElement): string {
  return (
    ariaLabel(el) ||
    labelElementText(el) ||
    clean(el.getAttribute("placeholder")) ||
    clean(el.getAttribute("aria-placeholder")) ||
    clean(el.getAttribute("data-placeholder")) ||
    clean(el.getAttribute("title")) ||
    precedingText(el) ||
    humanize(el.getAttribute("name") || el.id || "")
  );
}

function parentAcrossShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return (root as ShadowRoot).host ?? null;
}

/** Section heading / fieldset legend enclosing the element. */
function groupFor(el: Element, ownLabel: string): string | undefined {
  let child: Element = el;
  let node = parentAcrossShadow(el);
  for (let depth = 0; node && depth < 10; depth++) {
    if (node.tagName === "BODY" || node.tagName === "HTML") break;
    if (node.tagName === "FIELDSET") {
      const legend = node.querySelector(":scope > legend");
      const t = legend ? clean(legend.textContent) : "";
      if (t && t !== ownLabel) return t;
    }
    const sectionLabel = node.getAttribute("data-section") || (node.tagName === "SECTION" || node.getAttribute("role") === "group" ? ariaLabel(node) : "");
    if (sectionLabel && clean(sectionLabel) !== ownLabel) return clean(sectionLabel);
    // A heading among the direct children that comes before the path we came from.
    for (const sib of Array.from(node.children)) {
      if (sib === child) break;
      // H1 is usually the page title, not a section.
      if (/^H[2-6]$/.test(sib.tagName) || (sib.getAttribute("role") === "heading" && sib.getAttribute("aria-level") !== "1")) {
        const t = clean(sib.textContent);
        if (t && t !== ownLabel) return t;
      }
    }
    child = node;
    node = parentAcrossShadow(node);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Element classification
// ---------------------------------------------------------------------------

function isEditableRoot(el: HTMLElement): boolean {
  const ce = el.getAttribute("contenteditable");
  if (ce === null || ce === "false") return false;
  const parent = el.parentElement?.closest("[contenteditable]");
  return !parent || parent.getAttribute("contenteditable") === "false";
}

function isRendered(el: HTMLElement): boolean {
  if (el.hidden || el.closest("[hidden]")) return false;
  const anyEl = el as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === "function") {
    return anyEl.checkVisibility({ visibilityProperty: true });
  }
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = parentAcrossShadow(n)) {
    const st = view?.getComputedStyle(n);
    if (st && (st.display === "none" || st.visibility === "hidden")) return false;
  }
  return true;
}

function isDisabled(el: HTMLElement): boolean {
  const c = el as InputLike;
  if (c.disabled) return true;
  if ((c as HTMLInputElement).readOnly) return true;
  if (el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-readonly") === "true") return true;
  return !!el.closest("fieldset[disabled]");
}

interface Classified {
  kind: BindingKind | "skip-file" | "skip-sensitive";
  type?: FieldType;
  format?: string;
}

const DATE_FORMATS: Record<string, string> = {
  date: "YYYY-MM-DD",
  month: "YYYY-MM",
  week: "YYYY-Www",
  time: "HH:MM",
  "datetime-local": "YYYY-MM-DDTHH:MM",
};

function classify(el: HTMLElement): Classified | null {
  const tag = el.tagName;
  if (tag === "INPUT") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "color"].includes(t)) return null;
    if (t === "file") return { kind: "skip-file" };
    if (t === "password") return { kind: "skip-sensitive" };
    if (t === "radio") return { kind: "radio", type: "radio" };
    if (t === "checkbox") return { kind: "checkbox", type: "checkbox" };
    if (t === "email" || t === "tel" || t === "url" || t === "number") return { kind: "input", type: t };
    if (t === "range") return { kind: "input", type: "number" };
    if (DATE_FORMATS[t]) return { kind: "input", type: "date", format: DATE_FORMATS[t] };
    return { kind: "input", type: "text" };
  }
  if (tag === "TEXTAREA") return { kind: "textarea", type: "textarea" };
  if (tag === "SELECT") return { kind: "select", type: (el as HTMLSelectElement).multiple ? "multiselect" : "select" };
  if (isEditableRoot(el)) return { kind: "richtext", type: "richtext" };
  return null;
}

function sensitive(el: HTMLElement, label: string): boolean {
  return isSensitive({
    type: (el as HTMLInputElement).type,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    texts: [label, el.getAttribute("name"), el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")],
  });
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

function assignId(el: Element, signature: string, used: Set<string>): string {
  const cached = idCache.get(el);
  if (cached && !used.has(cached)) {
    used.add(cached);
    return cached;
  }
  const base = "f" + hash(signature);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  idCache.set(el, id);
  return id;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function optionLabel(el: HTMLElement): string {
  return ariaLabel(el) || labelElementText(el) || clean(el.getAttribute("title")) || precedingText(el, 1) || clean((el as HTMLInputElement).value);
}

function choiceOption(el: HTMLInputElement): FieldOption {
  const label = optionLabel(el);
  const value = el.hasAttribute("value") && el.value !== "on" ? el.value : label;
  return { value, label: label || value };
}

function commonAncestor(els: Element[]): Element | null {
  if (!els.length) return null;
  let anc: Element | null = els[0]!.parentElement;
  while (anc && !els.every((e) => anc!.contains(e))) anc = anc.parentElement;
  return anc;
}

function groupQuestion(els: HTMLInputElement[]): string {
  const first = els[0]!;
  const fs = first.closest("fieldset");
  if (fs && els.every((e) => fs.contains(e))) {
    const legend = fs.querySelector(":scope > legend");
    if (legend && clean(legend.textContent)) return clean(legend.textContent);
  }
  const grp = first.closest("[role='radiogroup'], [role='group']");
  if (grp) {
    const t = ariaLabel(grp);
    if (t) return t;
  }
  const anc = commonAncestor(els);
  if (anc) {
    const t = ariaLabel(anc) || precedingText(anc);
    if (t) return t;
  }
  return humanize(first.name || first.id || "Choice");
}

function choiceRendered(el: HTMLInputElement): boolean {
  if (isRendered(el)) return true;
  const lab = el.labels?.[0] ?? el.closest("label");
  return !!lab && isRendered(lab as HTMLElement);
}

export function scanPage(session: string, doc: Document = document): ScanResult {
  const all: HTMLElement[] = [];
  collect(doc, all);

  const fields: Field[] = [];
  const skipped: SkippedField[] = [];
  const bindings = new Map<string, Binding>();
  const used = new Set<string>();

  // Pre-group radios and same-name checkboxes by (root, form, name).
  const rootIds = new Map<Node, number>();
  const formIds = new Map<Node, number>();
  const groupKey = (el: HTMLInputElement) => {
    const root = el.getRootNode();
    if (!rootIds.has(root)) rootIds.set(root, rootIds.size);
    const form = el.form ?? root;
    if (!formIds.has(form)) formIds.set(form, formIds.size);
    return `${el.type}|${rootIds.get(root)}|${formIds.get(form)}|${el.name}`;
  };
  const groups = new Map<string, HTMLInputElement[]>();
  for (const el of all) {
    if (el.tagName !== "INPUT") continue;
    const inp = el as HTMLInputElement;
    if ((inp.type === "radio" || inp.type === "checkbox") && inp.name && !isDisabled(inp) && choiceRendered(inp)) {
      const k = groupKey(inp);
      const list = groups.get(k) ?? [];
      list.push(inp);
      groups.set(k, list);
    }
  }
  const doneGroups = new Set<string>();

  for (const el of all) {
    const c = classify(el);
    if (!c) continue;

    if (c.kind === "skip-file" || c.kind === "skip-sensitive") {
      if (!isRendered(el)) continue;
      skipped.push({ label: labelFor(el) || "(unlabeled)", reason: c.kind === "skip-file" ? "file" : "sensitive" });
      continue;
    }

    if (c.kind === "radio" || c.kind === "checkbox") {
      const inp = el as HTMLInputElement;
      if (isDisabled(inp) || !choiceRendered(inp)) continue;
      const k = inp.name ? groupKey(inp) : "";
      const members = k ? groups.get(k) ?? [inp] : [inp];
      if (k && doneGroups.has(k)) continue;
      if (k) doneGroups.add(k);

      const isGroup = c.kind === "radio" || members.length > 1;
      if (!isGroup) {
        const label = labelFor(inp);
        if (sensitive(inp, label)) {
          skipped.push({ label, reason: "sensitive" });
          continue;
        }
        const group = groupFor(inp, label);
        const field: Field = { id: assignId(inp, `checkbox|${inp.name}|${label}|${group ?? ""}`, used), label, type: "checkbox" };
        if (group) field.group = group;
        if (inp.required) field.required = true;
        fields.push(field);
        bindings.set(field.id, { field, kind: "checkbox", elements: [inp] });
        continue;
      }

      const label = groupQuestion(members);
      if (members.some((m) => sensitive(m, label))) {
        skipped.push({ label, reason: "sensitive" });
        continue;
      }
      const options = members.map(choiceOption);
      const container = members[0]!.closest("fieldset") ?? commonAncestor(members) ?? members[0]!;
      const group = groupFor(container, label);
      const type: FieldType = c.kind === "radio" ? "radio" : "checkbox-group";
      const field: Field = { id: assignId(members[0]!, `${type}|${inp.name}|${label}|${group ?? ""}`, used), label, type, options };
      if (group) field.group = group;
      if (members.some((m) => m.required)) field.required = true;
      fields.push(field);
      bindings.set(field.id, { field, kind: type === "radio" ? "radio" : "checkbox-group", elements: members });
      continue;
    }

    if (isDisabled(el) || !isRendered(el)) continue;
    const label = labelFor(el);
    if (sensitive(el, label)) {
      skipped.push({ label: label || "(unlabeled)", reason: "sensitive" });
      continue;
    }
    const group = groupFor(el, label);
    const type = c.type!;
    const field: Field = {
      id: assignId(el, `${type}|${el.getAttribute("name") ?? ""}|${el.id}|${label}|${group ?? ""}`, used),
      label: label || "(unlabeled)",
      type,
    };
    if (group) field.group = group;

    if (c.kind === "input" || c.kind === "textarea") {
      const inp = el as HTMLInputElement;
      if (inp.required || el.getAttribute("aria-required") === "true") field.required = true;
      if (inp.maxLength > 0) field.maxLength = inp.maxLength;
      if (inp.minLength > 0) field.minLength = inp.minLength;
      if (inp.pattern) field.pattern = inp.pattern;
      const ph = clean(inp.placeholder);
      if (ph && ph !== field.label) field.placeholder = ph;
      if (c.format) field.format = c.format;
      if (inp.min) field.min = inp.min;
      if (inp.max) field.max = inp.max;
      const list = (inp as HTMLInputElement).list;
      if (list) {
        field.suggestions = Array.from(list.querySelectorAll("option"))
          .map((o) => o.value || clean(o.textContent))
          .filter(Boolean);
      }
    } else if (c.kind === "select") {
      const sel = el as HTMLSelectElement;
      if (sel.required) field.required = true;
      field.options = Array.from(sel.options)
        .filter((o) => !o.disabled && o.value !== "")
        .map((o) => ({ value: o.value, label: clean(o.textContent) || o.value }));
    } else if (c.kind === "richtext") {
      if (el.getAttribute("aria-required") === "true") field.required = true;
      const ml = Number(el.getAttribute("data-maxlength") || el.getAttribute("maxlength"));
      if (ml > 0) field.maxLength = ml;
    }

    fields.push(field);
    bindings.set(field.id, { field, kind: c.kind, elements: [el] });
  }

  const loc = doc.location;
  const schema: FormSchema = {
    v: PROTOCOL_VERSION,
    session,
    page: { title: clean(doc.title), url: loc ? `${loc.origin}${loc.pathname}` : "" },
    fields,
    skipped,
  };
  return { schema, bindings };
}
