# Manual test checklist

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
