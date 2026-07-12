import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { PrefsProvider } from "./i18n.js";
// Bundled offline fonts (no CDN): Inter=sans UI, Source Serif 4=headlines
// (literary, weight 500), IBM Plex Mono=code. Matches the Claude design system.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </React.StrictMode>,
);
