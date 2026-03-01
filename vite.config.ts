import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// ORT runtime files shipped by @huggingface/transformers that must be served
// locally so Chrome MV3's "script-src 'self'" CSP is satisfied.
// NOTE: this directory name must match the path used in src/lib/transformer.ts
//       where chrome.runtime.getURL('ort/') is set as wasmPaths.
const ORT_DEST_DIR = 'ort';
const ORT_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
];

export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'copy-ort-wasm',
      closeBundle() {
        const srcDir = resolve(__dirname, 'node_modules/@huggingface/transformers/dist');
        const destDir = resolve(__dirname, 'dist', ORT_DEST_DIR);
        mkdirSync(destDir, { recursive: true });
        for (const file of ORT_FILES) {
          const src = resolve(srcDir, file);
          if (!existsSync(src)) {
            throw new Error(
              `[copy-ort-wasm] Expected ORT file not found: ${src}\n` +
              `  Ensure @huggingface/transformers is installed and its dist/ folder contains ${file}.`
            );
          }
          copyFileSync(src, resolve(destDir, file));
        }
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
