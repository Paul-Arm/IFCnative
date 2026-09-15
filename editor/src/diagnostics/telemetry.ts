/** Lightweight bridge: the native worker owns Sentry, serialization and network I/O. */
import { invoke, isTauri } from "@tauri-apps/api/core";

let started = false;
let ifcNames: string[] = [];
let lastKey = "";
let lastSent = 0;
let inFlight = 0;
let webWorker: Worker | undefined;

function syncContext() {
  if (isTauri()) {
    void invoke("telemetry_context", { online: navigator.onLine, ifcNames }).catch(() => {});
  } else {
    webWorker?.postMessage({ type: "context", online: navigator.onLine, ifcNames });
  }
}

export function setTelemetryIfcContext(names: string[]) {
  ifcNames = names.slice(0, 32).map(name => name.split(/[\\/]/).at(-1)?.slice(0, 240) ?? "");
  syncContext();
}

export function captureTelemetryError(error: unknown, source = "application") {
  if ((!isTauri() && !webWorker) || !navigator.onLine || inFlight >= 4) return;
  // Never stringify arbitrary rejection objects: they can contain full IFC models.
  const message = (error instanceof Error ? error.message : typeof error === "string" ? error : "Unbekannter Fehler").slice(0, 8192);
  const stack = error instanceof Error ? error.stack?.slice(0, 8192) ?? "" : "";
  const key = `${source}:${message}`;
  const now = Date.now();
  if (key === lastKey && now - lastSent < 10_000) return;
  lastKey = key;
  lastSent = now;
  inFlight += 1;
  if (webWorker) {
    webWorker.postMessage({ type: "error", message, stack, source });
    return;
  }
  void invoke("telemetry_error", { report: { message, stack, source } })
    .catch(() => {}).finally(() => { inFlight -= 1; });
}

export function startTelemetry() {
  if (started) return;
  if (!isTauri()) {
    if (!import.meta.env.VITE_IFCNATIVE_SENTRY_DSN?.trim()) return;
    try {
      webWorker = new Worker(new URL("./telemetry.worker.ts", import.meta.url), { type: "module" });
      webWorker.addEventListener("message", () => { inFlight = Math.max(0, inFlight - 1); });
      webWorker.addEventListener("error", event => {
        event.preventDefault();
        webWorker?.terminate();
        webWorker = undefined;
        inFlight = 0;
      });
    } catch { return; }
  }
  started = true;
  syncContext();
  window.addEventListener("online", syncContext);
  window.addEventListener("offline", syncContext);
  window.addEventListener("error", event => {
    captureTelemetryError(event.error ?? event.message, "javascript");
  });
  window.addEventListener("unhandledrejection", event => {
    captureTelemetryError(event.reason, "unhandledrejection");
  });
}
