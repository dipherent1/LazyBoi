# lazyBoi — Solution Analysis & Implementation PRD

> **Note:** this is an early planning document. The shipped extension differs in places (see the README); the vault is future work.

Status: draft v0.2 · Supersedes the phase plan in `PRD.md` (v0.1). The contracts in `PRD.md` §4 (session, schema, reply) still hold and are reused here.

> **Update (v0.3 scope change):** the vault (Part 4.4, 4.5, and the vault pieces of Phases 2–3) is **deferred**: lazyBoi holds no stored user data for now. Phase 2 became **the on-page widget and chat-page buttons**: a dock on the right edge (📋 Copy form / ✨ Fill form on form pages; **Paste** / **Copy** on chat pages), hover explanations, and a stronger prompt. Built; see README. The vault sections stay below as future work.

---

## Part 1 — The problem, restated precisely

The user creates and accumulates knowledge in web AI chats (claude.ai, ChatGPT, …): profile facts, LinkedIn "About" text, project write-ups, job-application answers. Later, a web form asks for exactly that information. Today the user copies it field by field.

To remove that, four jobs must be done:

| Job | Question |
|---|---|
| **Knowledge** | Where does the information about the user live? |
| **Brain** | Who turns that knowledge into the right value for *this* field (rewording, fitting a 220-char limit, picking a dropdown option)? |
| **Hands** | Who reads the form and writes values into it so the site accepts them? |
| **Bridge** | How do brain and hands exchange "here is the form" / "here are the values"? |

