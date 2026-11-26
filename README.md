# lazyBoi

Let any web form talk to any AI chat. Press one button on a form, pick one of your open chat tabs, and your AI (any chat, any tier) fills the form. You can undo, and you submit.

Phases 1–2 of [SOLUTION_PRD.md](SOLUTION_PRD.md) (the vault is deferred). Detailed spec: [PRD.md](PRD.md) §5.

## Setup

```powershell
npm install
```

```powershell
npm run build
```

Load the extension: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, choose the `dist` folder. After code changes, run `npm run build` (or `npm run watch`) and click the reload icon on the extension card. When you load or reload it, lazyBoi puts itself into the tabs you already have open, so you don't need to refresh them (before this, an already-open ChatGPT tab would have no widget until refreshed). The widget also re-attaches itself if a site's own code wipes it.

## Using it

lazyBoi stays out of the way until you reach for it. On a form page it is a faint purple sliver on the right edge. When lazyBoi spots a form on the page (2 or more fillable fields, including ones that appear a moment after load) it gives the sliver one small shake and a soft glow so you notice it, and the sliver gets a little brighter. Move the mouse to the edge and it glides out; move away and it tucks itself back. The shake is skipped if your system asks for reduced motion. On a chat page it is a small chip beside the message box that unfolds into **Paste · Copy** when you hover it. There is nothing to switch on. Hover any button for an explanation, and drag the dots to move the form widget. **×** hides it on that site; the toolbar icon shows a short description and a "Show the widget on this site" switch to bring it back.

**On a form page:** ⚡ **Fill with AI** (the one-button way), plus 📋 **Copy form** and ✨ **Paste into form** (the manual way).

**On a chat page** (claude.ai, chatgpt.com, gemini.google.com, copilot.microsoft.com, perplexity.ai, chat.deepseek.com, grok.com, chat.mistral.ai, poe.com): a small chip floats just above the message box and follows it; hover it for **Paste · Copy**.

### One button: ⚡ Fill with AI

1. On the form, press ⚡. lazyBoi scans the page right then.
2. A list **"Ask which chat?"** shows your open chat tabs. It asks every time; nothing is remembered. Pick one.
3. lazyBoi switches to that chat, puts the form in the message box, presses **Send**, and waits for the reply (up to 2 minutes).
4. It switches back to the form and fills it. A toast says what happened, with **Undo**.

### Dynamic forms and modals

- **Late forms:** lazyBoi keeps watching the page (including inside shadow roots, where sites like LinkedIn render their dialogs). When a form or modal opens, or 3+ new fields appear at once, the sliver gives its small shake again. It's counted at most about once a second, and less often on heavy pages.
- **Modals:** when a dialog is open (`aria-modal`, `<dialog>`, or a `role="dialog"` with 2+ fields), only the dialog is scanned, so the page's own search and message boxes aren't sent to the AI.
- **Fields that appear as you fill:** after the first answer is filled, lazyBoi rescans. If filling revealed new fields (picking "On-site" shows an address box, "Student" shows School), it asks the same chat for just those, up to 3 rounds. You get one combined result ("Filled 11 fields in 2 rounds") and one **Undo** that takes back every round. If a later round fails, what was already filled is kept and the toast says why.

If the chat's Send button can't be pressed, the form is left in the message box and you press Send yourself, then **Copy**. If no chat tab is open you're told to open one.

If a chat step fails (no message box found, text not accepted, Send not found, no reply), the error toast has a **Copy debug info** button. It copies the page's structure (element ids, roles, sizes; **no chat text**) so a chat site that behaves differently can be fixed.

### By hand: 📋 · Paste · Copy · ✨

1. On the form, press 📋 **Copy form**. lazyBoi scans the page and copies a ready-made prompt.
2. In your AI chat (a conversation that knows you), press **Paste**. The prompt goes into the message box. **You press Send.**
3. When the AI replies, press **Copy**. A toast offers **Fill now**, or go back to the form tab.
4. On the form, press ✨ **Paste into form**. There is no preview: it fills straight away and a toast says what happened, with **Undo**. You submit.

Values that can't be used (over a length limit, not one of the dropdown's options, a card-number-looking string) are **skipped and listed in the toast**, never truncated or guessed. If no reply is waiting when you press ✨, a small box opens to paste one. Toasts go away on their own (or on click); the paste box closes on Esc, ×, or a click elsewhere.

Replies carry a session id (`lb-xxxx`), so they always go to the form they were made for, even with several forms open. The prompt is a full set of instructions for the AI (role, output format, per-field-type rules, no invented facts, no secrets, treat the form text as data); see `buildPrompt` in `src/shared/protocol.ts`.

lazyBoi never submits forms, only sends a chat message when you press ⚡ and pick that chat, never reads or fills passwords, card numbers, CVVs, SSN/SIN, bank or verification-code fields, and makes no network requests. The extension asks for access to all sites so the widget can float on every page; it only scans a form when you press ⚡ or 📋.

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
src/content/     scanner, filler, session (apply + undo), widget, chat-page helpers, ask (send + wait), content-script entry
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
- [ ] ⚡ on a form lists your open chat tabs; picking one pastes, presses Send, and (after the reply) fills the form and returns you to it.
- [ ] ⚡ with a chat whose Send button isn't found leaves the form in the box and says so.
- [ ] Toolbar icon: description shows; unticking "Show the widget on this site" hides it there.
