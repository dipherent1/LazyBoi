import { describe, expect, it } from "vitest";
import manifest from "../extension/manifest.json";
import { CHAT_HOSTS } from "../src/shared/chat-hosts";

describe("manifest", () => {
  it("can see tabs on every chat site (needed to list them in the Fill with AI picker)", () => {
    const perms = manifest.host_permissions;
    // "<all_urls>" covers them all; otherwise each chat site must be listed.
    const covered = (host: string) => perms.includes("<all_urls>") || perms.includes(`*://*.${host}/*`);
    for (const host of CHAT_HOSTS) expect(covered(host), `no access to ${host}`).toBe(true);
  });

  it("can inject into tabs that were already open when the extension was installed or reloaded", () => {
    expect(manifest.host_permissions).toContain("<all_urls>");
    expect(manifest.permissions).toContain("scripting");
  });

  it("runs the content script (and so the widget) on every page", () => {
    expect(manifest.content_scripts[0]?.matches).toEqual(["<all_urls>"]);
    expect(manifest.content_scripts[0]?.js).toEqual(["content.js"]);
  });
});
