// Electron main process.
// Responsibilities:
//   1. Spawn the local Python/FastAPI backend (the "science" service).
//   2. Open the desktop window with the React UI.
//   3. Tear the backend down cleanly on exit.

const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs/promises");

// Native "Save image as…" dialog used by the Export menu. The renderer hands us
// the encoded bytes + suggested filename and file-type filters; we show the host
// file browser and write the chosen path.
ipcMain.handle("pma:save-file", async (_evt, { defaultName, data, filters }) => {
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export image",
    defaultPath: defaultName,
    filters: filters || [{ name: "Image", extensions: ["png"] }],
  });
  if (canceled || !filePath) return { saved: false };
  await fs.writeFile(filePath, Buffer.from(data));
  return { saved: true, path: filePath };
});

const BACKEND_PORT = process.env.PMA_PORT || "8765";
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const PYTHON = process.env.PMA_PYTHON || "python3";

let backend = null;
let win = null;

function startBackend() {
  // Allow attaching to an already-running backend (e.g. during development).
  if (process.env.PMA_EXTERNAL_BACKEND) return;
  const backendDir = path.join(__dirname, "..", "..", "backend");
  backend = spawn(PYTHON, ["main.py"], {
    cwd: backendDir,
    env: { ...process.env, PMA_PORT: BACKEND_PORT },
    stdio: "inherit",
  });
  backend.on("error", (err) =>
    console.error("[backend] failed to start — is Python installed?", err)
  );
}

function waitForBackend(retries = 40) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      const req = http.get(
        { host: "127.0.0.1", port: BACKEND_PORT, path: "/health", timeout: 1000 },
        (res) => {
          res.resume();
          res.statusCode === 200 ? resolve() : retry(n);
        }
      );
      req.on("error", () => retry(n));
      req.on("timeout", () => {
        req.destroy();
        retry(n);
      });
    };
    const retry = (n) =>
      n <= 0 ? reject(new Error("backend did not become healthy")) : setTimeout(() => tryOnce(n - 1), 500);
    tryOnce(retries);
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#16181d",
    title: "PM-Analysis",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await waitForBackend();
  } catch (e) {
    console.error(e.message);
  }

  if (DEV_URL) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  if (backend) backend.kill();
});
