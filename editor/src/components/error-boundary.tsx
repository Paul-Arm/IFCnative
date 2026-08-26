import { Component, type ErrorInfo, type ReactNode } from "react";

import { getDiagnosticsReport, recordDiagnostic } from "../diagnostics/watchdog";

type EmergencySaver = () => void;

const emergencySavers = new Set<EmergencySaver>();

/**
 * Registers a best-effort save callback that the error boundary invokes when a
 * render error is caught, so in-memory state can be flushed before recovery.
 * Returns an unregister function.
 */
export function registerEmergencySave(saver: EmergencySaver) {
  emergencySavers.add(saver);
  return () => {
    emergencySavers.delete(saver);
  };
}

function runEmergencySaves() {
  let saved = 0;
  for (const saver of emergencySavers) {
    try {
      saver();
      saved += 1;
    } catch {
      // Saving is best-effort; never let recovery itself throw.
    }
  }
  return saved;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  copied: boolean;
  error: Error | null;
  saved: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { copied: false, error: null, saved: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const saved = runEmergencySaves();
    this.setState({ saved: saved > 0 });
    recordDiagnostic(
      "error",
      `React-Render-Fehler: ${error.message}\n${info.componentStack ?? ""}`,
    );
    console.error("IFCnative ist abgestuerzt:", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ copied: false, error: null, saved: false });
  };

  private handleCopyDiagnostics = async () => {
    const report = getDiagnosticsReport();
    try {
      await navigator.clipboard.writeText(report);
      this.setState({ copied: true });
    } catch {
      // Ohne Clipboard-Recht bleibt der Bericht wenigstens in der Konsole.
      console.info(report);
      this.setState({ copied: true });
    }
  };

  private handleResetUi = () => {
    runEmergencySaves();
    try {
      this.props.onReset?.();
    } catch {
      // ignore reset failures and reload anyway
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  private handleReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render() {
    const { copied, error, saved } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-lg rounded-xl border border-border/70 bg-card p-6 shadow-lg">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-md bg-gradient-to-br from-rose-500 to-red-600 text-xs font-bold text-white shadow-sm"
            >
              !
            </span>
            <h1 className="text-base font-semibold">
              Es ist ein Fehler aufgetreten
            </h1>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            Die Anwendung hat einen unerwarteten Fehler abgefangen, statt
            abzustürzen. Deine Notizen und zuletzt geöffneten Dateien wurden
            {saved ? " gesichert." : " soweit möglich gesichert."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Nicht exportierte IFC-Änderungen liegen im Wiederherstellungsspeicher
            und werden nach „Erneut versuchen“ oder „Neu laden“ zum
            Zurückholen angeboten.
          </p>

          <details className="mt-4 rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Technische Details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[0.7rem] text-muted-foreground">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ""}
            </pre>
          </details>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              type="button"
              onClick={this.handleRetry}
            >
              Erneut versuchen
            </button>
            <button
              className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
              type="button"
              onClick={this.handleResetUi}
            >
              UI zurücksetzen
            </button>
            <button
              className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
              type="button"
              onClick={this.handleReload}
            >
              Neu laden
            </button>
            <button
              className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/50"
              title="Ereignisprotokoll dieses und des vorherigen Laufs in die Zwischenablage kopieren"
              type="button"
              onClick={() => void this.handleCopyDiagnostics()}
            >
              {copied ? "Diagnose kopiert" : "Diagnose kopieren"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
