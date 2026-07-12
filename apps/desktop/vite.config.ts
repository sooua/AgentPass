import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Runs as a plain web app (pnpm ui:dev) AND as the Tauri 2 webview frontend.
export default defineConfig({
  // Relative base so the build works both as a Tauri frontend and when the daemon
  // serves it under /ui/ (AGENTPASS_UI_DIR).
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 15273,
    strictPort: true,
    // Don't watch the Rust build dir — Cargo locks files there (EBUSY on Windows).
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: "dist", target: "es2022" },
});
