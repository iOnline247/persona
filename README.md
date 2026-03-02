# Persona

Persona is a Chrome extension that rewrites text in different writing personas using a local in-browser model (`@huggingface/transformers`).  Nothing leaves your browser and is done locally on your own computer. No analytics, no API calls, just the LLM and your machine.

The motivation is to make writing style less consistent across posts and contexts, reducing straightforward stylometric linkability.

Reference paper: [Large-scale online deanonymization with LLMs](https://arxiv.org/pdf/2602.16800v2)

## Privacy and safety scope

Persona provides heuristic style transformation.
It does **not** guarantee anonymity or resistance against all authorship/deanonymization methods.
Use it as a privacy-assistance layer, not as a sole protection mechanism for high-risk use cases.

## Current features

- Local text rewriting with `HuggingFaceTB/SmolLM2-135M-Instruct`
- Multiple personas, random persona mode, or create your own
  - Academic Scholar
  - Casual Teen
  - Business Professional
  - Creative Storyteller
  - Minimalist
  - Verbose Elaborator
  - Tech Enthusiast
- WebGPU-first inference with WASM fallback
- Model download/cache progress in popup UI
- Per-website persona mapping (auto-select by current hostname)
- Draft save/load/delete
- Usage stats: transforms, characters processed, persona usage
- Copy rewritten output to clipboard

## Tech stack

- Svelte 5 + TypeScript
- Vite 6
- Chrome Extension Manifest V3
- `@huggingface/transformers` (Transformers.js)

## Project structure

```text
.
├── src
│   ├── background
│   │   └── service-worker.ts     # MV3 background worker
│   ├── lib
│   │   ├── personas.ts           # Persona definitions and prompts
│   │   ├── storage.ts            # chrome.storage.local helpers
│   │   └── transformer.ts        # Model load + rewrite pipeline
│   ├── popup
│   │   ├── App.svelte            # Main popup UI
│   │   └── main.ts               # Popup entrypoint
│   └── types
│       └── index.ts              # Shared types
├── public
│   ├── manifest.json             # Extension manifest
│   └── icons
├── package.json
└── vite.config.ts
```

## Developer Requirements

- Node.js 24+
- npm
- Chrome/Chromium with extension developer mode available

## Setup

```bash
npm ci --ignore-scripts
```

## Development

Watch-build extension assets into `dist/`:

```bash
npm run dev
```

Notes:

- This project uses build-watch for extension development (not a typical web HMR flow).
- Re-load the extension in Chrome after rebuilds.

## Build

Type-check and build production artifacts:

```bash
npm run build --ignore-scripts=false
```

This outputs a loadable extension in `dist/`.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` directory
5. Pin/open the Persona extension popup

## How it works

1. Popup initializes and loads saved state from `chrome.storage.local`
2. App asks background worker for current tab hostname
3. Persona is resolved (manual selection or website-specific mapping)
4. Model is loaded on demand (try `webgpu`, fallback to `wasm` if needed)

5. Input text is rewritten via chat-template prompt with selected persona instructions
6. Output can be copied or saved as draft; usage stats are updated

## MV3 / CSP notes

Chrome MV3 CSP can block runtime-loaded ORT files if they are fetched from a CDN.

This project handles that by:

- Bundling required ORT runtime files into `dist/ort/` at build time (`vite.config.ts` plugin)
- Pointing Transformers.js ONNX WASM backend to `chrome.runtime.getURL('ort/')` in `src/lib/transformer.ts`
- Using extension CSP in manifest:
  - `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`

If model loading fails, verify that `dist/ort/` contains:

- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`

## Permissions

From `public/manifest.json`:

- `storage` — persist settings, drafts, and usage stats locally
- `activeTab` — read current active tab URL to infer hostname for website persona mapping
- `clipboardWrite` — copy rewritten text to clipboard

## Data handling

- Data is stored in `chrome.storage.local`
- Stored items include:
  - selected persona
  - website persona mappings
  - drafts (original + rewritten text)
  - usage stats

## Limitations

- No formal deanonymization-risk score or confidence calibration yet
- No guarantee against semantic-linking attacks
- Rewrites are quality-dependent on local model behavior and browser runtime support
- First model load can be slow (download + initialization)

## License

See `LICENSE`.
