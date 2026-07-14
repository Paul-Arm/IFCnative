import React from "react";
import { createRoot } from "react-dom/client";
import "react-mosaic-component/react-mosaic-component.css";

import { ErrorBoundary } from "./components/error-boundary";
import IfcWorkspace from "./components/ifc-workspace";
import { resetWorkspaceUi } from "./components/ifc-workspace/workspaceStorage";
import { initTheme } from "./hooks/use-theme";
import { initUiScale } from "./hooks/use-ui-scale";
import "./global.css";

initTheme();
initUiScale();

const root = globalThis.document.getElementById("root");

if (!root) {
  throw new Error("Missing root element.");
}

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary onReset={resetWorkspaceUi}>
      <IfcWorkspace />
    </ErrorBoundary>
  </React.StrictMode>,
);
