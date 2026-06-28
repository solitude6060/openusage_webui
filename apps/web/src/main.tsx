import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Bundle Inter locally (variable weight axis) so the design's named primary font
// actually renders instead of silently falling back to system-ui. Local-first: the
// woff2 is emitted into the build, no runtime CDN request.
import "@fontsource-variable/inter/wght.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
