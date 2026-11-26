# lazyBoi

Let any web form talk to any AI chat. Copy a form, ask your AI (any chat, any tier), paste the answer in: it fills, you can undo, you submit.

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

A small widget floats on every page. There is nothing to switch on: the toolbar icon only shows a short description and a "Show the widget on this site" switch. Hover any button for an explanation. Drag the dots to move the widget, double-click them to tuck it to the edge. **×** hides it on that site (bring it back from the toolbar icon).

**On a form page:** 📋 **Copy form** and ✨ **Paste into form**.

**On a chat page** (claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com, perplexity.ai, chat.deepseek.com, grok.com, chat.mistral.ai, poe.com): a small **Paste · Copy** bar floats just above the message box and follows it.

1. On the form, press 📋 **Copy form**. lazyBoi scans the page right then and copies a ready-made prompt.
2. In your AI chat (a conversation that knows you), press **Paste**. The prompt goes into the message box. **You press Send.**
3. When the AI replies, press **Copy**. A toast offers **Fill now**, or go back to the form tab.
4. On the form, press ✨ **Paste into form**. There is no preview: it fills straight away and a toast says what happened, with **Undo**. You submit.

Values that can't be used (over a length limit, not one of the dropdown's options, a card-number-looking string) are **skipped and listed in the toast**, never truncated or guessed. If no reply is waiting when you press ✨, a small box opens to paste one. Toasts go away on their own (or on click); the paste box closes on Esc, ×, or a click elsewhere.

Replies carry a session id (`lb-xxxx`), so they always go to the form they were made for, even with several forms open. The prompt is a full set of instructions for the AI (role, output format, per-field-type rules, no invented facts, no secrets, treat the form text as data); see `buildPrompt` in `src/shared/protocol.ts`.

lazyBoi never submits forms, never sends chat messages, never reads or fills passwords, card numbers, CVVs, SSN/SIN, bank or verification-code fields, and makes no network requests. The extension asks for access to all sites so the widget can float on every page; it only scans a form when you press 📋.

## Playground

```powershell
npm run playground
```

Opens test forms at http://localhost:5173, plus a **Mock AI chat** page that answers with sample values. Add `?harness` to any page (or use the toggle in its top bar) to run lazyBoi inside the page without installing the extension. In the browser console:

```js
lazyBoi.scan()           // schema
lazyBoi.prompt()         // prompt text
lazyBoi.apply(text)      // fill from pasted chat text (returns what was filled/skipped)
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
src/content/     scanner, filler, session (apply + undo), widget, chat-page helpers, content-script entry
src/background/  service worker: sessions and routing by session id
src/popup/       popup (description + per-site switch)
src/harness.ts   in-page harness for the playground
extension/       manifest, popup.html/css (copied into dist/)
playground/      test forms
tests/           unit tests
```

## Manual checklist for the installed extension

The harness covers scanning, filling and undo. These need the real extension:

- [ ] The widget floats on a normal page, and on a chat site shows the Paste · Copy bar above the message box.
- [ ] 📋 on the playground LinkedIn page copies a prompt; the sensitive page lists nothing sensitive in it.
- [ ] Paste in a real chat puts the prompt in the message box (if not, it copies it and says so).
- [ ] Copy on the AI's reply → ✨ on the form tab fills, shows the toast, and Undo restores.
- [ ] Two form tabs copied → each reply fills its own tab.
- [ ] Reload the form tab, then press ✨ → a clear "copy the form again" message.
- [ ] Framework page: values stay after clicking elsewhere (app state updated).
- [ ] Toolbar icon: description shows; unticking "Show the widget on this site" hides it there.
