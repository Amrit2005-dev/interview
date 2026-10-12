// One-shot screen reader: captures a single screenshot of a shared
// screen/window/tab and extracts its text with on-device OCR (Tesseract.js —
// free, no API). Triggered manually so it never interferes with the live audio.

const CAPTURE_WIDTH = 1600; // upscale small text for better OCR

export type OcrProgress = (message: string) => void;

export async function captureScreenText(onProgress?: OcrProgress): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture isn't supported here. Use Chrome or Edge.");
  }

  onProgress?.("Select the window to read…");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  let canvas: HTMLCanvasElement;
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 250));

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error("Could not read the screen frame.");

    const scale = Math.max(1, CAPTURE_WIDTH / vw);
    canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available.");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }

  onProgress?.("Reading the screen (OCR)…");
  const { default: Tesseract } = await import("tesseract.js");
  const result = await Tesseract.recognize(canvas, "eng");
  const text = (result.data.text || "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("No readable text found on the screen.");
  return text;
}