Hard requirements from the user:
- **R1 Seamless** — close to one click from "I'm on a form" to "form is filled, I review".
- **R2 Free tiers** — must work with free claude.ai / ChatGPT accounts, no paid API required.
- **R3 Chat-agnostic** — not locked to one AI vendor.
- **R4 Uses existing chat context** — the knowledge already in conversations must be usable without re-explaining.
- Implied: **R5 Safe** (never auto-submit, never touch passwords/cards/IDs), **R6 Private** (no third-party server holding personal data unless the user opts in), **R7 Robust** (doesn't break every time a site redesigns).

---

## Part 2 — Every solution path considered

### A. Status quo: manual copy/paste per field
Baseline. Zero setup, maximal effort. Everything below is measured against it.

### B. Browser / password-manager autofill
Chrome, Edge, 1Password, Bitwarden fill name, email, address, phone, card.
- ✅ Free, instant, robust, already installed.
- ❌ Only structured basics. Can't write an "About" section, a project description, or answer "Why do you want this job?". Doesn't know your chats.
- **Role:** complement, not solution. lazyBoi should leave these fields to autofill or handle them from its own local profile.

### C. Vertical autofill products (e.g. job-application autofill extensions)
Tools that store a résumé-style profile and autofill job portals (Workday, Greenhouse, Lever…), some with AI-written answers.
- ✅ Very good on the sites they target; per-site engineering already done.
- ❌ One domain only (jobs). Their own profile, not your chats. Usually freemium with AI features behind a paywall. Not chat-agnostic.
- **Role:** proof the hands side is solvable; source of ideas for per-site adapters.

### D. AI agent browsers / browser agents
AI-first browsers and agent extensions from the chat vendors and others (OpenAI's ChatGPT browser with agent mode, Anthropic's Claude in Chrome, Perplexity's browser, Gemini in Chrome, Edge Copilot mode, …). The AI sees the page and clicks/types itself, often with access to its own memory.
- ✅ The most "seamless" in theory: "fill this form with my info" and it does it. Brain, hands and bridge in one product. Can use that vendor's memory.
- ❌ **Vendor-locked** (fails R3): Claude's agent only knows Claude chats; ChatGPT's only knows ChatGPT's.
- ❌ Agent features are frequently limited on free tiers or rate-limited (R2 risk; verify per product — this changes often).
- ❌ Slow (screenshot/step loops), occasionally clicks the wrong thing, and many will pause on sensitive fields anyway.
- ❌ Requires switching browser or granting an agent broad control.
- **Role:** the strongest competitor. If a user lives in one vendor and pays, this may be good enough. lazyBoi wins by being chat-agnostic, free-tier, faster (structured DOM fill instead of agent clicking), and reviewable.

### E. Desktop computer-use agents
An AI controlling the OS (screenshots + mouse/keyboard).
- ✅ Works on native apps and any site.
- ❌ Slowest and most error-prone; typically paid/developer access; vendor-locked; overkill for web forms.
- **Role:** out of scope.

### F. Schema protocol + manual copy/paste (former "Phase B")
Extension scans the form into JSON, user copies a prompt into any chat, pastes the reply back, extension previews and fills.
- ✅ Works with **every** chat, every tier, today. Uses the live conversation's context (R4). No server. Robust: no dependency on chat-site DOM.
- ❌ Two copy/paste hops (fails R1 alone).
- **Role:** the universal fallback and the foundation all other paths reuse.

### G. Extension drives the chat page (write + read adapters)
Content scripts on claude.ai / chatgpt.com insert the prompt into the composer, send it, wait for the reply, read the `lazyboi` block, and route it to the form tab.
- ✅ One click (R1), free tier (R2), any chat with an adapter (R3), uses the exact conversation that holds the context (R4), no server (R6).
- ❌ **Fragile**: chat sites change their DOM; auto-sending is UI automation that a site's terms may discourage. Each fill spends a free-tier message. Free models sometimes return malformed JSON.
- Sub-variant **G-read only**: the adapter only *reads* (detects blocks, adds buttons) and never types/sends. Much more stable and lower-risk; costs one click (user presses Send).

### H. "Harvest" — save chat output into a local vault, fill from the vault
Adapters add a **Save to lazyBoi** button on chat messages/code blocks. Content you create in chat ("here's your LinkedIn About section") is saved locally as a tagged snippet. Later, when you scan a form, lazyBoi matches fields to vault entries and fills them **without asking any AI**.
- ✅ This is exactly the original LinkedIn story: content made in chat → one click to save → forms fill from it later. Instant, free, zero messages spent, private, works offline. Read-only adapters (stable). Chat-agnostic (any chat whose text you can select — even without an adapter, via right-click "Save selection to lazyBoi").
- ❌ Only fills what you've saved. Matching "Project description" → the right snippet needs a decent matcher. Content may need light rewording for a new field's limit.
- **Role:** the cheapest path to "seamless" for repeated information. Strong pillar.

### I. Import chat history / memory exports
ChatGPT and Claude both let you export your data (conversations). lazyBoi imports the export file and builds a local knowledge base; or the user asks a chat once: "summarize everything you know about me as JSON" and imports that.
- ✅ Gets *all* existing knowledge in without per-message saving. Free. Chat-agnostic. One-time effort.
- ❌ Exports are large and noisy; need extraction (which needs a model — see J/K). Goes stale unless repeated. Export formats change.
- **Role:** onboarding accelerator for the vault (H). The "summarize me as JSON" prompt variant is simple and robust; the raw export importer is a later nice-to-have.

### J. Bring-your-own API key / free-tier APIs
The extension calls an LLM API directly (Anthropic, OpenAI, Google, OpenRouter, Groq…) with vault content as context. Several providers offer free API tiers with rate limits.
- ✅ Fast, background, no chat-page automation, very robust, structured output modes reduce bad JSON. Chat-agnostic at the model level.
- ❌ Needs a key (setup friction; some free tiers require an account and have usage/data terms). **Does not see live conversations** — only what's in the vault (fails R4 unless combined with H/I). Paid keys fail R2.
- **Role:** optional "brain provider" for power users and for rewording vault snippets to fit fields.

### K. On-device model (Chrome built-in AI / WebLLM)
Chrome ships an on-device model with a Prompt API available to extensions on supported hardware; WebLLM runs small models via WebGPU.
- ✅ Free, private, offline, no key, no message caps.
- ❌ Small model: fine for **matching fields to vault entries, classification, trimming to length**, weak for writing quality content. Availability depends on browser version, hardware, and a model download.
- **Role:** the local matcher/rewriter for H. Fall back to heuristic matching when unavailable.

### L. Remote MCP connector / chat app + cloud relay
A hosted MCP server (or ChatGPT app built on MCP) exposes `get_form_schema(session)` / `fill_form(session, values)`. The extension connects outbound to it via WebSocket. You say in the chat "fill my open form".
- ✅ The most natural UX: talk to the chat, form fills. No chat-page DOM dependency.
- ❌ Custom connectors are usually limited to paid plans or developer modes (fails R2 — verify current plans). Requires hosting, auth, account pairing, and personal data passing through a server (R6). Still pull-only: the chat acts only when asked.
- **Role:** premium optional transport, late phase.

### M. Local MCP hub (Claude Code / Claude Desktop / local agents)
Same tools, served locally; extension connects to `127.0.0.1`.
- ✅ Seamless for desktop/CLI users, private, free beyond the client.
- ❌ Web chats can't reach localhost. Not the user's main workflow (they use the web).
- **Role:** optional, cheap to add once L's tool contract exists.

### N. Clipboard bridge
Extension (or a tiny companion) notices when a `lazyboi` block is copied and offers to fill.
- ✅ Works with any chat, no adapter, removes one paste.
- ❌ Extensions can only read the clipboard on user gesture / with permission; background clipboard watching needs a native companion. Gains little over G-read.
- **Role:** small UX enhancement to F; optional.

### O. Embed the chat inside the extension (side panel/iframe)
- ❌ claude.ai / chatgpt.com block framing; logging in inside an iframe is not viable. Opening the chat in a small popup window is possible but is just G with a different window.
- **Role:** rejected.

### P. Bookmarklet / userscript
- ✅ No store install.
- ❌ No cross-tab messaging, no persistent storage across sites, no service worker. Can't route chat → form.
- **Role:** rejected (could be a demo only).

---

## Part 3 — Comparison

Scoring: ●●● strong · ●● ok · ● weak · ✗ fails

| Option | Seamless (R1) | Free tier (R2) | Chat-agnostic (R3) | Uses chat context (R4) | Private (R6) | Robust (R7) | Build effort | Ongoing maintenance |
|---|---|---|---|---|---|---|---|---|
| A Manual | ✗ | ●●● | ●●● | ●●● | ●●● | ●●● | none | none |
| B Browser autofill | ●●● (basics only) | ●●● | n/a | ✗ | ●●● | ●●● | none | none |
| C Vertical autofill | ●●● (jobs only) | ●● | ✗ | ✗ | ●● | ●●● | buy | none |
| D AI agent browsers | ●●● | ● | ✗ | ●●● (own vendor) | ●● | ●● | none | none |
| E Computer use | ●● | ✗ | ✗ | ●● | ●● | ● | — | — |
| F Copy/paste protocol | ● | ●●● | ●●● | ●●● | ●●● | ●●● | low | very low |
| G Chat write+read adapters | ●●● | ●●● | ●● | ●●● | ●●● | ● | medium | **high** |
| G-read only | ●● | ●●● | ●● | ●●● | ●●● | ●● | low–med | medium |
| H Harvest → vault | ●●● (repeat info) | ●●● | ●●● | ●● (what you saved) | ●●● | ●●● | medium | low |
| I Import / "summarize me" | ●● (one-time) | ●●● | ●●● | ●●● (snapshot) | ●●● | ●● | low–med | low |
| J BYO / free API | ●●● | ●● | ●●● | ✗ alone | ●● | ●●● | low | low |
| K On-device model | ●●● | ●●● | ●●● | ✗ alone | ●●● | ●● (availability) | medium | low |
| L Remote MCP + relay | ●●● | ✗ | ●● | ●●● | ● | ●●● | high | medium |
| M Local MCP hub | ●●● (desktop) | ●●● | ●● | ●●● | ●●● | ●●● | medium | low |
| N Clipboard bridge | ●● | ●●● | ●●● | ●●● | ●●● | ●● | low | low |

### What the comparison says
1. **No single option meets R1–R4 together.** Every option that is seamless is either vendor-locked (D), paid (L), fragile (G), or blind to live chats (J, K).
2. **Knowledge splits into two kinds**, and each has a different best solution:
   - **Reusable knowledge** (your name, school, LinkedIn About, project descriptions, standard answers) → **save once, fill forever locally** (H + I + K). Free, instant, private, robust.
   - **New content** (an answer specific to *this* job/form) → needs a brain with live context → **the chat** (F as fallback, G-read/G for one click), optionally an API (J).
3. **G is the only free + chat-agnostic + live-context path to one click**, but it's the most fragile. So it must sit on top of F (fallback always works) and G-read (stable buttons) rather than being the foundation.
4. **D is the real competitor.** lazyBoi's differentiators must be explicit: works with any chat, works on free tiers, fills from a local vault instantly without spending messages, structured and reviewable fills, and never locks you to one browser.

---

## Part 4 — Recommended solution: "Vault-first, chat-second, pluggable brains"

### 4.1 Concept
On any form, lazyBoi:
1. **Scans** the form (hands).
2. **Fills what it already knows** from the local vault, matched by heuristics or an on-device model — no AI chat needed, no message spent.
3. **Asks a brain only for the remainder**, using the best available provider: the user's chat tab (one click via adapter), copy/paste (always), or an optional API key.
4. **Previews** everything; the user accepts and fills; the user submits.
5. **Learns**: values the user accepts (and content they save from chats) go back into the vault, so the next similar form needs less AI.

### 4.2 Architecture

```
                         ┌──────────────── Extension (MV3) ─────────────────┐
 Form tab                │                                                  │        Chat tab(s)
 ┌──────────┐  scan/fill │  Session manager ── Fill planner ── Vault        │  adapters ┌──────────────┐
 │ content  │◀──────────▶│      │                  │           (IndexedDB)  │◀────────▶│ claude.ai     │
 │ script   │            │      │            Matcher (heuristic | on-device) │          │ chatgpt.com   │
 │ + preview│            │      │                  │                        │          │ … (more later)│
 └──────────┘            │  Brain providers: ChatTab · CopyPaste · API · Hub │          └──────────────┘
                         └──────────────────────────────────────────────────┘
```

Modules:
- **Scanner / Filler** — as specified in `PRD.md` §5.2 (S1–S6, F1–F6).
- **Session manager** — `{session, tabId, schema, status}` routing, as in `PRD.md` §4.
- **Vault** — local store of facts and snippets (§4.4).
- **Matcher** — maps schema fields → vault entries with confidence scores.
- **Fill planner** — decides per field: vault (confident) / brain (unknown or needs writing) / skip (sensitive, file).
- **Brain providers** — one interface, many implementations:
  ```ts
  interface BrainProvider {
    id: "copy-paste" | "chat-tab" | "api" | "hub";
    available(): Promise<boolean>;
    request(req: { session: string; fields: Field[]; context: VaultEntry[] }): Promise<Reply>;
  }
  ```
- **Chat adapters** — per-site modules used by the chat-tab provider and by harvesting:
  ```ts
  interface ChatAdapter {
    matches(url: URL): boolean;
    // read side (stable, Phase 2)
    observeMessages(cb: (msg: { el: Element; text: string; codeBlocks: CodeBlock[] }) => void): void;
    addMessageButton(el: Element, label: string, onClick: () => void): void;
    // write side (riskier, Phase 4)
    insertIntoComposer(text: string): Promise<void>;
    send(): Promise<void>;
    waitForReplyComplete(timeoutMs: number): Promise<string>;
  }
  ```

### 4.3 Contracts (unchanged from v0.1, extended)
- **Schema** and **Reply** JSON as in `PRD.md` §4, with session ID echo required.
- **Reply may include vault suggestions:** `"save": [{ "key": "linkedin.about", "value": "..." }]` so the chat can propose reusable facts.
- **Prompt protocol** gets two variants: full self-describing prompt (any chat) and a "context-light" variant that includes only the fields still unfilled after vault matching, to save tokens and messages.

### 4.4 Vault data model
```ts
type VaultEntry = {
  id: string;
  kind: "fact" | "snippet";
  key?: string;            // canonical key for facts, e.g. "contact.email", "edu.school"
  title: string;           // human label, e.g. "LinkedIn About (long)"
  value: string;
  tags: string[];          // e.g. ["linkedin", "about", "bio"]
  source: { type: "chat" | "manual" | "import" | "accepted-fill"; site?: string; url?: string; at: string };
  updatedAt: string;
};
```
- Stored in IndexedDB, local only. Export/import as JSON. Sensitive categories (passwords, card, government IDs) are refused at save time.
- A small canonical key set for common facts (`name.first`, `name.last`, `contact.email`, `contact.phone`, `address.*`, `edu.*`, `work.*`, `links.linkedin`, `links.github`, `bio.short`, `bio.long`) enables high-confidence matching; snippets are free-form with tags.

### 4.5 Matching
Order of strategies, first confident hit wins:
1. **Autocomplete tokens / input type** (`autocomplete="email"`, `type=tel`) → canonical facts.
2. **Label/name heuristics** — synonym tables ("Surname" → `name.last`, "Tell us about yourself" → `bio.*`).
3. **Previous accepted fills** for the same site + field signature.
4. **On-device model** (if available): rank vault entries for a field, choose dropdown options, trim/reword to `maxLength`.
5. Otherwise → send to brain.
Each match carries a confidence; below threshold → brain. Preview shows the source of every value ("from vault: LinkedIn About", "from Claude chat").

### 4.6 User experience

**Onboarding (≈1 minute)**
1. Install; lazyBoi explains in one screen: never submits, never touches passwords/cards/IDs, everything stays local.
2. "Teach lazyBoi about you" — choose any of: fill a short profile form; paste the result of a "summarize what you know about me as JSON" prompt (button copies the prompt); or skip.

**Saving from a chat (harvest)**
- In claude.ai / ChatGPT, every assistant message and code block gets a small **Save to lazyBoi** button. Click → title and tags are prefilled → saved.
- Anywhere else: select text → right-click → **Save to lazyBoi**.

**Filling a form**
1. On a form, click the lazyBoi icon (or the floating button) → **Fill**.
2. Instantly: fields found in the vault are filled into the preview ("8 of 12 ready").
3. For the rest, one button: **Ask my chat** (chosen chat tab) / **Copy prompt** / **Ask API** (if configured).
   - Phase 2: Ask → prompt is placed in your chat composer; you press Send; a **Fill form** button appears on the reply.
   - Phase 4: Ask → sent automatically; progress shown on the form page.
4. Preview: every field, its proposed value, source, and warnings; accept/edit/skip per row.
5. **Fill** → values written; summary; **Undo**. You submit.
6. "Save new answers to vault?" — one click to keep accepted chat-generated values for next time.

**Failure states (always graceful)**
- Adapter broken / chat redesigned → "Couldn't reach the chat page — use Copy prompt instead".
- Malformed reply → auto "please fix JSON" follow-up (Phase 4) or a clear message with the copy/paste path.
- Free-tier cap → plain message, fallback to vault-only fill + copy/paste.

### 4.7 Why this meets the requirements
| Req | How |
|---|---|
| R1 Seamless | Repeat info fills instantly from vault; new content one click (chat adapter) |
| R2 Free tiers | Vault + on-device + chat adapters + copy/paste need no paid plan or key |
| R3 Chat-agnostic | Text protocol + adapters + right-click save + copy/paste for any chat |
| R4 Chat context | Chat-tab provider asks the actual conversation; harvest/import moves chat knowledge into the vault |
| R5 Safe | Preview always, never submit, sensitive fields excluded at scan and at save |
| R6 Private | Local vault, no lazyBoi server; data leaves only via the user's own chat or chosen API |
| R7 Robust | Foundation (scan/fill/vault/copy-paste) doesn't depend on chat-site DOM; adapters are optional layers |

---

## Part 5 — Implementation phases

Each phase ships something usable on its own.

### Phase 1 — Core + copy/paste + playground (≈ former Phase B)
Scope: scanner, filler, session manager, preview overlay with undo, popup with Copy prompt / Paste reply, sensitive-field exclusion, playground test site. Full requirements and acceptance criteria: `PRD.md` §5.
Exit: any chat, any tier, fills any playground page correctly via copy/paste.

### Phase 2 — Vault + harvest + heuristic matching
- IndexedDB vault, vault manager page (list/search/edit/delete, export/import JSON).
- Right-click "Save selection to lazyBoi" (works on any site).
- Read-only chat adapters for claude.ai and chatgpt.com: **Save to lazyBoi** button on messages and code blocks; **Fill form** button on `lazyboi` reply blocks (routes by session ID).
- Matcher strategies 1–3; fill planner; preview shows value source.
- "Summarize me as JSON" onboarding prompt + import.
- "Save accepted answers to vault" after fill.
Exit: on the playground LinkedIn page, a second fill needs zero chat messages; chat replies fill with one click from the chat tab.

### Phase 3 — On-device intelligence
- Matcher strategy 4 with the browser's on-device model when available (feature-detected), else heuristics only.
- Local trimming/rewording to `maxLength`, dropdown option selection.
- Context-light prompts (only unmatched fields go to the chat).
Exit: measurable increase in vault-match rate on playground pages; no network calls added.

### Phase 4 — One-click chat orchestration
- Write-side adapters: insert, send, wait for completion, read reply.
- **Ask my chat** button on the form page; chat tab chosen once and remembered (per site optionally).
- Malformed-JSON auto-retry (1 attempt), long-form chunking, free-tier cap detection.
- Adapter health check + automatic fallback to Phase 2 behavior.
Exit: scan → preview in one click with a free claude.ai and a free ChatGPT account.

### Phase 5 — Optional brains & imports
- API provider (user-supplied key; providers with free tiers supported); structured-output mode; key stored locally.
- Chat export importers (ChatGPT, Claude) with extraction into vault (via API or on-device model, with user review before saving).
- Per-site fill adapters for stubborn widgets (LinkedIn, Workday, Greenhouse, Lever).

### Phase 6 — Hub transports (optional)
- Shared tool contract: `list_open_forms`, `get_form_schema(session)`, `fill_form(session, values)`, `search_vault(query)`.
- Local MCP hub for Claude Code / Desktop.
- Cloud relay + remote MCP connector for paid/developer chat plans (auth, pairing, encryption, privacy policy).

### Phase 7 — Polish & distribution
Onboarding polish, settings, accessibility, more chat adapters (Gemini, Copilot, Perplexity, DeepSeek…), Chrome Web Store listing, Edge/Firefox ports.

---

## Part 6 — Non-functional requirements
- **Privacy:** no telemetry by default; no lazyBoi servers before Phase 6; vault never synced unless the user exports it.
- **Security:** sensitive fields excluded at scan, fill and save; reply validation (session, field IDs, types, options, lengths); message passing restricted to the extension's own contexts; adapters never execute content from chat replies, only parse JSON.
- **Permissions:** minimal; `activeTab`, `scripting`, `storage`, `contextMenus`, host permissions only for supported chat sites (requested when the user enables an adapter).
- **Performance:** scan < 300 ms on typical forms; vault-only fill preview < 500 ms.
- **Maintainability:** adapters isolated, each with a selector-health self-test; contract types shared across modules.

## Part 7 — Success metrics (personal-use first)
- Time from opening a form to reviewed fill (target: < 30 s for a 10-field form with vault hits).
- Share of fields filled from the vault (target: > 60% after two weeks of use).
- Chat messages spent per form (target: ≤ 1).
- Fill accuracy: share of proposed values accepted without edit.
- Adapter breakages per month and time to recover (copy/paste fallback keeps this non-blocking).

## Part 8 — Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Chat-site DOM changes | Phase 2/4 buttons break | Isolated adapters, health checks, copy/paste fallback, read-side before write-side |
| Site terms on UI automation | Write-side adapters disallowed or blocked | User-initiated single actions, user's own account, write-side optional and off by default |
| Agent browsers improve and go free | Differentiation shrinks | Lean on chat-agnostic vault, instant local fills, privacy, reviewable structured fills |
| Wrong vault match | Wrong data in a field | Confidence threshold, source shown in preview, nothing written without review |
| Free-model JSON quality | Failed fills | Tolerant extraction, validation, one auto-retry, context-light prompts |
| On-device model unavailable | Weaker matching | Heuristics remain the baseline; feature detection |
| Sensitive data saved by mistake | Privacy | Save-time classifier refuses card/ID/password patterns; vault is local and exportable/deletable |

## Part 9 — Open questions
1. TypeScript + a light bundler (recommended) or plain JS?
2. Vault matching: start with heuristics only, or include the on-device model from Phase 2 behind a flag?
3. Should the floating on-page **Fill** button appear automatically on forms, or only via the toolbar icon?
4. Per-site memory of accepted fills — store field signatures per domain by default, or opt-in?
5. Which chat adapters after claude.ai and chatgpt.com?
