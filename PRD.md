# lazyBoi — Product Requirements Document

Status: draft v0.1 · Scope: Phase B in detail, later phases at outline level

## 1. Problem

People build content (LinkedIn profile text, project blurbs, job-application answers) in AI chats, then re-type or copy/paste it field by field into web forms. The AI has the knowledge but no hands. The browser has hands but no knowledge.

## 2. Vision

lazyBoi is a browser extension that lets any web form talk to any AI chat. The extension reads a form, the AI (in the user's existing conversation) produces the content, and the extension fills the form. The user reviews and submits.

Principles:
- **Extension = hands, AI = brain.** The extension never invents content.
- **Chat-agnostic.** No model-specific logic in the core. Works with claude.ai, ChatGPT, others, on free tiers.
- **Human in the loop.** Always preview before fill. Never auto-submit.
- **Local-first.** No server we run, no key required, nothing leaves the browser except what the user sends in their own chat.
- **Swappable transport.** One JSON contract; copy/paste, chat-page adapters, or an MCP hub all deliver the same message.

## 3. Users

Primary: the author (single user, load-unpacked in Chrome). Keep the code clean enough to publish later.

## 4. Core concepts

**Form session.** Each scanned form tab gets an ID (e.g. `lb-7f3a`) holding `{id, tabId, url, schema, status, createdAt}`. Status: `scanned → awaiting_reply → previewing → filled | expired`. Sessions expire after 30 min. All routing is by session ID, so multiple forms and chats can be open at once.

**Schema (extension → AI).**
```json
{
  "v": 1,
  "session": "lb-7f3a",
  "page": { "title": "Edit profile", "url": "https://..." },
  "fields": [
    {
      "id": "f1", "label": "Headline", "type": "text",
      "required": true, "maxLength": 220, "placeholder": "...",
      "group": "Experience #1"
    },
    {
      "id": "f4", "label": "Employment type", "type": "select",
      "options": [{ "value": "ft", "label": "Full-time" }]
    }
  ],
  "skipped": ["password", "card number"]
}
```
Field types: `text, textarea, email, tel, url, number, date, select, multiselect, radio, checkbox, checkbox-group, richtext`. `file` and sensitive fields are never sent for filling.

**Reply (AI → extension).**
```json
{ "session": "lb-7f3a", "values": { "f1": "Software engineer…", "f4": "ft", "f7": ["a","b"], "f9": true } }
```
Rules: unknown field IDs are dropped; omitted fields are left untouched; values are validated against type, options, and `maxLength` before preview.

**Prompt protocol.** A self-describing text prompt wraps the schema: "Using what you know about me from this conversation, reply with ONE code block tagged `lazyboi` containing JSON `{session, values}`. Respect max lengths and options. Omit fields you don't know."

## 5. Phase B — MVP (this build)

Goal: the full loop works end-to-end with manual copy/paste as the transport, on a realistic test site.

### 5.1 Deliverables
1. **Chrome extension (Manifest V3)**
2. **Test site** simulating varied forms (section 5.4)
3. **Contract docs** (schema + reply, kept in this PRD and as TypeScript types / JSON schema)

### 5.2 Functional requirements

**Scanner (content script)**
- S1. Detect all fillable controls on the page, including inside same-origin iframes and open shadow DOM.
- S2. Resolve labels via `<label for>`, wrapping label, `aria-label`, `aria-labelledby`, placeholder, nearest preceding text.
- S3. Capture type, required, `maxLength`/`minLength`, `pattern`, select options, radio/checkbox groups, and section headings as `group`.
- S4. Assign stable field IDs per scan (index + short hash of name/label).
- S5. Detect and exclude sensitive fields: `type=password`, `autocomplete` tokens for `cc-*`, `one-time-code`, labels/names matching card/CVV/SSN/SIN/passport/bank/routing. Report them in `skipped`, never their values.
- S6. Re-scan on demand and on significant DOM change (dynamic/multi-step forms), keeping IDs stable where fields persist.

**Filler (content script)**
- F1. Set values for text-like inputs and textareas using the native value setter, then dispatch `input` and `change` (and `blur`) events so React/Vue-style frameworks register the change.
- F2. Handle `select`, `multiselect`, radio groups, single checkboxes, checkbox groups; match options by value first, then by label (case-insensitive).
- F3. Handle `contenteditable` rich-text editors via focus + `execCommand('insertText')` / input events.
- F4. Handle date inputs (ISO value) and number inputs.
- F5. Never click submit buttons. Never touch skipped fields.
- F6. Report per-field result: `filled | skipped | not_found | invalid`.

**Session manager (service worker)**
- M1. Create a session on scan; store schema and tab ID in `chrome.storage.session`.
- M2. Validate incoming replies: session exists, not expired, tab still open, field IDs known.
- M3. Route values to the correct tab by session ID.

**UI (popup + injected preview overlay)**
- U1. Popup on the form tab: **Scan form** → shows field count, skipped fields, and **Copy prompt** (prompt + schema to clipboard).
- U2. Popup: **Paste reply** textarea (accepts the raw chat text; the extension extracts the `lazyboi` code block or bare JSON) → validates → opens preview.
- U3. **Preview overlay** on the form page: table of field, current value, proposed value; per-row accept / edit / skip; warnings for over-length or invalid options.
- U4. **Fill** applies accepted rows; result summary shown; **Undo** restores previous values from the pre-fill snapshot.
- U5. Clear error messages: malformed JSON, wrong/expired session, unknown fields.

### 5.3 Non-functional requirements
- No network requests. No analytics. No remote code.
- Permissions: `activeTab`, `scripting`, `storage`, `clipboardRead`/`clipboardWrite`; host access only via `activeTab` for B.
- Plain JS or TypeScript with a minimal build; no framework required for the popup.
- Transport is isolated behind `getSchema()` and `deliverReply(session, values)` so later phases add transports without touching scanner/filler.
- Unit tests for scanner and filler logic against the test site (Playwright or similar).

### 5.4 Test site ("lazyBoi playground")
A small static site (plain HTML/JS, served locally) with several pages, each stressing a different case:

| Page | Contents |
|---|---|
| Basic | text, email, tel, url, number, date, textarea, with and without `maxLength`, required |
| Choices | select, multi-select, radio groups, checkbox, checkbox groups, datalist |
| LinkedIn-like profile | headline, about (long text with limit), repeated "Experience" and "Project" sections, month/year selects, "currently working here" toggle |
| Job application | multi-section, file upload (skipped), dropdowns, yes/no radios, free-text essays |
| Framework-style | inputs that ignore plain `.value` writes unless `input` events fire (React-like controlled inputs), to prove the filler works |
| Dynamic / multi-step | fields appear after a choice or "Next"; "Add another" buttons |
| Rich text | `contenteditable` editor |
| Iframe + shadow DOM | form inside an iframe and a web component with open shadow root |
| Sensitive | password, card number, CVV, SSN fields that must be skipped |
| Odd labels | `aria-label`, placeholder-only, label-after-input, unlabeled-with-name |

Each page shows a live "form state" panel so correct filling is visible, and a submit handler that only logs (to confirm the extension never submits).

### 5.5 Acceptance criteria
- A1. On every playground page, Scan produces a schema where every non-sensitive field has a sensible label and type.
- A2. Sensitive fields appear only in `skipped`, with no values, and are never filled.
- A3. Pasting a valid reply from a real chat (claude.ai or ChatGPT, manual) fills the correct fields with the framework-style page registering changes.
- A4. Reply with a wrong session ID, expired session, or unknown field IDs is rejected or partially applied with clear feedback.
- A5. Over-length values and invalid options are flagged in preview, never silently truncated.
- A6. Undo restores all pre-fill values.
- A7. Two form tabs open at once: replies route by session ID to the right tab.
- A8. Extension never submits a form and makes no network requests.

### 5.6 Out of scope for B
Chat-page adapters, auto-send, local profile, MCP/hub, Chrome Web Store packaging, multi-browser support, file uploads, CAPTCHA.

## 6. Later phases

**Phase 2 — Chat-page adapters.** Content scripts for claude.ai and chatgpt.com: `insertIntoComposer`, `watchReplies`, injected **Fill form** button on `lazyboi` code blocks. User still presses Send. Fallback: Phase B copy/paste. Exit: reply routes from chat tab to form tab with one click.

**Phase 3 — One-click orchestration.** "Fill with AI" on the form page: choose chat tab/conversation, insert and auto-send prompt, detect reply completion, parse, route to preview. Retry flow for malformed JSON ("fix your JSON" follow-up). Handles message caps and long forms by chunking. Exit: scan → preview in one click with no manual copy.

**Phase 4 — Local profile & quality.** One-time "build my profile" prompt that distills a chat into local structured JSON; use it for simple forms to save free-tier messages. Per-site adapters (LinkedIn, Workday, Greenhouse, Lever) for stubborn widgets. Field-mapping memory (remember label → field). History of fills.

**Phase 5 — Hub transport (optional).** MCP server exposing `list_open_forms`, `get_form_schema(session)`, `fill_form(session, values)`; local daemon for Claude Code/Desktop, optional cloud relay (extension connects outbound via WebSocket) for chats with remote MCP connectors on paid plans. Auth, pairing, and privacy policy required for cloud. Exit: "fill the form I have open" works from a connector-enabled chat.

**Phase 6 — Polish & distribution.** Settings, onboarding, accessibility, Chrome Web Store listing, privacy policy, more chat adapters (Gemini, Copilot, Perplexity).

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chat sites change DOM and break adapters | Small isolated adapters, selector fallbacks, copy/paste fallback always available |
| Frameworks ignore programmatic value changes | Native setter + event dispatch; playground "framework-style" page as regression test |
| Free-tier models return bad JSON | Strict validation, tolerant extraction, auto-retry (Phase 3) |
| Automating chat UIs may conflict with a site's terms | User-initiated, single action per click, user's own account; keep adapters optional |
| Sensitive data leakage | Never read or send sensitive fields; no network from the extension; preview before fill |
| Rich-text/custom widgets can't be filled generically | Per-site adapters (Phase 4), clear `not_found` reporting |

## 8. Open questions
- TypeScript or plain JS for the extension?
- Test runner: Playwright with a loaded unpacked extension, or manual checklist first?
- Should Undo persist across page reloads?
- Reply extraction: accept bare JSON without the `lazyboi` tag?
