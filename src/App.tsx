import { useCallback, useEffect, useRef, useState } from "react";
import { CloudTranscriber } from "./cloudStt";
import { streamAnswer } from "./api";
import { captureScreenText } from "./screen";
import { openOverlay, updateOverlay, closeOverlay } from "./overlay";
import ResumeField from "./ResumeField";

type Source = "mic" | "meeting";

interface TranscriptLine {
  id: number;
  text: string;
}

interface AnswerEntry {
  id: number;
  question: string;
  text: string;
  done: boolean;
}

export default function App() {
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [showContext, setShowContext] = useState(true);
  const [showTranscript, setShowTranscript] = useState(true);

  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [autoMode, setAutoMode] = useState(true);
  const [source, setSource] = useState<Source>("mic");
  const [status, setStatus] = useState("");
  const [manualQuestion, setManualQuestion] = useState("");

  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const sessionRef = useRef<{ stop: () => void }[]>([]);
  const cancelRef = useRef<(() => void) | null>(null);
  const lineIdRef = useRef(0);
  const answerIdRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const answerEndRef = useRef<HTMLDivElement | null>(null);

  const ctxRef = useRef({ resume, jobDescription, autoMode, lines });
  useEffect(() => {
    ctxRef.current = { resume, jobDescription, autoMode, lines };
  }, [resume, jobDescription, autoMode, lines]);

  const generate = useCallback((question: string, label?: string) => {
    if (!question.trim()) return;
    cancelRef.current?.();
    setError("");
    setGenerating(true);

    const id = answerIdRef.current++;
    // Mark any still-streaming entry as done (its request was just cancelled)
    // and append a fresh entry — previous answers are kept in the history.
    setAnswers((prev) => [
      ...prev.map((a) => (a.done ? a : { ...a, done: true })),
      { id, question: label ?? question, text: "", done: false },
    ]);

    const patch = (fn: (a: AnswerEntry) => AnswerEntry) =>
      setAnswers((prev) => prev.map((a) => (a.id === id ? fn(a) : a)));

    const { resume, jobDescription, lines } = ctxRef.current;
    const transcript = lines.map((l) => l.text).join("\n");

    cancelRef.current = streamAnswer(
      { resume, jobDescription, transcript, question },
      (chunk) => patch((a) => ({ ...a, text: a.text + chunk })),
      () => {
        patch((a) => ({ ...a, done: true }));
        setGenerating(false);
      },
      (msg) => {
        setError(msg);
        patch((a) => ({ ...a, done: true }));
        setGenerating(false);
      },
    );
  }, []);

  const handleFinal = useCallback(
    (text: string) => {
      setLines((prev) => [...prev, { id: lineIdRef.current++, text }]);
      setInterim("");
      if (ctxRef.current.autoMode) generate(text);
    },
    [generate],
  );

  // Manual one-shot: read the question/coding problem currently on screen.
  const readScreen = useCallback(async () => {
    setError("");
    setReading(true);
    try {
      const text = await captureScreenText((m) => setStatus(m));
      setStatus("");
      generate(text, "📷 On-screen question");
    } catch (err) {
      setError((err as Error).message);
      setStatus("");
    } finally {
      setReading(false);
    }
  }, [generate]);

  // Pop the always-on-top live overlay. Its own gesture, so it opens reliably.
  const popOverlay = useCallback(() => {
    void openOverlay().then((ok) => {
      if (ok) updateOverlay(answers, status);
      else
        setError(
          "Couldn't open the overlay. Allow pop-ups for this site, and use Chrome or Edge for the always-on-top window.",
        );
    });
  }, [answers, status]);

  const stopSession = useCallback(() => {
    sessionRef.current.forEach((s) => s.stop());
    sessionRef.current = [];
    cancelRef.current?.();
    closeOverlay();
    setRunning(false);
    setInterim("");
    setStatus("");
  }, []);

  // One click = live overlay (best-effort) + audio transcription. Screen reading
  // is a separate manual button so it never interferes with the audio.
  const startSession = useCallback(async () => {
    setError("");
    void openOverlay().then((ok) => ok && updateOverlay(answers, status));

    const stoppers: { stop: () => void }[] = [];
    try {
      let stream: MediaStream;
      if (source === "meeting") {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          } as MediaTrackConstraints,
        });
        // Don't need the video for audio-only transcription.
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          closeOverlay();
          setError(
            'No meeting audio captured. Stop and re-share, picking "Entire Screen" ' +
            '(tick Share system audio) or a browser "Tab" (tick Share tab audio). ' +
            'A single app "Window" cannot include audio.',
          );
          return;
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const ct = new CloudTranscriber(
        {
          onFinal: handleFinal,
          onInterim: setInterim,
          onStatus: setStatus,
          onError: setError,
          onEnd: () => { },
        },
        true,
      );
      ct.start(stream);
      stoppers.push(ct);

      sessionRef.current = stoppers;
      setRunning(true);
    } catch (err) {
      stoppers.forEach((s) => s.stop());
      closeOverlay();
      setError(`Couldn't start: ${(err as Error).message}`);
    }
  }, [source, answers, status, handleFinal]);

  const toggleSession = () => (running ? stopSession() : void startSession());

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, interim]);

  useEffect(() => {
    answerEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    updateOverlay(answers, status);
  }, [answers, status]);

  useEffect(() => {
    return () => {
      sessionRef.current.forEach((s) => s.stop());
      cancelRef.current?.();
      closeOverlay();
    };
  }, []);

  const lastQuestion = lines.length ? lines[lines.length - 1].text : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path
                d="M12 3v9m0 0a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v3a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0m6 9v3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="brand-name">Interview&nbsp;Copilot</span>
        </div>

        <div className="controls">
          <div className="seg" role="tablist" aria-label="Audio source">
            <button
              className={source === "mic" ? "on" : ""}
              onClick={() => setSource("mic")}
              disabled={running}
            >
              Microphone
            </button>
            <button
              className={source === "meeting" ? "on" : ""}
              onClick={() => setSource("meeting")}
              disabled={running}
            >
              Meeting audio
            </button>
          </div>

          <label className="toggle">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
            />
            <span className="track">
              <span className="thumb" />
            </span>
            <span className="toggle-label">Auto-answer</span>
          </label>

          <button
            className="btn btn-secondary"
            onClick={popOverlay}
            title="Pop out the always-on-top live answers overlay"
          >
            ⧉ Overlay
          </button>

          <button
            className={`btn ${running ? "btn-stop" : "btn-primary"}`}
            onClick={toggleSession}
          >
            {running ? (
              <>
                <span className="rec-dot" /> Stop
              </>
            ) : (
              "Start"
            )}
          </button>
        </div>
      </header>

      {status && <div className="status">{status}</div>}

      <section className="context-wrap">
        <button
          className="context-toggle"
          onClick={() => setShowContext((s) => !s)}
        >
          <span className={`chev ${showContext ? "open" : ""}`}>›</span>
          Context · resume &amp; job description
        </button>

        {showContext && (
          <div className="context">
            <ResumeField value={resume} onChange={setResume} />
            <div className="field">
              <label>Job description</label>
              <textarea
                placeholder="Paste the job description (optional)."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </div>
          </div>
        )}
      </section>

      {error && <div className="error">{error}</div>}

      <main className="stack">
        <section className="card collapsible">
          <div className="collapse-head">
            <button
              className="collapse-btn"
              onClick={() => setShowTranscript((s) => !s)}
              aria-expanded={showTranscript}
            >
              <span className={`chev ${showTranscript ? "open" : ""}`}>›</span>
              <h2>Transcript</h2>
              {lines.length > 0 && <span className="count">{lines.length}</span>}
            </button>
            <div className="card-head-right">
              {running && (
                <span className="live">
                  <span className="rec-dot" /> Live
                </span>
              )}
              {lines.length > 0 && (
                <button className="link" onClick={() => setLines([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {showTranscript && (
            <div className="transcript compact">
              {lines.length === 0 && !interim && (
                <p className="placeholder">
                  Press Start — each phrase the mic or meeting audio hears appears
                  here.
                </p>
              )}
              {lines.map((l) => (
                <p key={l.id} className="line">
                  {l.text}
                </p>
              ))}
              {interim && <p className="line interim">{interim}</p>}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </section>

        <section className="card answers-card">
          <div className="card-head">
            <h2>Suggested answers</h2>
            <div className="card-head-right">
              {generating && (
                <span className="streaming">
                  <span className="streaming-dots">
                    <i /> <i /> <i />
                  </span>
                  streaming
                </span>
              )}
              {answers.length > 0 && (
                <button className="link" onClick={() => setAnswers([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="answer">
            {answers.length === 0 ? (
              <p className="placeholder">
                Your AI-suggested answers stream here — grounded in your résumé,
                phrased for you to say out loud. Each new answer is added below,
                so you never lose a previous one.
              </p>
            ) : (
              answers.map((a) => (
                <div key={a.id} className="answer-entry">
                  <p className="answer-q">{a.question}</p>
                  <p className="answer-text">
                    {a.text}
                    {!a.done && <span className="caret" />}
                  </p>
                </div>
              ))
            )}
            <div ref={answerEndRef} />
          </div>

          <div className="answer-actions">
            <input
              type="text"
              className="manual-q-input"
              placeholder="Type a question manually..."
              value={manualQuestion}
              onChange={(e) => setManualQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualQuestion.trim() && !generating) {
                  generate(manualQuestion, "📝 " + manualQuestion);
                  setManualQuestion("");
                }
              }}
            />
            <button
              className="btn btn-primary"
              disabled={!manualQuestion.trim() || generating}
              onClick={() => {
                generate(manualQuestion, "📝 " + manualQuestion);
                setManualQuestion("");
              }}
            >
              Ask
            </button>
          </div>
          
          <div className="answer-actions">
            <button
              className="btn btn-secondary"
              disabled={!lastQuestion || generating}
              onClick={() => generate(lastQuestion)}
            >
              {generating ? "Generating…" : "Answer last spoken"}
            </button>
            <button
              className="btn btn-secondary"
              disabled={reading}
              onClick={readScreen}
              title="Screenshot a window and answer the on-screen question or coding problem"
            >
              {reading ? "Reading…" : "📷 Read screen"}
            </button>
          </div>
        </section>
      </main>

      <footer className="foot">
        Free &amp; private · speech stays in your browser · powered by Cloudflare
        Workers&nbsp;AI
      </footer>
    </div>
  );
}
