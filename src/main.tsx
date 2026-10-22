// Global styles first: feature stylesheets imported by components must win the cascade.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/dialog.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
