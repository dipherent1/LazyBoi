// Holds the current scan of this page and opens the preview for it. Shared by the extension and the harness.
import type { FieldValue, FormSchema } from "../shared/types";
import { showPreview } from "./overlay";
import { scanPage, type Binding } from "./scanner";

export class FormController {
  current: { session: string; schema: FormSchema; bindings: Map<string, Binding> } | null = null;

  scan(session: string): FormSchema {
    const { schema, bindings } = scanPage(session);
    this.current = { session, schema, bindings };
    return schema;
  }

  /** Cheap field count (for the widget badge); doesn't replace the current scan. */
  peek(): number {
    return scanPage("lb-peek").schema.fields.length;
  }

  preview(
    session: string,
    values: Record<string, FieldValue>,
    notes: string[],
    onStatus?: (s: "previewing" | "filled") => void,
  ): { ok: true } | { ok: false; error: string } {
    const c = this.current;
    if (!c || c.session !== session) {
      return { ok: false, error: "This page was rescanned or reloaded since that prompt was made. Copy the form again and re-ask the AI." };
    }
    showPreview({ schema: c.schema, bindings: c.bindings, values, notes, onStatus });
    return { ok: true };
  }
}
