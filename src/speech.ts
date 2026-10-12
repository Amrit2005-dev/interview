// Thin wrapper around the browser SpeechRecognition API.
//
// Note: the Web Speech API transcribes the default microphone. In an interview
// it captures whatever your mic hears (the interviewer over your speakers, plus
// you). For cleaner separation of the interviewer's audio you'd swap this layer
// for a streaming STT service (Deepgram, Whisper, etc.) fed by tab/system audio
// captured via getDisplayMedia — the rest of the app stays the same.

// Minimal typings — these interfaces are not in the default DOM lib.
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): { transcript: string };
  [index: number]: { transcript: string };
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  };
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface TranscriberCallbacks {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export class Transcriber {
  private recognition: SpeechRecognitionLike | null = null;
  private shouldRun = false;
  private cb: TranscriberCallbacks;

  constructor(cb: TranscriberCallbacks) {
    this.cb = cb;
  }

  start(lang = "en-US") {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.cb.onError("Speech recognition is not supported in this browser. Use Chrome or Edge.");
      return;
    }
    this.shouldRun = true;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const trimmed = text.trim();
          if (trimmed) this.cb.onFinal(trimmed);
        } else {
          interim += text;
        }
      }
      this.cb.onInterim(interim);
    };

    rec.onerror = (e: Event) => {
      const err = (e as unknown as { error?: string }).error || "unknown";
      // "no-speech" and "aborted" are normal during pauses/stops — ignore them.
      if (err !== "no-speech" && err !== "aborted") {
        this.cb.onError(`Speech error: ${err}`);
      }
    };

    rec.onend = () => {
      // The API stops on its own after silence; restart if we're still listening.
      if (this.shouldRun) {
        try {
          rec.start();
        } catch {
          /* already starting */
        }
      } else {
        this.cb.onEnd();
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.cb.onError(`Could not start microphone: ${(err as Error).message}`);
    }
  }

  stop() {
    this.shouldRun = false;
    this.recognition?.stop();
    this.recognition = null;
  }
}
