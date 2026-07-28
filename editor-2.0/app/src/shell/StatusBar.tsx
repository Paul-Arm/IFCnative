import { usePendingChangeCount } from "../commands/pipeline";
import { useDocuments } from "../store/documents";
import { useSelectionOf } from "../store/selection";
import { isTauri } from "../core/tauri";

export function StatusBar() {
  const progress = useDocuments((s) => s.progress);
  const active = useDocuments(
    (s) => s.documents.find((d) => d.id === s.activeId) ?? null,
  );
  const selection = useSelectionOf(active?.id ?? null);
  // Befund 3: Undo-Stack-Tiefe statt `changeCount`. Letzterer zählt die
  // append-only Mutationsliste und schrumpft beim Undo nicht — die Leiste
  // meldete dann Änderungen, die der Nutzer gerade zurückgenommen hat.
  const pending = usePendingChangeCount(active?.id ?? null);
  const info = active?.session.info();

  return (
    <footer
      style={{
        display: "flex",
        gap: 16,
        padding: "3px 10px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-panel)",
        fontSize: "0.75rem",
        color: "var(--text-dim)",
      }}
    >
      <span>{isTauri() ? "Desktop" : "Browser"}</span>
      {info && (
        <>
          <span>{info.schema}</span>
          <span>{info.entityCount.toLocaleString("de-DE")} Entities</span>
          <span>
            {selection.length === 0
              ? "keine Auswahl"
              : selection.length === 1
                ? active!.session.labelOf(selection[0])
                : `${selection.length} Objekte ausgewählt`}
          </span>
          <span
            title={
              pending > 0
                ? "Änderungen liegen im Sitzungs-Overlay — „Exportieren“ schreibt sie in eine IFC-Datei"
                : undefined
            }
          >
            {pending > 0
              ? `${pending} ${pending === 1 ? "Änderung" : "Änderungen"} (nicht exportiert)`
              : "Keine Änderungen"}
          </span>
        </>
      )}
      {progress && <span>{progress}</span>}
    </footer>
  );
}
