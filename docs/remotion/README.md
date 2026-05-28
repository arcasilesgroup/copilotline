# Demo regeneration

This isolated Remotion project renders the README demo GIFs:

- `docs/demo-statusline.gif`: animated copilotline status ribbon
- `docs/demo-cli.gif`: `copilotline doctor` output reveal

Only regenerate when visible output changes.

```bash
cd docs/remotion
npm install

npm run render:gif:statusline
npm run render:gif:cli
npm run render:gif:all
```

Use `npm run studio` to live-preview either composition while tweaking.

The demo uses public-safe sample values only. Do not paste real tokens, raw
Copilot captures, usernames, or private repository paths into these assets.
