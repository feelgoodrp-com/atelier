import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { LogWindow } from "./windows/log-window";
import "./lib/i18n";
import { loadStoredLanguage } from "./lib/i18n/language";

import "@fontsource/sora/400.css";
import "@fontsource/sora/500.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "./app.css";

/**
 * Secondary Tauri windows load the same bundle — the WINDOW LABEL decides
 * which root UI renders (query params break with WebviewUrl::App, they get
 * path-encoded). Falls back to the main app in plain-browser dev.
 */
function currentWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

function render(): void {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {currentWindowLabel() === "logs" ? <LogWindow /> : <App />}
    </React.StrictMode>,
  );
}

// Apply the persisted language before the first paint (defaults to English),
// then render. `.finally` ensures rendering even without the Tauri bridge.
void loadStoredLanguage().finally(render);
