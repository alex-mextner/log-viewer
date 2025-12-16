/**
 * This file is the entry point for the React app.
 * Supports SSR hydration by parsing data-log-item attributes from DOM.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type AppProps } from "./App";
import type { LogEntry } from "./hooks/useLogs";

declare global {
  interface Window {
    __SSR_PASSWORD__?: string;
    __SSR_LOGS_COUNT__?: number;
  }
}

// Parse logs from SSR-rendered DOM elements
function parseLogsFromDOM(): LogEntry[] {
  const elements = document.querySelectorAll("[data-log-item]");
  const logs: LogEntry[] = [];

  elements.forEach((el) => {
    const json = el.getAttribute("data-log-item");
    if (json) {
      try {
        logs.push(JSON.parse(json));
      } catch {
        // Skip invalid entries
      }
    }
  });

  return logs;
}

const elem = document.getElementById("root")!;
const hasSSRContent = elem.hasChildNodes();

// Extract SSR data
const password = window.__SSR_PASSWORD__;
const initialLogs = hasSSRContent ? parseLogsFromDOM() : undefined;

// Clean up globals
delete window.__SSR_PASSWORD__;
delete window.__SSR_LOGS_COUNT__;

const initialData: AppProps = {
  initialPassword: password,
  initialLogs,
};

const app = (
  <StrictMode>
    <App {...initialData} />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // Always use createRoot - SSR provides initial data but we re-render completely
  // This avoids hydration mismatches between SSR shell and React components
  createRoot(elem).render(app);
}
