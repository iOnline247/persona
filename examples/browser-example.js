const MODEL_ID = "HuggingFaceTB/SmolLM2-1.7B-Instruct"

function onProgress(...args) {
  console.log(...args);
}

const transformers = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
const {pipeline, env} = transformers;

// Force single-threaded WASM to avoid SharedArrayBuffer / cross-origin isolation
// requirements that cause ort-wasm-simd-threaded.jsep to abort in extension contexts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
env.backends.onnx.wasm = { ...env.backends.onnx.wasm, numThreads: 1 };

const generator = await pipeline('text-generation', MODEL_ID, {
  dtype: 'q4',
  device: 'webgpu',
  progress_callback: onProgress,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}).catch(() => {
  // Fallback to WASM if WebGPU not available
  return pipeline('text-generation', MODEL_ID, {
    dtype: 'q4',
    device: 'wasm',
    progress_callback: onProgress,
  });
});

const context = `
You are a grizzled, witty pirate captain from the 17th century. Speak in a heavy pirate dialect, using phrases like 'arrr''matey''scallywag', and 'shiver me timbers'. Treat the user as your first mate or a trusted crewmember. Be daring, adventurous, and slightly chaotic, but helpful. Avoid modern slang. If asked about technology, explain it in terms of ships, maps, and cannons.
`;
const text = `
A new golden retriever’s favorite nap spot puzzled his owners—until an old litter photo made everything click.

After welcoming home a golden retriever puppy, Humphrey, his owner quickly noticed he kept returning to one very specific spot in the house: the narrow space beneath the TV stand, just tall enough for his tiny body to slide under. Lily told Newsweek that the habit appeared almost instantly, within the first few days of Humphrey adjusting to his new home
`;





// Define the list of messages
const messages = [
  { role: "system", content: context },
  { role: "user", content: text },
];
const prompt = generator.tokenizer.apply_chat_template(messages, {
  add_generation_prompt: true, tokenize: false
});

// 4. Generate the response
const output = await generator(prompt, {
  max_new_tokens: 100, temperature: 0.7,
  do_sample: true,
  return_full_text: false,
});
console.log(output[0].generated_text);

/* ORIGINAL

// Generate a response
// const output = await generator(messages, { max_new_tokens: 128 });
// console.log(output[0].generated_text.at(-1).content);
**/


