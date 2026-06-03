// Minimal, safe bridge. The renderer talks to the backend over HTTP directly,
// so we only expose static config (the backend base URL) — no Node APIs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PMA", {
  apiBase: `http://127.0.0.1:${process.env.PMA_PORT || "8765"}`,
  isElectron: true,
  // Save bytes to a host file via a native dialog. `data` is a Uint8Array.
  saveFile: (defaultName, data, filters) =>
    ipcRenderer.invoke("pma:save-file", { defaultName, data, filters }),
});
