/**
 * This file is the entry point for the React app.
 * Supports SSR hydration when __INITIAL_DATA__ is present.
 */

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App, type AppProps } from "./App";

declare global {
  interface Window {
    __INITIAL_DATA__?: AppProps;
  }
}

const elem = document.getElementById("root")!;
const initialData = window.__INITIAL_DATA__;

// Clear initial data after reading
if (initialData) {
  delete window.__INITIAL_DATA__;
}

const app = (
  <StrictMode>
    <App {...initialData} />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else if (initialData && elem.hasChildNodes()) {
  // SSR hydration - attach React to server-rendered HTML
  hydrateRoot(elem, app);
} else {
  // Client-only render
  createRoot(elem).render(app);
}
