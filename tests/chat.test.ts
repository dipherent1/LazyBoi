// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { findComposer, findLatestReply, insertIntoComposer, isChatHost } from "../src/content/chat";

function rect(el: Element, bottom: number, width = 400) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ top: bottom - 40, bottom, left: 0, right: width, width, height: 40, x: 0, y: bottom - 40, toJSON() {} }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("isChatHost", () => {
  it("matches known chats and their subdomains only", () => {
    expect(isChatHost("claude.ai")).toBe(true);
    expect(isChatHost("chatgpt.com")).toBe(true);
    expect(isChatHost("www.perplexity.ai")).toBe(true);
    expect(isChatHost("notclaude.ai")).toBe(false);
    expect(isChatHost("example.com")).toBe(false);
  });
});

describe("findComposer", () => {
  it("picks the lowest text input (the message box), not a search bar", () => {
    document.body.innerHTML = `<textarea id="search"></textarea><div id="msg" contenteditable="true"></div>`;
    rect(document.getElementById("search")!, 60);
    rect(document.getElementById("msg")!, 700);
    expect(findComposer()?.id).toBe("msg");
  });

  it("ignores read-only, tiny and hidden-by-size inputs", () => {
    document.body.innerHTML = `<textarea id="ro" readonly></textarea><textarea id="tiny"></textarea>`;
    rect(document.getElementById("ro")!, 700);
    rect(document.getElementById("tiny")!, 800, 30);
    expect(findComposer()).toBeNull();
  });
});

describe("insertIntoComposer", () => {
  it("appends to a textarea without wiping what's there, and fires input", () => {
    document.body.innerHTML = `<textarea id="t">hello</textarea>`;
    const t = document.getElementById("t") as HTMLTextAreaElement;
    rect(t, 500);
    let inputs = 0;
    t.addEventListener("input", () => inputs++);
    expect(insertIntoComposer("PROMPT")).toBe(true);
    expect(t.value).toBe("hello\n\nPROMPT");
    expect(inputs).toBe(1);
  });

  it("falls back to execCommand for plain contenteditable boxes", () => {
    document.body.innerHTML = `<div id="e" contenteditable="true"></div>`;
    const e = document.getElementById("e")!;
    rect(e, 500);
    (document as unknown as { execCommand: unknown }).execCommand = (_c: string, _u: boolean, text: string) => {
      e.textContent += text;
      return true;
    };
    expect(insertIntoComposer("[lazyBoi form-fill request]\nbody")).toBe(true);
    expect(e.textContent).toContain("[lazyBoi form-fill request]");
  });

  it("reports failure when there is no message box", () => {
    expect(insertIntoComposer("x")).toBe(false);
  });
});

describe("findLatestReply", () => {
  const block = (json: string) => `<pre><code>${json}</code></pre>`;

  it("returns the last valid lazyBoi block", () => {
    document.body.innerHTML =
      block('{"session":"lb-1111","values":{"a":"old"}}') + "<p>later</p>" + block('{"session":"lb-2222","values":{"a":"new"}}');
    const r = findLatestReply();
    expect(r?.reply.session).toBe("lb-2222");
    expect(r?.reply.values).toEqual({ a: "new" });
  });

  it("ignores the prompt's own example block and unrelated code", () => {
    document.body.innerHTML =
      block('{"session":"lb-1111","values":{"FIELD_ID_1":"a string","FIELD_ID_2":["option"]}}') + block("const x = 1;");
    expect(findLatestReply()).toBeNull();
  });

  it("skips a half-written block while the AI is still typing", () => {
    document.body.innerHTML = block('{"session":"lb-1111","values":{"a":"done"}}') + block('{"session":"lb-1111","values":{"a":"par');
    expect(findLatestReply()?.reply.values).toEqual({ a: "done" });
  });

  it("falls back to page text when there is no code block", () => {
    document.body.innerHTML = `<div>Here: {"session":"lb-3333","values":{"x":"1"}}</div>`;
    expect(findLatestReply()?.reply.session).toBe("lb-3333");
  });
});
