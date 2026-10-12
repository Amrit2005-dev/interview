// Cloud speech-to-text capture. Takes any audio MediaStream (microphone or
// shared meeting audio), segments speech by pauses (energy VAD), encodes each
// segment to 16 kHz WAV, and sends it to /api/transcribe (Workers AI Whisper).
// All heavy inference runs in the cloud — the device only captures + encodes,
// so it stays responsive even on modest hardware (and works inside Electron,
// where the browser Web Speech API does not).

export interface CloudSttCallbacks {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

const SILENCE_RMS = 0.006;
const SILENCE_HANG_MS = 700;
const MIN_SEGMENT_MS = 500;
const MAX_SEGMENT_MS = 18000;
const TARGET_RATE = 16000;

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input;
  const ratio = inputRate / TARGET_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(bin);
}

export class CloudTranscriber {
  private cb: CloudSttCallbacks;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private ownsStream: boolean;

  private segment: Float32Array[] = [];
  private segmentSamples = 0;
  private silenceSamples = 0;
  private inSpeech = false;
  private rate = 48000;
  private stopped = false;

  // If ownsStream, the transcriber stops the tracks on stop().
  constructor(cb: CloudSttCallbacks, ownsStream = true) {
    this.cb = cb;
    this.ownsStream = ownsStream;
  }

  start(stream: MediaStream) {
    this.stream = stream;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.cb.onError("No audio track to transcribe.");
      return;
    }
    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(new MediaStream(audioTracks));
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    source.connect(this.processor);
    const sink = this.ctx.createGain();
    sink.gain.value = 0; // run the graph silently (no echo)
    this.processor.connect(sink);
    sink.connect(this.ctx.destination);
    this.processor.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
    this.cb.onStatus("Listening…");
  }

  private onAudio(input: Float32Array) {
    if (this.stopped) return;
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const segMs = (this.segmentSamples / this.rate) * 1000;

    if (rms > SILENCE_RMS) {
      this.inSpeech = true;
      this.silenceSamples = 0;
      this.segment.push(new Float32Array(input));
      this.segmentSamples += input.length;
      if (segMs >= MAX_SEGMENT_MS) this.flush();
    } else if (this.inSpeech) {
      this.segment.push(new Float32Array(input));
      this.segmentSamples += input.length;
      this.silenceSamples += input.length;
      if ((this.silenceSamples / this.rate) * 1000 >= SILENCE_HANG_MS) {
        if (segMs >= MIN_SEGMENT_MS) this.flush();
        else this.reset();
      }
    }
  }

  private flush() {
    if (this.segmentSamples === 0) return this.reset();
    const merged = new Float32Array(this.segmentSamples);
    let offset = 0;
    for (const chunk of this.segment) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.reset();

    const audio16k = resampleTo16k(merged, this.rate);
    const wav = encodeWav(audio16k, TARGET_RATE);
    const audioBase64 = bytesToBase64(wav);
    this.cb.onInterim("🎙️ transcribing…");
    this.transcribe(audioBase64);
  }

  private async transcribe(audioBase64: string) {
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64 }),
      });
      const j = await res.json();
      this.cb.onInterim("");
      if (!res.ok) {
        this.cb.onError(j?.error || `Transcribe failed (${res.status})`);
        return;
      }
      const text = (j.text || "").trim();
      // Whisper sometimes emits bracketed noise tokens for silence/music.
      if (text && !/^[\[(].*[\])]$/.test(text)) this.cb.onFinal(text);
    } catch (err) {
      this.cb.onInterim("");
      this.cb.onError(`Transcribe error: ${(err as Error).message}`);
    }
  }

  private reset() {
    this.segment = [];
    this.segmentSamples = 0;
    this.silenceSamples = 0;
    this.inSpeech = false;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.processor?.disconnect();
    } catch {
      /* noop */
    }
    this.processor = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.cb.onEnd();
  }
}
