# Interview Copilot

A **100% free**, Cloudflare-native real-time AI interview assistant — the same idea
as Parakeet AI. It listens to the interview, transcribes it live in the browser,
and streams a suggested answer grounded in your resume and the job description.

No paid services, no API keys, no credit card:

- **Speech-to-text:** the browser's built-in Web Speech API (free, Chrome/Edge).
- **AI answers:** Cloudflare **Workers AI** (free daily allowance, Llama model).
- **Hosting:** Cloudflare **Pages** (free) — static site + a Pages Function for the API.

## How it works

```
Browser mic ──▶ Web Speech API ──▶ transcript
                                       │
        resume + job description ──────┤
                                       ▼
        Cloudflare Pages Function (/api/answer)
                                       │
                          env.AI.run() ──▶ Workers AI (free Llama)
                                       │
                       suggested answer ◀── streamed back over SSE
```

## Prerequisites

- Node.js 18+
- A free Cloudflare account (https://dash.cloudflare.com/sign-up) — needed for
  Workers AI and Pages. The free plan is enough; no card required.

## Run & test locally

1. Install dependencies:
   ```
   npm install
   ```
2. Log in to Cloudflare (one-time, opens a browser):
   ```
   npx wrangler login
   ```
3. Build and serve with the Workers AI binding live:
   ```
   npm run dev
   ```
   This builds the site and runs `wrangler pages dev dist`, which serves the app
   **and** the `/api/answer` function with a real (free) Workers AI binding.
4. Open the printed URL (usually http://localhost:8788) in **Chrome or Edge**
   (the Web Speech API doesn't work in Firefox/Safari).

> For frontend-only iteration without the AI endpoint, use `npm run dev:web`
> (Vite on http://localhost:5173) — the `/api/answer` call won't work there.

## Audio sources — Microphone vs Meeting audio

Pick the source in the top bar:

- **Microphone** — browser Web Speech API. Best for in-person / speakerphone. With
  headphones it can't hear the other person (their voice goes to your ears, not a speaker).
- **Meeting audio** — captures the audio of a shared tab/screen (Teams, Zoom, Webex —
  web **or** desktop apps) and transcribes it **on-device with Whisper** (`@huggingface/transformers`).
  Taps the digital stream, so **it works with headphones**, no echo, no virtual cable.

**Using Meeting audio:**
1. Select **Meeting audio**, click **Capture meeting audio**.
2. In the browser's share dialog:
   - Meeting running in a **browser tab** → pick **Chrome/Edge Tab**, choose it, and enable **"Also share tab audio"**.
   - Meeting in a **desktop app** → pick **Entire Screen** and enable **"Share system audio"** (Chrome/Edge on Windows).
3. First run downloads the Whisper model (~150 MB) once; then transcription is local and free.
   A modern GPU (WebGPU) makes it faster; otherwise it falls back to WASM.

## Using it

1. Paste your **resume** (and optionally the job description) in the context section.
2. Click **Start listening** and allow microphone access.
3. As questions are spoken they appear in the transcript. With **Auto-answer** on,
   an answer streams automatically after each phrase. Or click **Answer last question**.

> Tip: to feed the *interviewer's* voice in, route your meeting audio to your
> microphone input (a virtual audio cable, or just let your mic hear your speakers).

## Desktop app (.exe) — transparent, always-on-top, invisible to screen-share

The browser can't hide a window from screen-share or make it transparent. The
Electron desktop build can:

- **Frameless, transparent, always-on-top** overlay.
- **Content-protected** (`setContentProtection`) → **invisible when you share your
  screen** on Zoom/Teams/Webex.
- Captures **system audio (loopback)** on Windows — works with headphones, no
  tab/window sharing limitation.
- All heavy compute stays in the cloud (Whisper STT + LLM answers on Cloudflare
  Workers AI), so the desktop client is light and responsive.

Run it:
```
npm run electron           # launch the desktop app (loads the live site)
npm run electron:build     # build release/InterviewCopilot.exe (portable, no install)
```
The built `.exe` is in `release/`. Double-click to run. `Ctrl+Shift+H` hides/shows it.
By default it loads the deployed site; set `APP_URL` to point elsewhere.

## Cloud speech-to-text

Transcription runs server-side on **Workers AI Whisper** (`/api/transcribe`), not on
your machine — captured audio is segmented by pauses, encoded to WAV, and sent to
the cloud. This keeps the app responsive on modest hardware and lets it work inside
Electron (where the browser Web Speech API is unavailable).

## Deploy to Cloudflare Pages (free)

```
npm run deploy
```

This builds the site and runs `wrangler pages deploy`. The first deploy creates
the Pages project and prints your live `*.pages.dev` URL. The `[ai]` binding in
`wrangler.toml` is applied automatically, so answers work in production with no
extra configuration.

## Notes & limitations

- The Web Speech API transcribes your **default microphone**. For production-grade,
  speaker-separated transcription of the interviewer's tab/system audio, replace
  `src/speech.ts` with a streaming STT layer fed by `getDisplayMedia({ audio: true })`.
- Default model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. If you exhaust the
  free daily Neuron allowance, switch `MODEL` in `functions/api/answer.ts` to a
  smaller model like `@cf/meta/llama-3.1-8b-instruct-fast`.
- **Use responsibly.** Many interviews prohibit AI assistance — this is best
  suited to mock interviews and practice.
```
