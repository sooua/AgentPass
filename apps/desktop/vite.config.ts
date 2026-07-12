import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Runs as a plain web app (pnpm ui:dev) AND as the Tauri 2 webview frontend.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
  build: { outDir: "dist", target: "es2022" },
});
