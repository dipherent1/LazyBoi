import { describe, expect, it } from "vitest";
import { mergeSummaries, runRounds, type RoundPorts } from "../src/shared/rounds";
import type { FillSummary, FormSchema } from "../src/shared/types";

const schema = (ids: string[]): FormSchema => ({
  v: 1,
  session: "lb-1",
  page: { title: "t", url: "u" },
  fields: ids.map((id) => ({ id, label: id, type: "text" as const })),
  skipped: [],
});

const sum = (filled: number, skipped: string[] = []): FillSummary => ({
  filled,
  skipped: skipped.map((label) => ({ label, reason: "x" })),
  unknownIds: 0,
});

/** Ports that play out a scripted form: each fill reveals the next batch of field ids. */
function scripted(reveals: string[][], over: Partial<RoundPorts> = {}) {
  const calls = { asked: [] as { ids: string[]; followUp: boolean }[], fills: [] as boolean[] };
  let step = 0;
  const ports: RoundPorts = {
    settle: async () => {},
    async ask(s, followUp) {
      calls.asked.push({ ids: s.fields.map((f) => f.id), followUp });
      return { ok: true, text: `reply-${calls.asked.length}` };
    },
    async fill(_text, append) {
      calls.fills.push(append);
      return { ok: true, summary: sum(2) };
    },
    async rescan() {
      const fresh = reveals[step++] ?? [];
      return { ok: true, schema: schema(["a", "b", ...fresh]), newFieldIds: fresh };
    },
    ...over,
  };
  return { ports, calls };
}

describe("runRounds", () => {
  it("stops after one round when nothing new appears", async () => {
    const { ports, calls } = scripted([[]]);
    const r = await runRounds(schema(["a", "b"]), ports);
    expect(r).toMatchObject({ ok: true, rounds: 1 });
    expect(calls.asked).toHaveLength(1);
  });

  it("asks again for just the fields that appeared, and appends to the same undo batch", async () => {
    const { ports, calls } = scripted([["c", "d"], []]);
    const r = await runRounds(schema(["a", "b"]), ports);
    expect(r).toMatchObject({ ok: true, rounds: 2 });
    expect(calls.asked).toEqual([
      { ids: ["a", "b"], followUp: false },
      { ids: ["c", "d"], followUp: true },
    ]);
    expect(calls.fills).toEqual([false, true]);
  });

  it("adds up the results of every round", async () => {
    const { ports } = scripted([["c"], []]);
    const r = await runRounds(schema(["a", "b"]), ports);
    expect(r.ok && r.summary.filled).toBe(4);
  });

  it("never loops forever, even if every fill reveals more", async () => {
    const { ports, calls } = scripted([["c"], ["d"], ["e"], ["f"], ["g"]]);
    const r = await runRounds(schema(["a", "b"]), ports, 3);
    expect(r).toMatchObject({ ok: true, rounds: 3 });
    expect(calls.asked).toHaveLength(3);
  });

  it("fails outright if the first round fails", async () => {
    const { ports } = scripted([], { ask: async () => ({ ok: false, error: "no box" }) });
    expect(await runRounds(schema(["a"]), ports)).toEqual({ ok: false, error: "no box" });
    const filling = scripted([], { fill: async () => ({ ok: false, error: "tab closed" }) });
    expect(await runRounds(schema(["a"]), filling.ports)).toEqual({ ok: false, error: "tab closed" });
  });

  it("keeps what was filled if a later round fails, and says why", async () => {
    let n = 0;
    const { ports } = scripted([["c"]], { ask: async () => (n++ === 0 ? { ok: true, text: "r" } : { ok: false, error: "chat timed out" }) });
    const r = await runRounds(schema(["a", "b"]), ports);
    expect(r).toMatchObject({ ok: true, rounds: 1, note: "chat timed out" });
    expect(r.ok && r.summary.filled).toBe(2);
  });

  it("treats a failed rescan as 'nothing new'", async () => {
    const { ports } = scripted([], { rescan: async () => ({ ok: false, error: "gone" }) });
    expect(await runRounds(schema(["a"]), ports)).toMatchObject({ ok: true, rounds: 1 });
  });
});

describe("mergeSummaries", () => {
  it("adds counts and joins the skipped lists", () => {
    expect(mergeSummaries(sum(1, ["x"]), { ...sum(2, ["y"]), unknownIds: 3 })).toEqual({
      filled: 3,
      skipped: [
        { label: "x", reason: "x" },
        { label: "y", reason: "x" },
      ],
      unknownIds: 3,
    });
  });
});
