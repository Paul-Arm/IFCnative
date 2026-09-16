import { useEffect, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";

function reportWindowError(error: unknown) {
  console.error("Fenstersteuerung fehlgeschlagen:", error);
}

/** Shared by the start page and workspace; browser previews keep their own chrome. */
export function WindowTitlebar({ children }: { children: ReactNode }) {
  const desktop = isTauri();

  return (
    <div
      data-tauri-drag-region
      className={`flex h-9 shrink-0 select-none items-center gap-2 pl-2 ${desktop ? "" : "pr-2"}`}
    >
      {children}
      {desktop ? <WindowControls /> : null}
    </div>
  );
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncMaximized = async () => {
      const next = await appWindow.isMaximized();
      if (!disposed) setMaximized(next);
    };

    // Also follow maximize/restore through double-clicking or OS shortcuts.
    void appWindow
      .onResized(() => void syncMaximized().catch(reportWindowError))
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void syncMaximized().catch(reportWindowError);
        }
      })
      .catch(reportWindowError);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const buttonClass =
    "inline-flex h-full w-11 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const maximizeLabel = maximized ? "Wiederherstellen" : "Maximieren";

  return (
    <div className="flex h-full shrink-0" role="group" aria-label="Fenstersteuerung">
      <button
        type="button"
        aria-label="Minimieren"
        title="Minimieren"
        className={`${buttonClass} hover:bg-muted active:bg-muted/70`}
        onClick={() => void getCurrentWindow().minimize().catch(reportWindowError)}
      >
        <Minus aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        className={`${buttonClass} hover:bg-muted active:bg-muted/70`}
        onClick={() => void getCurrentWindow().toggleMaximize().catch(reportWindowError)}
      >
        {maximized ? (
          <Copy aria-hidden className="size-3" />
        ) : (
          <Square aria-hidden className="size-3" />
        )}
      </button>
      <button
        type="button"
        aria-label="Schließen"
        title="Schließen"
        className={`${buttonClass} hover:bg-red-600 hover:text-white active:bg-red-700 active:text-white`}
        onClick={() => void getCurrentWindow().close().catch(reportWindowError)}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
