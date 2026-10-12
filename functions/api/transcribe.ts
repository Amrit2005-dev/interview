/// <reference types="@cloudflare/workers-types" />

// Cloudflare Pages Function: POST /api/transcribe
// Cloud speech-to-text via Workers AI Whisper (free) — keeps heavy STT compute
// off the user's machine. Accepts a base64 audio file (WAV) and returns text.

interface Env {
  AI: Ai;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { audioBase64?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { audioBase64 = "" } = body;
  if (!audioBase64) {
    return Response.json({ error: "No audio provided" }, { status: 400 });
  }

  let bytes: any[];
  try {
    const bin = atob(audioBase64);
    bytes = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (err: any) {
    return Response.json({ error: `Audio Decode Error: ${err?.message || err}` }, { status: 400 });
  }

  try {
    const out: any = await env.AI.run("@cf/openai/whisper", { audio: bytes });
    return Response.json({ text: (out?.text || "").trim() });
  } catch (err: any) {
    return Response.json(
      { error: `Whisper error: ${err?.message || "unknown"}` },
      { status: 502 },
    );
  }
};
