import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js to use browser cache
env.allowLocalModels = false;
env.useBrowserCache = true;

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
      // Fallback to WASM if WebGPU not available
      return pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await generatorInstance!(messages, {
    max_new_tokens: Math.min(Math.max(text.length * 2, 200) + 100, 1000),
    temperature: 0.7,
    do_sample: true,
    return_full_text: false,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = Array.isArray(result) ? result[0] : result;
  if (output && typeof output === 'object' && 'generated_text' in output) {
    const generated = output.generated_text;
    if (Array.isArray(generated)) {
      const lastMsg = generated[generated.length - 1];
      return typeof lastMsg === 'object' && 'content' in lastMsg
        ? (lastMsg.content as string).trim()
        : String(lastMsg).trim();
    }
    return String(generated).trim();
  }
  return String(output).trim();
}

export function isModelLoaded(): boolean {
  return generatorInstance !== null;
}
