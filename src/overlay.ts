// A floating, always-on-top overlay that mirrors the live suggested answers, so
// you can read them while facing the interviewer. Uses the Document
// Picture-in-Picture API (Chrome/Edge) with a popup-window fallback.
//
// Visibility note: a browser overlay is hidden from screen-share only when you
// share a specific window/tab (not your entire screen). True capture-immunity
// requires the native/Electron desktop build with content protection.

export interface OverlayAnswer {
  id: number;
  question: string;
  text: string;
  done: boolean;
}

let win: Window | null = null;

const OVERLAY_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: rgba(18, 20, 26, 0.96);
    color: #f2f4f8;
    -webkit-font-smoothing: antialiased;
  }
  #ov-bar {
    position: sticky; top: 0;
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    font-size: 12px; font-weight: 600; letter-spacing: .02em;
    color: #9aa3b2;
    background: rgba(18,20,26,0.98);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  #ov-bar .dot { width: 8px; height: 8px; border-radius: 50%; background: #34c759; }
  #ov-status { color: #6ea8fe; font-weight: 500; }
  #ov-tip { padding: 6px 12px; font-size: 11px; color: #c79a3a; background: rgba(199,154,58,0.12); border-bottom: 1px solid rgba(255,255,255,0.06); }
  #ov-list { padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
  .ov-entry { display: flex; flex-direction: column; gap: 5px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
  .ov-entry:last-child { border-bottom: none; }
  .ov-q { font-size: 11.5px; font-weight: 600; color: #8b93a3; }
  .ov-a { font-size: 16px; line-height: 1.6; white-space: pre-wrap; }
  .ov-empty { padding: 24px 14px; color: #8b93a3; font-size: 13px; line-height: 1.6; }
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 8px; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isOverlayActive(): boolean {
  return !!win && !win.closed;
}

export async function openOverlay(): Promise<boolean> {
  if (isOverlayActive()) return true;

  const dpip = (window as any).documentPictureInPicture;
  if (dpip?.requestWindow) {
    try {
      win = await dpip.requestWindow({ width: 440, height: 560 });
    } catch {
      win = null;
    }
  }
  if (!win) {
    win = window.open(
      "",
      "copilot-overlay",
      "width=440,height=560,alwaysRaised=yes",
    );
  }
  if (!win) return false;

  const doc = win.document;
  doc.title = "Copilot";
  doc.head.innerHTML = "";
  doc.body.innerHTML = "";
  const style = doc.createElement("style");
  style.textContent = OVERLAY_CSS;
  doc.head.appendChild(style);
  doc.body.innerHTML =
    `<div id="ov-bar"><span class="dot"></span> Copilot · live answers <span id="ov-status"></span></div>` +
    `<div id="ov-tip">To keep this hidden on calls, share a single window/tab — not your whole screen.</div>` +
    `<div id="ov-list"></div>`;

  win.addEventListener("pagehide", () => {
    win = null;
  });
  return true;
}

export function updateOverlay(answers: OverlayAnswer[], status: string): void {
  if (!isOverlayActive()) return;
  const doc = win!.document;
  const st = doc.getElementById("ov-status");
  const list = doc.getElementById("ov-list");
  if (st) st.textContent = status ? `· ${status}` : "";
  if (!list) return;

  if (answers.length === 0) {
    list.innerHTML =
      `<div class="ov-empty">Answers will appear here live as questions come in. Keep this window on top and glance at it while you speak.</div>`;
    return;
  }
  list.innerHTML = answers
    .map(
      (a) =>
        `<div class="ov-entry"><div class="ov-q">${escapeHtml(a.question)}</div>` +
        `<div class="ov-a">${escapeHtml(a.text || "…")}</div></div>`,
    )
    .join("");
  // Keep the newest answer in view as it streams.
  list.scrollTop = list.scrollHeight;
}

export function closeOverlay(): void {
  if (isOverlayActive()) win!.close();
  win = null;
}
