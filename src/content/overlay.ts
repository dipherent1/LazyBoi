// Preview overlay (PRD U3–U5): review proposed values, edit, fill, undo. Rendered in a shadow root.
import type { FieldValue, FormSchema } from "../shared/types";
import { validateItem, validateValues, type ValidatedItem } from "../shared/protocol";
import { h } from "./dom";
import { fill, readValue, undo, type FillResult, type Snapshot } from "./filler";
import { OVERLAY_HOST_ID, type Binding } from "./scanner";

export interface PreviewOptions {
  schema: FormSchema;
  bindings: Map<string, Binding>;
  values: Record<string, FieldValue>;
  notes?: string[];
  onStatus?: (status: "previewing" | "filled") => void;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.panel { position: fixed; top: 16px; right: 16px; width: 440px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;
  background: #fff; color: #1d1b26; border: 1px solid #ddd8ee; border-radius: 12px; box-shadow: 0 12px 40px rgba(30,20,60,.25);
  z-index: 2147483647; font-size: 13px; line-height: 1.4; }
header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #eee9f8; }
header .logo { font-weight: 700; color: #5b3fd6; }
header .meta { color: #6b6780; font-size: 12px; flex: 1; }
header button.x { border: 0; background: none; font-size: 18px; cursor: pointer; color: #6b6780; }
.body { overflow: auto; padding: 8px 14px; flex: 1; }
.notes { background: #fff8e6; border: 1px solid #f3dfa8; border-radius: 8px; padding: 6px 8px; margin: 6px 0; color: #6a5200; font-size: 12px; }
.row { border: 1px solid #eee9f8; border-radius: 10px; padding: 8px 10px; margin: 8px 0; }
.row.off { opacity: .55; }
.row .top { display: flex; align-items: flex-start; gap: 8px; }
.row .top label { font-weight: 600; flex: 1; cursor: pointer; }
.row .group { color: #6b6780; font-weight: 400; font-size: 11px; display: block; }
.row .type { color: #8d89a3; font-size: 11px; }
.row .cur { color: #6b6780; font-size: 12px; margin: 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row textarea, .row input[type=text], .row select { width: 100%; border: 1px solid #d6d0ea; border-radius: 6px; padding: 6px; font-size: 13px; color: #1d1b26; background: #fff; }
.row textarea { min-height: 56px; resize: vertical; }
.row .count { text-align: right; color: #8d89a3; font-size: 11px; }
.row .count.bad { color: #c0262d; font-weight: 600; }
.issue { font-size: 12px; margin-top: 4px; }
.issue.error { color: #c0262d; }
.issue.warn { color: #8a6100; }
footer { display: flex; gap: 8px; align-items: center; padding: 10px 14px; border-top: 1px solid #eee9f8; }
footer .spacer { flex: 1; color: #6b6780; font-size: 12px; }
button.btn { border: 1px solid #d6d0ea; background: #fff; border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; color: #1d1b26; }
button.btn.primary { background: #5b3fd6; border-color: #5b3fd6; color: #fff; font-weight: 600; }
button.btn:disabled { opacity: .5; cursor: default; }
.res { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #eee9f8; }
.res .st { width: 72px; font-weight: 600; }
.panel.compact { width: 320px; }
summary { cursor: pointer; color: #5b3fd6; margin: 4px 0; }
.st.filled { color: #1a7f37; } .st.not_found, .st.invalid { color: #c0262d; } .st.skipped { color: #6b6780; }
`;

function display(v: FieldValue): string {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(none)";
  if (typeof v === "boolean") return v ? "checked" : "unchecked";
  return v === "" ? "(empty)" : v;
}

/** Lets the widget tuck itself away while the preview is open. */
function announce(open: boolean): void {
  document.dispatchEvent(new CustomEvent("lazyboi-overlay", { detail: { open } }));
}

export function closePreview(): void {
  const host = document.getElementById(OVERLAY_HOST_ID);
  if (!host) return;
  host.remove();
  announce(false);
}

interface RowState {
  item: ValidatedItem;
  binding: Binding;
  accept: HTMLInputElement;
  getValue: () => FieldValue;
}

export function showPreview(opts: PreviewOptions): void {
  closePreview();
  const host = h("div", { id: OVERLAY_HOST_ID });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(h("style", {}, CSS));
  const panel = h("div", { class: "panel", role: "dialog", "aria-label": "lazyBoi preview" });
  shadow.append(panel);
  document.documentElement.append(host);
  announce(true);

  const { schema, bindings } = opts;
  const result = validateValues(schema, opts.values);
  const notes = [...(opts.notes ?? [])];
  if (result.unknownIds.length) notes.push(`Ignored ${result.unknownIds.length} unknown field id(s): ${result.unknownIds.join(", ")}.`);
  const untouched = schema.fields.length - result.items.length;
  if (untouched > 0) notes.push(`${untouched} field(s) not in the reply will be left as they are.`);

  const close = () => {
    closePreview();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey, true);

  const header = h(
    "header",
    {},
    h("span", { class: "logo" }, "lazyBoi"),
    h("span", { class: "meta" }, `Preview · ${schema.session} · ${result.items.length} value(s)`),
  );
  const x = h("button", { class: "x", title: "Close (Esc)", "aria-label": "Close" }, "×");
  x.addEventListener("click", close);
  header.append(x);

  const body = h("div", { class: "body" });
  for (const n of notes) body.append(h("div", { class: "notes" }, n));

  const rows: RowState[] = [];
  for (const item of result.items) {
    const binding = bindings.get(item.field.id);
    if (!binding) continue;
    rows.push(buildRow(item, binding, body));
  }
  if (!rows.length) body.append(h("div", { class: "notes" }, "Nothing to fill from this reply."));

  const footer = h("footer", {});
  const summary = h("span", { class: "spacer" });
  const cancel = h("button", { class: "btn" }, "Cancel");
  const fillBtn = h("button", { class: "btn primary" }, "Fill");
  footer.append(summary, cancel, fillBtn);
  cancel.addEventListener("click", close);

  const refresh = () => {
    const n = rows.filter((r) => r.accept.checked).length;
    fillBtn.textContent = `Fill ${n} field${n === 1 ? "" : "s"}`;
    fillBtn.disabled = n === 0;
    summary.textContent = "You submit the form yourself.";
  };
  rows.forEach((r) => r.accept.addEventListener("change", refresh));
  body.addEventListener("lb-refresh", refresh);
  refresh();

  fillBtn.addEventListener("click", () => {
    const chosen = rows.filter((r) => r.accept.checked);
    const items: { binding: Binding; value: FieldValue }[] = [];
    const preResults: FillResult[] = [];
    for (const r of chosen) {
      const v = validateItem(r.item.field, r.getValue());
      if (v.value === undefined) {
        preResults.push({ fieldId: r.item.field.id, label: r.item.field.label, status: "invalid", message: v.issues.map((i) => i.message).join(" ") });
      } else items.push({ binding: r.binding, value: v.value });
    }
    const { results, snapshot } = fill(items);
    opts.onStatus?.("filled");
    showResults(body, footer, [...preResults, ...results], snapshot, close);
  });

  panel.append(header, body, footer);
  opts.onStatus?.("previewing");
}

function buildRow(item: ValidatedItem, binding: Binding, body: HTMLElement): RowState {
  const f = item.field;
  const row = h("div", { class: "row" });
  const accept = h("input", { type: "checkbox", id: `acc-${f.id}` });
  const title = h("label", { for: `acc-${f.id}` }, f.label);
  if (f.group) title.prepend(h("span", { class: "group" }, f.group));
  row.append(h("div", { class: "top" }, accept, title, h("span", { class: "type" }, f.type)));

  let current = "";
  try {
    current = display(readValue(binding));
  } catch {
    current = "(unreadable)";
  }
  row.append(h("div", { class: "cur", title: current }, `Now: ${current}`));

  const issuesBox = h("div", {});
  const count = h("div", { class: "count" });
  let getValue: () => FieldValue;
  const initial = item.value ?? item.raw;

  if (f.options && f.type !== "checkbox") {
    const multiple = f.type === "multiselect" || f.type === "checkbox-group";
    const sel = h("select", multiple ? { multiple: "", size: String(Math.min(6, f.options.length)) } : {});
    if (!multiple) sel.append(h("option", { value: "" }, "—"));
    const chosen = Array.isArray(initial) ? initial : [String(initial)];
    for (const o of f.options) {
      const opt = h("option", { value: o.value }, o.label);
      if (chosen.includes(o.value)) opt.selected = true;
      sel.append(opt);
    }
    row.append(sel);
    getValue = () => (multiple ? Array.from(sel.selectedOptions).map((o) => o.value) : sel.value);
    sel.addEventListener("change", () => revalidate());
  } else if (f.type === "checkbox") {
    const sel = h("select", {}, h("option", { value: "true" }, "Checked"), h("option", { value: "false" }, "Unchecked"));
    sel.value = initial === true || initial === "true" ? "true" : "false";
    row.append(sel);
    getValue = () => sel.value === "true";
    sel.addEventListener("change", () => revalidate());
  } else {
    const text = Array.isArray(initial) ? initial.join(", ") : String(initial);
    const long = f.type === "textarea" || f.type === "richtext" || text.length > 60 || text.includes("\n");
    const input = long ? h("textarea", {}) : h("input", { type: "text" });
    input.value = text;
    row.append(input);
    if (f.maxLength) row.append(count);
    getValue = () => input.value;
    input.addEventListener("input", () => revalidate());
  }
  row.append(issuesBox);

  function revalidate(initialRun = false) {
    const v = initialRun ? item : validateItem(f, getValue());
    issuesBox.replaceChildren(...v.issues.map((i) => h("div", { class: `issue ${i.level}` }, i.message)));
    if (f.maxLength) {
      const len = String(getValue()).length;
      count.textContent = `${len}/${f.maxLength}`;
      count.className = `count${len > f.maxLength ? " bad" : ""}`;
    }
    const hasError = v.value === undefined;
    if (initialRun) accept.checked = !hasError;
    else if (hasError) accept.checked = false;
    accept.disabled = hasError;
    row.classList.toggle("off", !accept.checked);
    body.dispatchEvent(new Event("lb-refresh"));
  }
  accept.addEventListener("change", () => row.classList.toggle("off", !accept.checked));
  revalidate(true);
  body.append(row);
  return { item, binding, accept, getValue: () => getValue() };
}

function showResults(body: HTMLElement, footer: HTMLElement, results: FillResult[], snapshot: Snapshot, close: () => void) {
  const filled = results.filter((r) => r.status === "filled").length;
  const failed = results.length - filled;
  // After filling, shrink to a small summary so the form stays visible; the per-field list is one click away.
  body.parentElement?.classList.add("compact");
  body.replaceChildren(
    h("div", { class: "notes" }, `${filled} filled${failed ? `, ${failed} not filled` : ""}. Review the form, then submit it yourself.`),
    h(
      "details",
      failed ? { open: "" } : {},
      h("summary", {}, "Details"),
      ...results.map((r) =>
        h("div", { class: "res" }, h("span", { class: `st ${r.status}` }, r.status.replace("_", " ")), h("span", {}, r.label + (r.message ? ` — ${r.message}` : ""))),
      ),
    ),
  );
  const undoBtn = h("button", { class: "btn" }, "Undo");
  const done = h("button", { class: "btn primary" }, "Done");
  undoBtn.addEventListener("click", () => {
    const n = undo(snapshot);
    body.prepend(h("div", { class: "notes" }, `Restored ${n} field(s) to their previous values.`));
    undoBtn.disabled = true;
  });
  done.addEventListener("click", close);
  footer.replaceChildren(h("span", { class: "spacer" }), undoBtn, done);
}
