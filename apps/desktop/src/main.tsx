import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { PrefsProvider } from "./i18n.js";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrefsProvider>
      <App />
    </PrefsProvider>
  </React.StrictMode>,
);
