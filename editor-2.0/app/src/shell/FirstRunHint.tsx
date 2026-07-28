/**
 * Erststart-Hinweis (E11): weist einmalig darauf hin, dass sich IFCnative in
 * den Windows-Einstellungen als Standardprogramm für `.ifc` festlegen lässt.
 *
 * Bewusst nur ein Hinweis, keine Automatik: Windows schützt die
 * Dateizuordnung seit Windows 10 über den UserChoice-Hash. Programme, die die
 * Zuordnung ohne den Einstellungen-Dialog setzen, werden vom System
 * zurückgesetzt (und von Virenscannern als Hijacking gewertet). Der Installer
 * registriert die App unter „Standard-Apps"; die Auswahl selbst trifft der
 * Nutzer.
 *
 * Sichtbar nur in der Desktop-Shell (`isTauri()`) — im Browser-Modus gibt es
 * keine Dateizuordnung. Der Zustand liegt über `core/storage` im
 * localStorage; „Nicht mehr anzeigen" und das Schließen-Kreuz setzen beide
 * dasselbe Flag (ein einmaliger Hinweis, keine Wiedervorlage).
 */
import { useState } from "react";
import { loadJson, saveJson } from "../core/storage";
import { isTauri } from "../core/tauri";

/** localStorage-Schlüssel (Präfix „ifcnative2:" kommt aus core/storage). */
const STORAGE_KEY = "firstRunHint.dismissed";

const HINT =
  "IFCnative als Standardprogramm für .ifc festlegen: " +
  "Windows-Einstellungen → Standard-Apps";

const SETTINGS_TITLE =
  "Öffnet die Windows-Seite „Standard-Apps“ — die Zuordnung selbst bleibt " +
  "deine Entscheidung";

/**
 * Minimaler Invoke-Pfad auf das globale __TAURI__-Objekt — dieselbe Brücke,
 * die `core/tauri.ts` nutzt (withGlobalTauri, keine npm-Abhängigkeit).
 */
function invokeSettings(): void {
  const bridge = (
    window as {
      __TAURI__?: {
        core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
      };
    }
  ).__TAURI__;
  // Fehler bleiben ohne Folgen: Der Nutzer kann die Einstellungen jederzeit
  // von Hand öffnen, ein Dialog wäre hier nur im Weg.
  void bridge?.core.invoke("open_default_apps_settings").catch(() => undefined);
}

export function FirstRunHint() {
  const [dismissed, setDismissed] = useState(() =>
    loadJson<boolean>(STORAGE_KEY, false),
  );

  if (dismissed || !isTauri()) return null;

  function dismiss(): void {
    saveJson(STORAGE_KEY, true);
    setDismissed(true);
  }

  return (
    <div
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 10px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: "0.8125rem",
      }}
    >
      <span className="text-dim" style={{ flex: 1, minWidth: 0 }}>
        {HINT}
      </span>
      <button
        className="btn"
        title={SETTINGS_TITLE}
        onClick={invokeSettings}
      >
        Einstellungen öffnen
      </button>
      <button className="btn" onClick={dismiss}>
        Nicht mehr anzeigen
      </button>
      <button className="btn" aria-label="Hinweis schließen" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
