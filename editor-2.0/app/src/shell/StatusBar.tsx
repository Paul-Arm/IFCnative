/**
 * Statusleiste — fixe 24px nach dem Vorbild der ersten React-App: links
 * Schema/Entitäten/Auswahl, rechts Fortschritt und der Änderungs-Indikator.
 * Befund 3: Undo-Stack-Tiefe statt `changeCount`. Letzterer zählt die
 * append-only Mutationsliste und schrumpft beim Undo nicht — die Leiste
 * meldete dann Änderungen, die der Nutzer gerade zurückgenommen hat.
 */
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
  const pending = usePendingChangeCount(active?.id ?? null);
  const info = active?.session.info();

  return (
    <footer className="statusbar">
      <span className="statusbar-strong">
        {isTauri() ? "Desktop" : "Browser"}
      </span>
      {info && (
        <>
          <span>{info.schema}</span>
          <span>{info.entityCount.toLocaleString("de-DE")} Entitäten</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selection.length === 0
              ? "keine Auswahl"
              : selection.length === 1
                ? active!.session.labelOf(selection[0])
                : `${selection.length} Objekte ausgewählt`}
          </span>
        </>
      )}
      <span className="statusbar-right">
        {progress && <span style={{ color: "var(--accent)" }}>{progress}</span>}
        {info &&
          (pending > 0 ? (
            <span
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--warn)" }}
              title="Änderungen liegen im Sitzungs-Overlay — „Exportieren“ schreibt sie in eine IFC-Datei"
            >
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--warn-solid)",
                }}
              />
              {pending} {pending === 1 ? "Änderung" : "Änderungen"} (nicht
              exportiert)
            </span>
          ) : (
            <span>Keine Änderungen</span>
          ))}
      </span>
    </footer>
  );
}
