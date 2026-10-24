// Tokens declare the layer order (base, kit); feature modules stay unlayered and win.
import "./styles/tokens.css";
import "./styles/base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/sheen";
import { App } from "./App";
import { BackendError } from "./api/ipc";
import { toast } from "./components/ui/Toast";
import { errorMessage } from "./lib/format";

// Last line of defence for async failures nobody caught (fire-and-forget calls, event listeners): say so instead of failing silently.
const report = (e: unknown) => {
  if (e instanceof BackendError && e.kind === "cancelled") return;
  console.error(e);
  toast(errorMessage(e) || "Something went wrong", "critical");
};
window.addEventListener("unhandledrejection", (e) => report(e.reason));
// ResizeObserver loop notices are benign browser chatter, not failures.
window.addEventListener("error", (e) => void (e.message.startsWith("ResizeObserver") || report(e.error ?? e.message)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
