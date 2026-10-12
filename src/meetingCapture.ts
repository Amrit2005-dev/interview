// Captures the audio of a shared meeting tab/screen (Teams, Zoom, Webex, …) and
// transcribes it on-device with Whisper. Works with headphones because it taps
// the digital audio stream, not the microphone.
//
// Speech is segmented by pauses (a lightweight energy VAD): each spoken segment
// is sent to the Whisper worker and surfaced as a final transcript line.

export interface MeetingCallbacks {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

const SILENCE_RMS = 0.006; // below this = silence
const SILENCE_HANG_MS = 700; // pause length that ends a segment
const MIN_SEGMENT_MS = 600; // ignore blips shorter than this
const MAX_SEGMENT_MS = 18000; // force-flush very long monologues
const TARGET_RATE = 16000; // Whisper expects 16 kHz mono

// Linear-resample mono Float32 audio to 16 kHz.
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

export class MeetingTranscriber {
  private cb: MeetingCallbacks;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private worker: Worker | null = null;

  private segment: Float32Array[] = [];
  private segmentSamples = 0;
  private silenceSamples = 0;
  private inSpeech = false;
  private rate = 48000;
  private jobId = 0;
  private stopped = false;
  private ownsStream = true;

  constructor(cb: MeetingCallbacks) {
    this.cb = cb;
  }

  // `provided` lets the session share one screen-share with the screen watcher.
  async start(provided?: MediaStream) {
    if (provided) {
      this.stream = provided;
      this.ownsStream = false;
    } else {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        this.cb.onError("Screen/tab audio capture isn't supported in this browser. Use Chrome or Edge.");
        return;
      }
      try {
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints,
        });
      } catch (err) {
        this.cb.onError(`Capture cancelled: ${(err as Error).message}`);
        return;
      }
    }

    const audioTracks = this.stream.getAudioTracks();
    // Only stop the video track when we own the stream; a shared stream's video
    // is used by the screen watcher.
    if (this.ownsStream) this.stream.getVideoTracks().forEach((t) => t.stop());

    if (audioTracks.length === 0) {
      this.cb.onError(
        "No audio was shared. Re-share and tick “Share tab audio” (for a tab) or “Share system audio” (for the whole screen).",
      );
      this.cleanup();
      return;
    }

    // Ending the share (browser “Stop sharing” bar) ends the session.
    audioTracks[0].addEventListener("ended", () => this.stop());

    this.worker = new Worker(new URL("./whisperWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent) => {
      const { type, text, status, message } = e.data || {};
      if (type === "status") {
        if (status === "loading")
          this.cb.onStatus("Loading on-device speech model (one-time ~150 MB)…");
        else if (status === "ready")
          this.cb.onStatus("Listening to meeting audio…");
      } else if (type === "result") {
        this.cb.onInterim("");
        if (text) this.cb.onFinal(text);
      } else if (type === "error") {
        this.cb.onError(`Transcription error: ${message}`);
      }
    };
    this.worker.postMessage({ type: "preload" });

    this.ctx = new AudioContext();
    this.rate = this.ctx.sampleRate;
    const source = this.ctx.createMediaStreamSource(new MediaStream(audioTracks));
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);

    source.connect(this.processor);
    // Connect through a muted gain so the graph runs without echoing audio back.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(this.ctx.destination);

    this.processor.onaudioprocess = (e) => this.onAudio(e.inputBuffer.getChannelData(0));
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
      // Keep trailing silence as part of the segment until the hang time passes.
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
    if (this.segmentSamples === 0 || !this.worker) return this.reset();

    const merged = new Float32Array(this.segmentSamples);
    let offset = 0;
    for (const chunk of this.segment) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const audio = resampleTo16k(merged, this.rate);
    this.reset();

    this.cb.onInterim("🎙️ transcribing…");
    this.worker.postMessage({ type: "transcribe", id: ++this.jobId, audio }, [
      audio.buffer,
    ]);
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
    this.cleanup();
    this.cb.onEnd();
  }

  private cleanup() {
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
    this.worker?.terminate();
    this.worker = null;
  }
}
