// Holds the current scan of this page and applies a reply straight to it (no preview step).
// Values that are invalid or over a limit are skipped and reported, never truncated or guessed.
import { validateValues } from "../shared/protocol";
import type { FieldValue, FillSummary, FormSchema } from "../shared/types";
import { fill, undo as undoFill, type FillItem, type Snapshot } from "./filler";
import { scanPage, type Binding } from "./scanner";

export type ApplyResult = { ok: true; summary: FillSummary } | { ok: false; error: string };

const signature = (f: { type: string; label: string; group?: string }) => `${f.type}|${f.label}|${f.group ?? ""}`;

export class FormController {
  current: { session: string; schema: FormSchema; bindings: Map<string, Binding> } | null = null;
  /** Everything filled by the latest action (one reply, or several rounds), so Undo takes it all back. */
  private batch: Snapshot[] = [];

  scan(session: string): FormSchema {
    const { schema, bindings } = scanPage(session);
    this.current = { session, schema, bindings };
    this.batch = [];
    return schema;
  }

  /** How many fillable fields the page has right now. Doesn't touch the current scan. */
  peek(): number {
    return scanPage("lb-peek").schema.fields.length;
  }

  /**
   * Scan again under the same session, after a fill may have revealed more fields. `newFieldIds` are the
   * fields that weren't there before. A field the page merely re-created (same type, label and section) is
   * not new.
   */
  rescan(): { schema: FormSchema; newFieldIds: string[] } | null {
    const c = this.current;
    if (!c) return null;
    const { schema, bindings } = scanPage(c.session);
    const knownIds = new Set(c.schema.fields.map((f) => f.id));
    const knownSigs = new Set(c.schema.fields.map(signature));
    const newFieldIds = schema.fields.filter((f) => !knownIds.has(f.id) && !knownSigs.has(signature(f))).map((f) => f.id);
    this.current = { session: c.session, schema, bindings };
    return { schema, newFieldIds };
  }

  /** `append` adds to the current undo batch instead of starting a new one (later rounds of the same fill). */
  apply(session: string, values: Record<string, FieldValue>, append = false): ApplyResult {
    const c = this.current;
    if (!c || c.session !== session) {
      return { ok: false, error: "This page was rescanned or reloaded since that prompt was made. Copy the form again and re-ask the AI." };
    }
    const v = validateValues(c.schema, values);
    const items: FillItem[] = [];
    const skipped: FillSummary["skipped"] = [];
    for (const it of v.items) {
      const binding = c.bindings.get(it.field.id);
      if (it.value === undefined || !binding) {
        skipped.push({ label: it.field.label, reason: it.issues.find((i) => i.level === "error")?.message ?? "Couldn't use that value." });
      } else items.push({ binding, value: it.value });
    }
    const { results, snapshot } = fill(items);
    this.batch = append ? [...this.batch, snapshot] : [snapshot];
    for (const r of results) if (r.status !== "filled") skipped.push({ label: r.label, reason: r.message ?? r.status.replace("_", " ") });
    const summary: FillSummary = {
      filled: results.filter((r) => r.status === "filled").length,
      skipped,
      unknownIds: v.unknownIds.length,
    };
    // Lets the widget on this page report the result, whichever tab triggered the fill.
    document.dispatchEvent(new CustomEvent("lazyboi-filled", { detail: summary }));
    return { ok: true, summary };
  }

  /** Restore every field touched by the latest action. */
  undo(): number {
    let n = 0;
    for (const snap of [...this.batch].reverse()) n += undoFill(snap);
    this.batch = [];
    return n;
  }
}
