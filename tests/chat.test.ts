// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { waitForReply } from "../src/content/ask";
import { diagnose, findComposer, findLatestReply, findSendButton, insertIntoComposer, isChatHost, isStreaming, tryInsert } from "../src/content/chat";

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
    (document as unknown as { execCommand: unknown }).execCommand = (cmd: string, _u: boolean, text?: string) => {
      if (cmd === "insertText") e.textContent += text ?? "";
      return true;
    };
    expect(insertIntoComposer("[lazyBoi form-fill request]\nbody")).toBe(true);
    expect(e.textContent).toContain("[lazyBoi form-fill request]");
  });

  it("reports failure when there is no message box", () => {
    expect(insertIntoComposer("x")).toBe(false);
  });
});

describe("findSendButton", () => {
  const composerIn = (html: string) => {
    document.body.innerHTML = html;
    return document.getElementById("box") as HTMLElement;
  };

  it("finds a ChatGPT-style send button next to the box", () => {
    const box = composerIn(`<form><div id="box" contenteditable="true"></div><button data-testid="send-button"></button></form>`);
    expect(findSendButton(box)?.getAttribute("data-testid")).toBe("send-button");
  });

  it("finds a Claude-style aria-label button", () => {
    const box = composerIn(`<div><div id="box" contenteditable="true"></div><button aria-label="Send message"></button></div>`);
    expect(findSendButton(box)?.getAttribute("aria-label")).toBe("Send message");
  });

  it("falls back to a button that just says Send", () => {
    const box = composerIn(`<div><div id="box" contenteditable="true"></div><button type="button">Send</button></div>`);
    expect(findSendButton(box)?.textContent).toBe("Send");
  });

  it("ignores disabled buttons (the box is still empty)", () => {
    const box = composerIn(`<div><div id="box" contenteditable="true"></div><button aria-label="Send message" disabled></button></div>`);
    expect(findSendButton(box)).toBeNull();
  });

  it("ignores unrelated buttons far from the box", () => {
    const box = composerIn(`<div><button>Send</button></div><main><section><div id="box" contenteditable="true"></div></section></main>`);
    expect(findSendButton(box)).toBeNull();
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

describe("ChatGPT-style pages", () => {
  it("prefers #prompt-textarea over other inputs, even lower on screen", () => {
    document.body.innerHTML = `<textarea id="other"></textarea><div id="prompt-textarea" contenteditable="true"></div>`;
    rect(document.getElementById("other")!, 900);
    rect(document.getElementById("prompt-textarea")!, 600);
    expect(findComposer()?.id).toBe("prompt-textarea");
  });

  it("finds the #composer-submit-button send button", () => {
    document.body.innerHTML = `<form><div id="box" contenteditable="true"></div><button id="composer-submit-button"></button></form>`;
    expect(findSendButton(document.getElementById("box")!)?.id).toBe("composer-submit-button");
  });

  it("only reads replies from assistant messages when the page marks them", () => {
    document.body.innerHTML =
      `<div data-message-author-role="user"><pre>{"session":"lb-9","values":{"a":"from the user message"}}</pre></div>` +
      `<div data-message-author-role="assistant"><pre><div>lazyboi<button>Copy code</button></div><code>{"session":"lb-9","values":{"a":"real"}}</code></pre></div>`;
    expect(findLatestReply()?.reply.values).toEqual({ a: "real" });
  });

  it("finds no reply while the only matching block is the user's own message", () => {
    document.body.innerHTML =
      `<div data-message-author-role="user"><pre>{"session":"lb-9","values":{"a":"mine"}}</pre></div><div data-message-author-role="assistant"><p>Working on it…</p></div>`;
    expect(findLatestReply()).toBeNull();
  });

  it("knows a reply is still streaming by its Stop button", () => {
    document.body.innerHTML = `<button data-testid="stop-button"></button>`;
    expect(isStreaming()).toBe(true);
    document.body.innerHTML = `<button aria-label="Stop response"></button>`;
    expect(isStreaming()).toBe(true);
    document.body.innerHTML = `<button aria-label="Send message"></button>`;
    expect(isStreaming()).toBe(false);
  });

  it("tryInsert says why it failed", () => {
    expect(tryInsert("x")).toBe("no-box");
    document.body.innerHTML = `<div id="e" contenteditable="true"></div>`;
    rect(document.getElementById("e")!, 500);
    (document as unknown as { execCommand: unknown }).execCommand = () => false; // an editor that takes nothing
    expect(tryInsert("[lazyBoi form-fill request]")).toBe("rejected");
  });

  it("diagnose describes page structure and never includes chat text", () => {
    document.body.innerHTML =
      `<div data-message-author-role="assistant"><p>my private secret message</p></div>` +
      `<form><div id="prompt-textarea" contenteditable="true">draft with a secret</div><button data-testid="send-button"></button></form>`;
    rect(document.getElementById("prompt-textarea")!, 500);
    const d = diagnose();
    expect(d.assistantMessages).toBe(1);
    expect((d.composer as { id?: string }).id).toBe("prompt-textarea");
    expect((d.sendButton as { testid?: string }).testid).toBe("send-button");
    expect(JSON.stringify(d)).not.toContain("secret");
  });
});

describe("waitForReply (follow-up rounds)", () => {
  const block = (json: string) => `<pre><code>${json}</code></pre>`;

  it("ignores the previous round's reply and returns the new one for the same session", async () => {
    const first = '{"session":"lb-5","values":{"a":"round one"}}';
    document.body.innerHTML = block(first);
    setTimeout(() => document.body.insertAdjacentHTML("beforeend", block('{"session":"lb-5","values":{"b":"round two"}}')), 150);
    const r = await waitForReply("lb-5", 8000, JSON.stringify({ session: "lb-5", values: { a: "round one" } }));
    expect(r.ok && r.text).toContain("round two");
    expect(r.ok && r.text).not.toContain("round one");
  }, 12000);

  it("gives up with a clear message when only the old reply is there", async () => {
    document.body.innerHTML = block('{"session":"lb-5","values":{"a":"round one"}}');
    const r = await waitForReply("lb-5", 1500, JSON.stringify({ session: "lb-5", values: { a: "round one" } }));
    expect(r.ok).toBe(false);
  }, 6000);
});
