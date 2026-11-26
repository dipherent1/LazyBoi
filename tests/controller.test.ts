// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { FormController } from "../src/content/session";
import type { FillSummary } from "../src/shared/types";

const html = `
  <label for="n">Name</label><input id="n" maxlength="5">
  <label for="b">Bio</label><textarea id="b"></textarea>
  <label for="t">Type</label><select id="t"><option value="">-</option><option value="ft">Full-time</option><option value="pt">Part-time</option></select>
  <label><input type="checkbox" id="c" name="c"> Remote</label>`;

function setup() {
  document.body.innerHTML = html;
  const c = new FormController();
  const schema = c.scan("lb-1");
  const id = (label: string) => schema.fields.find((f) => f.label === label)!.id;
  return { c, id };
}

const val = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("FormController.peek", () => {
  it("counts fillable fields without replacing the current scan", () => {
    const { c } = setup();
    expect(c.peek()).toBe(4);
    expect(c.current?.session).toBe("lb-1");
    document.body.innerHTML = "";
    expect(c.peek()).toBe(0);
  });
});

describe("FormController.apply (no preview step)", () => {
  it("fills valid values straight away and reports what it skipped", () => {
    const { c, id } = setup();
    const r = c.apply("lb-1", { [id("Name")]: "Far too long", [id("Bio")]: "Hello", [id("Type")]: "Full-time", nope: "x" });
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.filled).toBe(2);
    expect(r.summary.unknownIds).toBe(1);
    expect(r.summary.skipped).toHaveLength(1);
    expect(r.summary.skipped[0]!.label).toBe("Name");
    expect(r.summary.skipped[0]!.reason).toMatch(/characters/);
    expect(val("#n")).toBe(""); // over the limit: left alone, never truncated
    expect(val("#b")).toBe("Hello");
    expect(val("#t")).toBe("ft");
  });

  it("skips values that aren't one of the options", () => {
    const { c, id } = setup();
    const r = c.apply("lb-1", { [id("Type")]: "Contract" });
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.filled).toBe(0);
    expect(r.summary.skipped[0]!.reason).toMatch(/options/);
    expect(val("#t")).toBe("");
  });

  it("refuses values that look like card numbers", () => {
    const { c, id } = setup();
    const r = c.apply("lb-1", { [id("Bio")]: "4111 1111 1111 1111" });
    if (!r.ok) throw new Error(r.error);
    expect(r.summary.filled).toBe(0);
    expect(val("#b")).toBe("");
  });

  it("undoes the last fill, once", () => {
    const { c, id } = setup();
    c.apply("lb-1", { [id("Bio")]: "Hello", [id("Remote")]: true });
    expect(val("#b")).toBe("Hello");
    expect((document.getElementById("c") as HTMLInputElement).checked).toBe(true);
    expect(c.undo()).toBe(2);
    expect(val("#b")).toBe("");
    expect((document.getElementById("c") as HTMLInputElement).checked).toBe(false);
    expect(c.undo()).toBe(0);
  });

  it("rejects a reply made for a different scan", () => {
    const { c, id } = setup();
    const r = c.apply("lb-OLD", { [id("Bio")]: "Hello" });
    expect(r.ok).toBe(false);
    expect(val("#b")).toBe("");
  });

  it("tells the page's widget what happened via an event", () => {
    const { c, id } = setup();
    const seen: FillSummary[] = [];
    document.addEventListener("lazyboi-filled", (e) => seen.push((e as CustomEvent<FillSummary>).detail));
    c.apply("lb-1", { [id("Bio")]: "Hello" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.filled).toBe(1);
  });
});

describe("FormController dynamic forms", () => {
  const reveal = `
    <label for="s">Status</label><select id="s"><option value="">-</option><option value="student">Student</option></select>
    <div id="more" hidden><label for="sch">School</label><input id="sch"><label for="prog">Program</label><input id="prog"></div>`;

  function dynamic() {
    document.body.innerHTML = reveal;
    document.getElementById("s")!.addEventListener("change", () => ((document.getElementById("more") as HTMLElement).hidden = false));
    const c = new FormController();
    const schema = c.scan("lb-d");
    return { c, id: (l: string) => schema.fields.find((f) => f.label === l)!.id };
  }

  it("rescan reports only the fields that appeared, keeping the old ids", () => {
    const { c, id } = dynamic();
    const statusId = id("Status");
    const r = c.apply("lb-d", { [statusId]: "Student" });
    expect(r.ok).toBe(true);
    const scan = c.rescan()!;
    expect(scan.schema.fields.map((f) => f.label)).toEqual(["Status", "School", "Program"]);
    expect(scan.newFieldIds).toHaveLength(2);
    expect(scan.schema.fields.find((f) => f.label === "Status")!.id).toBe(statusId);
  });

  it("a field the page merely re-created is not reported as new", () => {
    document.body.innerHTML = `<div id="w"><label for="n">Name</label><input id="n"></div>`;
    const c = new FormController();
    c.scan("lb-r");
    document.getElementById("w")!.innerHTML = `<label for="n">Name</label><input id="n">`; // a framework re-render
    expect(c.rescan()!.newFieldIds).toEqual([]);
  });

  it("applies a follow-up round to the new fields and undoes every round at once", () => {
    const { c, id } = dynamic();
    c.apply("lb-d", { [id("Status")]: "Student" });
    const scan = c.rescan()!;
    const schoolId = scan.schema.fields.find((f) => f.label === "School")!.id;
    const second = c.apply("lb-d", { [schoolId]: "UofT" }, true);
    expect(second.ok && second.summary.filled).toBe(1);
    expect((document.getElementById("sch") as HTMLInputElement).value).toBe("UofT");

    expect(c.undo()).toBe(2); // the status select and the school box
    expect((document.getElementById("sch") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("");
  });

  it("a plain apply starts a fresh undo batch", () => {
    const { c, id } = dynamic();
    c.apply("lb-d", { [id("Status")]: "Student" });
    const scan = c.rescan()!;
    const schoolId = scan.schema.fields.find((f) => f.label === "School")!.id;
    c.apply("lb-d", { [schoolId]: "UofT" }); // not appended
    expect(c.undo()).toBe(1);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("student");
  });

  it("rescan before any scan returns nothing", () => {
    expect(new FormController().rescan()).toBeNull();
  });
});
