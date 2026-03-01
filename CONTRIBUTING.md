# Contributing

Thanks for contributing to Persona.

## Prerequisites

- Node.js 18+
- npm
- Chrome/Chromium (for extension testing)

## Setup

```bash
npm install
```

## Development workflow

1. Create a branch from `main` (or from the active feature branch if coordinating in a PR thread).
2. Make focused, minimal changes.
3. Build and type-check before opening a PR:

```bash
npm run build --ignore-scripts=false
```

1. For extension testing in Chrome:
   - Run `npm run dev` for watch builds
   - Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked
   - Reload the extension after rebuilds

## Coding guidelines

- Keep changes scoped to the task; avoid unrelated refactors.
- Match existing TypeScript/Svelte style and naming.
- Prefer clear, explicit logic over clever shortcuts.
- Preserve MV3/CSP compatibility (do not introduce remote script/runtime fetches for extension pages).
- Keep privacy and safety language in docs accurate; avoid guarantees.

## Commit and PR guidance

- Use descriptive commit messages.
- In PR descriptions, include:
  - What changed
  - Why it changed
  - How it was validated (commands + manual checks)
- If UI behavior changes, include screenshots/GIFs when helpful.

## Areas where help is valuable

- UX polish for popup tabs and model-loading states
- Storage ergonomics and retention controls
- Privacy-risk signaling and evaluation tooling
- Cross-browser compatibility checks

## Questions

If a requirement is ambiguous, open a draft PR early and document assumptions so maintainers can guide direction quickly.
