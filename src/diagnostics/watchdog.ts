/**
 * Laufzeit-Watchdog: zeichnet auf, was einem "die App reagiert nicht mehr"
 * vorausgeht. Der Freeze tritt sporadisch nach langer Hintergrundlaufzeit auf
 * und ist nicht reproduzierbar — deshalb wird hier passiv protokolliert statt
 * geraten.
 *
 * Aufgezeichnet werden:
 *  - Blockaden des Main-Threads (Heartbeat-Drift + Long Tasks)
 *  - Sichtbarkeitswechsel (Fenster in den Hintergrund / zurück)
 *  - nicht abgefangene Fehler und Promise-Rejections
 *  - WebGL-Kontextverlust (per `recordDiagnostic` aus dem Viewer gemeldet)
 *  - JS-Heap-Wachstum
 *
 * Der Ringpuffer wird in localStorage gespiegelt, damit die Aufzeichnung einen
 * Reload oder einen harten Renderer-Absturz überlebt.
 */

const STORAGE_KEY = "ifcnative:diagnostics:v1";
const MAX_EVENTS = 240;
const HEARTBEAT_MS = 1_000;
/** Ab dieser Drift gilt der Main-Thread als blockiert (Timer-Toleranz eingerechnet). */
const STALL_THRESHOLD_MS = 2_500;
const LONG_TASK_THRESHOLD_MS = 250;
const MEMORY_SAMPLE_EVERY = 30;

export type DiagnosticKind =
  | "boot"
  | "stall"
  | "longtask"
  | "visibility"
  | "error"
  | "rejection"
  | "webgl"
  | "memory"
  | "note";

export interface DiagnosticEvent {
  at: string;
  kind: DiagnosticKind;
  detail: string;
  /** Sichtbarkeit des Fensters zum Zeitpunkt des Ereignisses. */
  hidden: boolean;
}

interface MemoryCapablePerformance extends Performance {
  memory?: {
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  };
}

let events: DiagnosticEvent[] = [];
let previousRun: DiagnosticEvent[] = [];
let started = false;
let dirty = false;

function isHidden() {
  return (
    typeof globalThis.document !== "undefined" &&
    globalThis.document.visibilityState === "hidden"
  );
}

function readStoredEvents(): DiagnosticEvent[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DiagnosticEvent[]) : [];
  } catch {
    return [];
  }
}

function flush() {
  if (!dirty) {
    return;
  }
  dirty = false;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...previousRun.slice(-MAX_EVENTS / 2), ...events]),
    );
  } catch {
    // Diagnose ist Beiwerk; niemals die Anwendung daran scheitern lassen.
  }
}

/** Trägt ein Ereignis in den Ringpuffer ein. Sicher aus jedem Kontext aufrufbar. */
export function recordDiagnostic(kind: DiagnosticKind, detail: string) {
  events.push({
    at: new Date().toISOString(),
    detail,
    hidden: isHidden(),
    kind,
  });
  if (events.length > MAX_EVENTS) {
    events = events.slice(-MAX_EVENTS);
  }
  dirty = true;
  // Fehler und Blockaden sofort sichern — genau davor stürzt es ggf. ab.
  if (kind === "error" || kind === "rejection" || kind === "stall") {
    flush();
  }
}

function formatMemory(memory: NonNullable<MemoryCapablePerformance["memory"]>) {
  const mb = (value: number) => `${Math.round(value / 1_048_576)} MB`;
  const share = Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100);
  return `heap ${mb(memory.usedJSHeapSize)} / ${mb(memory.jsHeapSizeLimit)} (${share}%)`;
}

/**
 * Startet die Aufzeichnung. Idempotent — ein zweiter Aufruf (z. B. durch
 * StrictMode-Doppelmount) ist wirkungslos.
 */
export function startWatchdog() {
  if (started || typeof window === "undefined") {
    return;
  }
  started = true;

  // Aufzeichnung des vorherigen Laufs erhalten: bei einem harten Absturz ist
  // sie die einzige Spur.
  previousRun = readStoredEvents();
  recordDiagnostic("boot", `ifcnative gestartet (${navigator.userAgent})`);

  let lastBeat = performance.now();
  let beats = 0;
  window.setInterval(() => {
    const now = performance.now();
    const drift = now - lastBeat - HEARTBEAT_MS;
    lastBeat = now;
    beats += 1;
    if (drift > STALL_THRESHOLD_MS) {
      // Im Hintergrund drosselt WebView2 Timer bis auf einen Tick pro Minute —
      // das ist normal und kein Hänger. Nur im sichtbaren Zustand ist eine
      // Drift ein echtes Blockade-Signal.
      recordDiagnostic(
        "stall",
        isHidden()
          ? `Timer-Drosselung im Hintergrund: ${Math.round(drift)} ms`
          : `Main-Thread ${Math.round(drift)} ms blockiert`,
      );
    }
    const memory = (performance as MemoryCapablePerformance).memory;
    if (memory && beats % MEMORY_SAMPLE_EVERY === 0) {
      recordDiagnostic("memory", formatMemory(memory));
    }
    flush();
  }, HEARTBEAT_MS);

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_THRESHOLD_MS) {
            continue;
          }
          recordDiagnostic(
            "longtask",
            `${Math.round(entry.duration)} ms (${entry.name})`,
          );
        }
      });
      observer.observe({ buffered: true, type: "longtask" });
    } catch {
      // longtask wird nicht überall unterstützt — Heartbeat reicht dann.
    }
  }

  globalThis.document.addEventListener("visibilitychange", () => {
    recordDiagnostic(
      "visibility",
      globalThis.document.visibilityState === "hidden"
        ? "Fenster in den Hintergrund"
        : "Fenster wieder im Vordergrund",
    );
    // Im Hintergrund steht der Heartbeat still (WebView2 drosselt Timer bis
    // zum Stillstand) — ohne Flush an dieser Stelle ginge alles verloren, was
    // seit dem Wegschalten aufgezeichnet wurde.
    flush();
  });

  window.addEventListener("error", (event) => {
    recordDiagnostic(
      "error",
      `${event.message} @ ${event.filename}:${event.lineno}`,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    recordDiagnostic(
      "rejection",
      reason instanceof Error
        ? `${reason.message}\n${reason.stack ?? ""}`
        : String(reason),
    );
  });

  window.addEventListener("pagehide", flush);
  // Der erste Heartbeat kann im Hintergrund minutenlang ausbleiben; den
  // Startvermerk sofort sichern.
  flush();
}

/** Ereignisse des laufenden Prozesses (älteste zuerst). */
export function getDiagnosticEvents() {
  return [...events];
}

/**
 * Textbericht über den aktuellen und den vorherigen Lauf — zum Anhängen an
 * Fehlerdialoge oder zum Kopieren in die Zwischenablage.
 */
export function getDiagnosticsReport() {
  const render = (list: DiagnosticEvent[]) =>
    list
      .map(
        (event) =>
          `${event.at} [${event.kind}]${event.hidden ? " (hidden)" : ""} ${event.detail}`,
      )
      .join("\n");
  const sections = [`# IFCnative Diagnose\n\n## Aktueller Lauf\n${render(events)}`];
  if (previousRun.length) {
    sections.push(`## Vorheriger Lauf\n${render(previousRun.slice(-60))}`);
  }
  return sections.join("\n\n");
}
