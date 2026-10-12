const {
  app,
  BrowserWindow,
  globalShortcut,
  session,
  desktopCapturer,
} = require("electron");

// The UI + all heavy compute (speech-to-text, LLM answers) live in the cloud.
// This desktop shell just renders it in a stealth, always-on-top window.
const APP_URL = process.env.APP_URL || "https://interview-copilot-89u.pages.dev";

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 660,
    minWidth: 340,
    minHeight: 360,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true, // stay out of the taskbar / alt-tab
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Always float above everything, including full-screen apps.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // THE stealth feature: exclude this window from screen capture/recording,
  // so it's invisible when the user shares their screen on Zoom/Teams/Webex.
  win.setContentProtection(true);

  // Let getDisplayMedia() work inside Electron, capturing system audio (loopback)
  // on Windows so meeting audio is picked up even with headphones on.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen", "window"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: true },
  );

  // Auto-grant mic/screen permissions (single-user desktop app).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));

  win.loadURL(APP_URL);

  // Inject a slim draggable title strip + close button (frameless window).
  win.webContents.on("did-finish-load", () => {
    win.webContents.insertCSS(`
      html, body { background: transparent !important; }
      .app { padding-top: 40px !important; }
      #ec-bar {
        position: fixed; top: 0; left: 0; right: 0; height: 32px;
        -webkit-app-region: drag; z-index: 100000;
        display: flex; align-items: center; justify-content: flex-end;
        gap: 6px; padding: 0 8px;
      }
      #ec-bar button {
        -webkit-app-region: no-drag; width: 22px; height: 22px;
        border: none; border-radius: 6px; cursor: pointer;
        background: rgba(0,0,0,0.06); color: #333; font-size: 13px; line-height: 1;
      }
      #ec-bar button:hover { background: rgba(0,0,0,0.12); }
    `);
    win.webContents.executeJavaScript(`
      if (!document.getElementById('ec-bar')) {
        const bar = document.createElement('div'); bar.id = 'ec-bar';
        const mini = document.createElement('button'); mini.textContent = '—'; mini.title = 'Hide (Ctrl+Shift+H)';
        mini.onclick = () => window.close();
        bar.appendChild(mini);
        document.body.appendChild(bar);
      }
    `);
  });
}

app.whenReady().then(() => {
  createWindow();

  // Quick hide/show hotkey (handy even though it's already capture-proof).
  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", () => globalShortcut.unregisterAll());
