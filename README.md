# lazyBoi

A Chrome extension that lets any web form talk to any AI chat. Press one button on a form, pick one of your open chat tabs (ChatGPT, Claude, Gemini, …), and the AI fills the form for you. You can undo, and you submit.

## How it works

1. Press ⚡ on a form. lazyBoi scans it and builds a prompt.
2. Pick an open chat tab. lazyBoi sends the prompt and waits for the reply.
3. It switches back and fills the form, with a one-click **Undo**.

No API keys, no server, no network requests: it drives the chat tabs you already have open. It never submits forms and skips passwords, card numbers, IDs and verification codes. Manual 📋 Copy / ✨ Paste buttons work with any chat.

## Setup

```powershell
npm install
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the `dist` folder.

## Try it without the extension

```powershell
npm run playground
```

Serves test forms (modals, iframes, frameworks, sensitive fields) and a mock AI chat at http://localhost:5173. This if specially good when developing and testing with AI

## Development

| Command                   | What it does                |
| ------------------------- | --------------------------- |
| `npm run build` / `watch` | Build into `dist/`          |
| `npm test`                | Unit tests (vitest + jsdom) |
| `npm run typecheck`       | TypeScript check            |
| `npm run check`           | All of the above            |

```
src/shared/      prompt, reply parsing, validation, sensitive-field rules
src/content/     scanner, filler, undo, widget, chat-page automation
src/background/  service worker (routes replies by session id)
src/popup/       toolbar popup
playground/      test forms
tests/           unit tests
docs/            design docs and manual test checklist
```

Built with TypeScript, Chrome Manifest V3 and esbuild. Design notes are in [docs/](docs/SOLUTION_PRD.md).
