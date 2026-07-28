import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";
import { AppShell } from "./shell/AppShell";
import { ErrorBoundary } from "./shell/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  </StrictMode>,
);
