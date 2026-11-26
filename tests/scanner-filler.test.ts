// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { scanPage } from "../src/content/scanner";
import { fill, undo } from "../src/content/filler";

function page(html: string) {
  document.body.innerHTML = html;
  return scanPage("lb-test");
}

const find = (r: ReturnType<typeof scanPage>, label: string) => r.schema.fields.find((f) => f.label === label);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanner", () => {
  it("resolves labels from many sources", () => {
    const r = page(`
      <label for="a">First name *</label><input id="a">
      <input aria-label="Preferred name">
      <input placeholder="Your pronouns">
      <label>Hometown <input name="x8"></label>
      <span id="t1">Twitter handle</span><input aria-labelledby="t1">
      <input name="emergency_contact_name">
      <div>Graduation year <input type="number"></div>
      <p>Intro text that is not a label</p>
      <form><div><input name="office_ext"></div><div><input name="other_field"></div></form>`);
    expect(r.schema.fields.map((f) => f.label)).toEqual([
      "First name",
      "Preferred name",
      "Your pronouns",
      "Hometown",
      "Twitter handle",
      "Emergency Contact Name",
      "Graduation year",
      "Office Ext",
      "Other Field",
    ]);
  });

  it("captures limits, required, options and section groups", () => {
    const r = page(`
      <section data-section="Experience #1">
        <h3>Experience #1</h3>
        <label for="t">Title</label><input id="t" required maxlength="100">
        <label for="s">Type</label><select id="s"><option value="">Pick…</option><option value="ft">Full-time</option></select>
      </section>`);
    const title = find(r, "Title")!;
    expect(title).toMatchObject({ required: true, maxLength: 100, group: "Experience #1" });
    expect(find(r, "Type")!.options).toEqual([{ value: "ft", label: "Full-time" }]);
  });

  it("groups radios and same-name checkboxes", () => {
    const r = page(`
      <fieldset><legend>Work arrangement</legend>
        <label><input type="radio" name="arr" value="remote"> Remote</label>
        <label><input type="radio" name="arr" value="onsite"> On-site</label>
      </fieldset>
      <fieldset><legend>Skills</legend>
        <label><input type="checkbox" name="sk" value="ts"> TypeScript</label>
        <label><input type="checkbox" name="sk" value="py"> Python</label>
      </fieldset>
      <label><input type="checkbox" name="news"> Newsletter</label>`);
    expect(find(r, "Work arrangement")).toMatchObject({ type: "radio", options: [{ value: "remote", label: "Remote" }, { value: "onsite", label: "On-site" }] });
    expect(find(r, "Skills")!.type).toBe("checkbox-group");
    expect(find(r, "Newsletter")!.type).toBe("checkbox");
  });

  it("skips sensitive, file, hidden, disabled and read-only fields", () => {
    const r = page(`
      <label for="n">Name</label><input id="n">
      <label for="p">Password</label><input id="p" type="password">
      <label for="c">Card number</label><input id="c">
      <label for="cv">CVV</label><input id="cv">
      <input name="cc_num">
      <label for="ssn">Social Security Number</label><input id="ssn">
      <label for="f">Resume</label><input id="f" type="file">
      <input type="hidden" name="csrf" value="x">
      <input name="ro" readonly>
      <input name="dis" disabled>
      <div style="display:none"><input name="invisible"></div>`);
    expect(r.schema.fields.map((f) => f.label)).toEqual(["Name"]);
    expect(r.schema.skipped.map((s) => s.reason).sort()).toEqual(["file", "sensitive", "sensitive", "sensitive", "sensitive", "sensitive"]);
  });

  it("keeps multi-line rich text when filling", () => {
    const r = page(`<div contenteditable="true" aria-label="Cover letter"></div>`);
    const b = r.bindings.get(r.schema.fields[0]!.id)!;
    fill([{ binding: b, value: "Hi,\nThanks" }], { highlight: false });
    expect(b.elements[0]!.innerHTML).toBe("Hi,<br>Thanks");
  });

  it("keeps ids stable across rescans", () => {
    const a = page(`<label for="a">Email</label><input id="a" type="email">`).schema.fields[0]!.id;
    const b = scanPage("lb-test2").schema.fields[0]!.id;
    expect(a).toBe(b);
  });

  it("finds fields inside open shadow roots", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const root = document.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<label for="city">City</label><input id="city">`;
    expect(scanPage("lb-x").schema.fields.map((f) => f.label)).toEqual(["City"]);
  });
});

describe("filler", () => {
  it("fills text through the native setter and fires input/change", () => {
    const r = page(`<label for="a">Name</label><input id="a">`);
    const el = document.getElementById("a") as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push("input"));
    el.addEventListener("change", () => seen.push("change"));
    const b = r.bindings.get(r.schema.fields[0]!.id)!;
    fill([{ binding: b, value: "Ada" }], { highlight: false });
    expect(el.value).toBe("Ada");
    expect(seen).toEqual(["input", "change"]);
  });

  it("defeats a React-style value tracker", () => {
    const r = page(`<label for="a">Name</label><input id="a">`);
    const el = document.getElementById("a") as HTMLInputElement;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    let tracked = "";
    let state = "";
    Object.defineProperty(el, "value", { configurable: true, get: () => desc.get!.call(el), set: (v) => { tracked = v; desc.set!.call(el, v); } });
    el.addEventListener("input", () => {
      const cur = desc.get!.call(el);
      if (cur !== tracked) state = tracked = cur;
    });
    fill([{ binding: r.bindings.get(r.schema.fields[0]!.id)!, value: "Ada" }], { highlight: false });
    expect(state).toBe("Ada");
  });

  it("fills selects, radios, checkbox groups and undoes them", () => {
    const r = page(`
      <label for="s">Type</label><select id="s"><option value="">-</option><option value="ft">Full-time</option></select>
      <fieldset><legend>Arr</legend><label><input type="radio" name="arr" value="remote"> Remote</label><label><input type="radio" name="arr" value="onsite"> On-site</label></fieldset>
      <fieldset><legend>Skills</legend><label><input type="checkbox" name="sk" value="ts"> TS</label><label><input type="checkbox" name="sk" value="py" checked> Py</label></fieldset>`);
    const items = [
      { binding: r.bindings.get(find(r, "Type")!.id)!, value: "ft" },
      { binding: r.bindings.get(find(r, "Arr")!.id)!, value: "onsite" },
      { binding: r.bindings.get(find(r, "Skills")!.id)!, value: ["ts"] },
    ];
    const { results, snapshot } = fill(items, { highlight: false });
    expect(results.every((x) => x.status === "filled")).toBe(true);
    const q = (s: string) => document.querySelector(s) as HTMLInputElement;
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("ft");
    expect(q('input[value="onsite"]').checked).toBe(true);
    expect(q('input[value="ts"]').checked).toBe(true);
    expect(q('input[value="py"]').checked).toBe(false);

    undo(snapshot);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("");
    expect(q('input[value="onsite"]').checked).toBe(false);
    expect(q('input[value="ts"]').checked).toBe(false);
    expect(q('input[value="py"]').checked).toBe(true);
  });

  it("reports fields that disappeared", () => {
    const r = page(`<label for="a">Name</label><input id="a">`);
    const b = r.bindings.get(r.schema.fields[0]!.id)!;
    document.body.innerHTML = "";
    expect(fill([{ binding: b, value: "x" }]).results[0]!.status).toBe("not_found");
  });
});

describe("scanner: modal dialogs", () => {
  const labels = (r: ReturnType<typeof scanPage>) => r.schema.fields.map((f) => f.label);

  it("scans only the dialog when a modal is open", () => {
    const r = page(`
      <input aria-label="Search"><div contenteditable="true" aria-label="Write a message"></div>
      <div role="dialog" aria-modal="true">
        <label for="t">Job title</label><input id="t"><label for="o">Organization</label><input id="o">
      </div>`);
    expect(labels(r)).toEqual(["Job title", "Organization"]);
  });

  it("finds a modal that lives inside an open shadow root, like LinkedIn's", () => {
    document.body.innerHTML = `<input aria-label="Search"><div id="outlet"></div>`;
    const root = document.getElementById("outlet")!.attachShadow({ mode: "open" });
    root.innerHTML = `<div role="dialog"><label for="t">Job title</label><input id="t"><label for="o">Organization</label><input id="o"></div>`;
    expect(labels(scanPage("lb-t"))).toEqual(["Job title", "Organization"]);
  });

  it("scans the whole page when there is no dialog, or the dialog is hidden", () => {
    expect(labels(page(`<input aria-label="A"><input aria-label="B">`))).toEqual(["A", "B"]);
    expect(labels(page(`<input aria-label="A"><div role="dialog" aria-modal="true" hidden><input aria-label="X"></div>`))).toEqual(["A"]);
  });

  it("doesn't let a one-box popup (like a small chat window) take over the page", () => {
    const r = page(`<input aria-label="First"><input aria-label="Second"><div role="dialog"><div contenteditable="true" aria-label="Message"></div></div>`);
    expect(labels(r)).toEqual(["First", "Second", "Message"]);
  });

  it("uses the latest dialog when several are open", () => {
    const r = page(`<div role="dialog" aria-modal="true"><input aria-label="Old"></div><div role="dialog" aria-modal="true"><input aria-label="New"></div>`);
    expect(labels(r)).toEqual(["New"]);
  });
});
