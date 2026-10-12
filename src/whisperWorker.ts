/// <reference lib="webworker" />
// On-device speech-to-text with Whisper (transformers.js). Runs entirely in the
// browser — no API, no key, no cost. Used to transcribe captured meeting audio.

import { pipeline, env } from "@huggingface/transformers";

// Always fetch weights from the HF CDN (no local model files bundled).
env.allowLocalModels = false;

let asr: any = null;
let loading: Promise<any> | null = null;

async function load() {
  if (asr) return asr;
  if (!loading) {
    (self as any).postMessage({ type: "status", status: "loading" });
    loading = (async () => {
      const hasWebGPU = "gpu" in (self as any).navigator;
      try {
        asr = await pipeline(
          "automatic-speech-recognition",
          "Xenova/whisper-base.en",
          hasWebGPU ? { device: "webgpu" } : {},
        );
      } catch {
        // Fall back to WASM if WebGPU init fails.
        asr = await pipeline(
          "automatic-speech-recognition",
          "Xenova/whisper-base.en",
        );
      }
      (self as any).postMessage({ type: "status", status: "ready" });
      return asr;
    })();
  }
  return loading;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, audio } = e.data || {};

  if (type === "preload") {
    load().catch((err) =>
      (self as any).postMessage({ type: "error", message: String(err) }),
    );
    return;
  }

  if (type === "transcribe") {
    try {
      const p = await load();
      // whisper-base.en is English-only — do NOT pass `language`/`task`.
      const out = await p(audio, { chunk_length_s: 30 });
      const text = (Array.isArray(out) ? out[0]?.text : out?.text) || "";
      (self as any).postMessage({ type: "result", id, text: text.trim() });
    } catch (err) {
      (self as any).postMessage({
        type: "error",
        id,
        message: (err as Error).message,
      });
    }
  }
};
