// Minimal, safe bridge. The renderer talks to the backend over HTTP directly,
// so we only expose static config (the backend base URL) — no Node APIs.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("PMA", {
  apiBase: `http://127.0.0.1:${process.env.PMA_PORT || "8765"}`,
});
