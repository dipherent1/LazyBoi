// Holds the current scan of this page and applies a reply straight to it (no preview step).
// Values that are invalid or over a limit are skipped and reported, never truncated or guessed.
import { validateValues } from "../shared/protocol";
import type { FieldValue, FillSummary, FormSchema } from "../shared/types";
import { fill, undo as undoFill, type FillItem, type Snapshot } from "./filler";
import { scanPage, type Binding } from "./scanner";

export type ApplyResult = { ok: true; summary: FillSummary } | { ok: false; error: string };

export class FormController {
  current: { session: string; schema: FormSchema; bindings: Map<string, Binding> } | null = null;
  private last: Snapshot | null = null;

  scan(session: string): FormSchema {
    const { schema, bindings } = scanPage(session);
    this.current = { session, schema, bindings };
    this.last = null;
    return schema;
  }

  apply(session: string, values: Record<string, FieldValue>): ApplyResult {
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
    this.last = snapshot;
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

  /** Restore the fields touched by the last apply(). */
  undo(): number {
    if (!this.last) return 0;
    const n = undoFill(this.last);
    this.last = null;
    return n;
  }
}
