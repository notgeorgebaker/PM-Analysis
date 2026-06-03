import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Electron loads the built renderer from a file:// path, so use relative asset URLs.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
