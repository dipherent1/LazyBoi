// Dynamic forms: filling one field can reveal more (pick "Student" and School appears). After each fill we
// look for new fields and ask the same chat for just those, a few rounds at most. Transport-agnostic, so the
// extension (service worker) and the playground harness share it.
import type { FillSummary, FormSchema } from "./types";

export type AskOutcome = { ok: true; text: string } | { ok: false; error: string; debug?: unknown };

export interface RoundPorts {
  /** Send the form (or, for a follow-up, only the new fields) to the chat and return its reply text. */
  ask(schema: FormSchema, followUp: boolean): Promise<AskOutcome>;
  /** Apply a reply to the form. `append` keeps it in the same undo batch as the earlier rounds. */
  fill(text: string, append: boolean): Promise<{ ok: true; summary: FillSummary } | { ok: false; error: string }>;
  /** Rescan the form; `newFieldIds` are fields that weren't there before. */
  rescan(): Promise<{ ok: true; schema: FormSchema; newFieldIds: string[] } | { ok: false; error: string }>;
  /** Give the page a moment to re-render after a fill. */
  settle?(): Promise<void>;
}

export type RoundsResult =
  | { ok: true; summary: FillSummary; rounds: number; note?: string }
  | { ok: false; error: string; debug?: unknown };

export const emptySummary = (): FillSummary => ({ filled: 0, skipped: [], unknownIds: 0 });

export function mergeSummaries(a: FillSummary, b: FillSummary): FillSummary {
  return { filled: a.filled + b.filled, skipped: [...a.skipped, ...b.skipped], unknownIds: a.unknownIds + b.unknownIds };
}

const defaultSettle = () => new Promise<void>((r) => setTimeout(r, 800));

/**
 * Ask, fill, then keep going while new fields keep appearing. A failure in the first round fails the whole
 * thing; a failure in a later round keeps what was already filled and reports a note.
 */
export async function runRounds(first: FormSchema, ports: RoundPorts, maxRounds = 3): Promise<RoundsResult> {
  let schema = first;
  let followUp = false;
  let total = emptySummary();
  let rounds = 0;

  for (;;) {
    const asked = await ports.ask(schema, followUp);
    if (!asked.ok) return rounds ? { ok: true, summary: total, rounds, note: asked.error } : asked;

    const filled = await ports.fill(asked.text, rounds > 0);
    if (!filled.ok) return rounds ? { ok: true, summary: total, rounds, note: filled.error } : filled;
    total = mergeSummaries(total, filled.summary);
    rounds++;
    if (rounds >= maxRounds) break;

    await (ports.settle ?? defaultSettle)();
    const scan = await ports.rescan();
    if (!scan.ok || scan.newFieldIds.length === 0) break;

    const fresh = new Set(scan.newFieldIds);
    schema = { ...scan.schema, fields: scan.schema.fields.filter((f) => fresh.has(f.id)) };
    followUp = true;
  }
  return { ok: true, summary: total, rounds };
}
