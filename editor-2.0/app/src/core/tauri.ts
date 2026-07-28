/**
 * Tauri-Brücke ohne npm-Abhängigkeit: nutzt das globale __TAURI__-Objekt
 * (withGlobalTauri in tauri.conf.json). Im Browser-Dev-Betrieb sind alle
 * Funktionen no-ops — die App bleibt dort voll nutzbar (Datei-Input/Download).
 */

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(
      event: string,
      handler: (e: { payload: T }) => void,
    ): Promise<() => void>;
  };
}

function tauri(): TauriGlobal | null {
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

export const isTauri = (): boolean => tauri() !== null;

/** Vom Backend gepushte Datei (Explorer-Doppelklick, „Öffnen mit", Zweitinstanz). */
export interface OpenedFile {
  fileName: string;
  bytes: Uint8Array;
}

/** Lauscht auf Dateien, die die Shell öffnet (CLI-Args + Single-Instance). */
export async function onFileOpened(
  handler: (file: OpenedFile) => void,
): Promise<() => void> {
  const t = tauri();
  if (!t) return () => {};
  const unlisten = await t.event.listen<{ path: string; fileName: string }>(
    "ifc://open-path",
    async ({ payload }) => {
      const bytes = await t.core.invoke<number[]>("read_model_file", {
        path: payload.path,
      });
      handler({ fileName: payload.fileName, bytes: new Uint8Array(bytes) });
    },
  );
  // Dateien melden, die vor dem Listener-Setup ankamen (Kaltstart per Doppelklick)
  await t.core.invoke("frontend_ready");
  return unlisten;
}

/** Speichern über nativen Dialog; false = kein Tauri, Aufrufer nutzt Download. */
export async function saveViaDialog(
  suggestedName: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  await t.core.invoke("save_model_file", {
    suggestedName,
    bytes: Array.from(bytes),
  });
  return true;
}
