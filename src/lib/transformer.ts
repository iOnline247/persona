import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js to use browser cache
env.allowLocalModels = false;
env.useBrowserCache = true;

// Point ORT to the locally bundled WASM/MJS files so Chrome MV3's
// "script-src 'self'" CSP is satisfied (the default falls back to CDN).
// The 'ort/' directory is created by the copy-ort-wasm plugin in vite.config.ts.
// Also force single-threaded WASM to avoid SharedArrayBuffer requirements.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env.backends.onnx as any).wasm = {
  ...(env.backends.onnx as any).wasm,
  numThreads: 1,
  wasmPaths: chrome.runtime.getURL('ort/'),
};

const MODEL_ID = 'HuggingFaceTB/SmolLM2-135M-Instruct';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generatorInstance: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let loadingPromise: Promise<any> | null = null;

export type ProgressCallback = (progress: { status: string; progress?: number; file?: string }) => void;

export async function loadModel(onProgress?: ProgressCallback): Promise<void> {
  if (generatorInstance) return;
  if (!loadingPromise) {
    loadingPromise = (pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device: 'webgpu',
      progress_callback: onProgress,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as Promise<any>).catch(() => {
      // Fallback to WASM — explicitly set device:'wasm' so the non-JSEP
      // WASM backend is loaded instead of the WebGPU JSEP variant.
      return pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        device: 'wasm',
        progress_callback: onProgress,
      });
    });
  }
  generatorInstance = await loadingPromise;
}

export async function rewriteText(
  text: string,
  systemPrompt: string,
  onProgress?: ProgressCallback
): Promise<string> {
  if (!generatorInstance) {
    await loadModel(onProgress);
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Please rewrite the following text according to your style instructions. Return ONLY the rewritten text, no explanations or meta-commentary:\n\n${text}`,
    },
  ];

  // Build the prompt string via the tokenizer's chat template, matching the
  // pattern recommended for Transformers.js 3.x instruction-tuned models.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt: string = generatorInstance!.tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    tokenize: false,
  }) as string;

  const TOKEN_MULTIPLIER = 2;
  const MIN_BASE_TOKENS = 200;
  const TOKEN_BUFFER = 100;
  const MAX_TOTAL_TOKENS = 1000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = await generatorInstance!(prompt, {
    max_new_tokens: Math.min(Math.max(text.length * TOKEN_MULTIPLIER, MIN_BASE_TOKENS) + TOKEN_BUFFER, MAX_TOTAL_TOKENS),
    temperature: 0.7,
    do_sample: true,
    return_full_text: false,
  });

  return String(result[0].generated_text).trim();
}

export function isModelLoaded(): boolean {
  return generatorInstance !== null;
}
