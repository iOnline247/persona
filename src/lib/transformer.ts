import { pipeline, env, type TextGenerationPipeline } from '@huggingface/transformers';
import { redactSensitive } from './redaction.js';
import { assessRisk } from './risk.js';

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

let generatorInstance: TextGenerationPipeline | null = null;
let loadingPromise: Promise<TextGenerationPipeline> | null = null;

export type ProgressCallback = (progress: { status: string; progress?: number; file?: string }) => void;

export async function loadModel(onProgress?: ProgressCallback): Promise<void> {
  if (generatorInstance) {
    return;
  }

  if (!loadingPromise) {
    loadingPromise = (pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device: 'webgpu',
      progress_callback: onProgress,
    }) as Promise<unknown> as Promise<TextGenerationPipeline>).catch(() => {
      // Fallback to WASM — explicitly set device:'wasm' so the non-JSEP
      // WASM backend is loaded instead of the WebGPU JSEP variant.
      return pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        device: 'wasm',
        progress_callback: onProgress,
      });
    }) as Promise<unknown> as Promise<TextGenerationPipeline>;
  }

  generatorInstance = await loadingPromise;
}

import type { RiskSignal } from './risk.js';

export interface RewriteResult {
  output: string;
  rounds: number;
  divergence: number;
  riskScore: number;
  confidence: number;
  signals: RiskSignal[];
}

// Character bigram Jaccard divergence (0 = identical, 1 = completely different)
function charBigramDivergence(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(normalize(a));
  const bb = bigrams(normalize(b));
  let intersection = 0;
  for (const bg of ba) { if (bb.has(bg)) intersection++; }
  const union = ba.size + bb.size - intersection;
  return union === 0 ? 0 : 1 - intersection / union;
}

async function _doRewrite(
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

const TARGET_DIVERGENCE = 0.70;
const MAX_ROUNDS = 3;

export async function rewriteText(
  text: string,
  systemPrompt: string,
  onProgress?: ProgressCallback
): Promise<RewriteResult> {
  // 1. Redact direct identifiers before sending to the model
  const { redactedText } = redactSensitive(text);

  let current = redactedText;
  let rounds = 0;
  let divergence = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    rounds = round;
    // On retry rounds, push the model harder to diverge
    const prompt =
      round === 1
        ? systemPrompt
        : systemPrompt +
          '\n\nIMPORTANT: Your previous rewrite was too similar to the source text. ' +
          'You MUST restructure every sentence, swap out synonyms aggressively, ' +
          'and use completely different phrasing throughout. Do not preserve original wording.';

    current = await _doRewrite(current, prompt, onProgress);
    divergence = charBigramDivergence(redactedText, current);
    if (divergence >= TARGET_DIVERGENCE) break;
  }

  // 2. Assess residual risk on the output
  const risk = assessRisk(current);

  return {
    output: current,
    rounds,
    divergence,
    riskScore: risk.score,
    confidence: risk.confidence,
    signals: risk.signals,
  };
}

export function isModelLoaded(): boolean {
  return generatorInstance !== null;
}
