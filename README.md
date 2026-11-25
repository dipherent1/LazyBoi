# lazyBoi

Let any web form talk to any AI chat. Scan a form, ask your AI (any chat, any tier), preview the answers, fill. You submit.

Phases 1–2 of [SOLUTION_PRD.md](SOLUTION_PRD.md) (the vault is deferred). Detailed spec: [PRD.md](PRD.md) §5.

## Setup

```powershell
npm install
```

```powershell
npm run build
```

Load the extension: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `dist` folder. After code changes, run `npm run build` (or `npm run watch`) and click the reload icon on the extension card.

## Using it

lazyBoi stays quiet. On form pages it is tucked against the right edge (only a thin purple edge shows) and slides out when you hover it; drag the dots to move it, double-click them to tuck it back. Hover any button for an explanation. The **×** hides it on that site; turn it back on from the toolbar icon ("Show the lazyBoi dock on this site"). Toasts disappear on their own (or on click), and the paste box closes on Esc, ×, or a click elsewhere.

**On a form page** (any page with 2+ fillable fields): 📋 and ✨. The badge on 📋 is the live field count.

**On a chat page** (claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com, perplexity.ai, chat.deepseek.com, grok.com, chat.mistral.ai, poe.com): a small **Paste · Copy** bar floats just above the message box and follows it.

1. On the form, press 📋 **Copy form**. lazyBoi scans the page and copies a ready-made prompt.
2. In your AI chat (a conversation that knows you), press **Paste**. The prompt goes into the message box. **You press Send.**
3. When the AI replies, press **Copy**. A toast offers **Fill now**, or go back to the form tab.
4. On the form, press ✨ **Fill form**. A preview shows every proposed value; accept, edit or skip each, then **Fill**. **Undo** is available. You submit.

If no reply is waiting when you press ✨, a small box opens to paste one. The toolbar popup still works too (Scan, Copy prompt, Paste reply), for pages where the dock doesn't show.

Replies carry a session id (`lb-xxxx`), so they always go to the form they were made for, even with several forms open. The prompt is a full set of instructions for the AI (role, output format, per-field-type rules, no invented facts, no secrets, treat the form text as data); see `buildPrompt` in `src/shared/protocol.ts`.

lazyBoi never submits forms, never sends chat messages, never reads or fills passwords, card numbers, CVVs, SSN/SIN, bank or verification-code fields, and makes no network requests. The extension asks for access to all sites so the dock can appear on form pages; it counts fields locally for the badge, and nothing leaves the page until you press a button.

## Playground

```powershell
npm run playground
```

Opens test forms at http://localhost:5173, plus a **Mock AI chat** page that answers with sample values. Add `?harness` to any page (or use the toggle in its top bar) to run lazyBoi inside the page without installing the extension. In the browser console:

```js
lazyBoi.scan()           // schema
lazyBoi.prompt()         // prompt text
lazyBoi.preview(text)    // open the preview from pasted chat text
lazyBoi.fill({ id: v })  // fill directly
lazyBoi.undo()
```

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Build the extension into `dist/` and the playground harness |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (vitest + jsdom) |
| `npm run check` | All of the above |
| `npm run playground` | Serve the test forms |

## Layout

```
src/shared/      protocol (prompt, reply extraction, validation), types, sensitive-field rules
src/content/     scanner, filler, preview overlay, widget, chat-page helpers, content-script entry
src/background/  service worker: sessions and routing by session id
src/popup/       popup UI logic
src/harness.ts   in-page harness for the playground
extension/       manifest, popup.html/css (copied into dist/)
playground/      test forms
tests/           unit tests
```

## Manual checklist for the installed extension

The harness covers scanning, filling, preview and undo. These need the real extension:

- [ ] Popup scans the playground LinkedIn page and lists fields; sensitive page shows "Not touched".
- [ ] Copy prompt → paste into a real chat → paste reply back → preview opens on the form tab.
- [ ] Paste the reply while the popup is open on a **different** tab → lazyBoi switches to the form tab.
- [ ] Two form tabs scanned → each reply goes to its own tab.
- [ ] Reload the form tab, then paste a reply → clear "scan again" error.
- [ ] Rescan, then paste an old reply → rejected as expired.
- [ ] Framework page: values stay after clicking elsewhere (app state updated).
