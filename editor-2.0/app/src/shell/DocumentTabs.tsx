/**
 * Dokument-Tabs. Der Dirty-Punkt und die Schließen-Rückfrage hängen an der
 * Undo-Stack-Tiefe (`usePendingChangeCount`, Befund 3/15) — `changeCount` zählt
 * die append-only Mutationsliste und bliebe nach einem vollständigen Undo
 * stehen, sodass der Tab „ungespeichert" meldete, obwohl nichts offen ist.
 */
import { usePendingChangeCount } from "../commands/pipeline";
import { useDocuments, type DocumentEntry } from "../store/documents";

export function DocumentTabs() {
  const { documents, activeId, setActive, closeDocument } = useDocuments();
  if (documents.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "4px 10px 0",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        overflowX: "auto",
      }}
    >
      {documents.map((doc) => (
        <DocumentTab
          key={doc.id}
          doc={doc}
          isActive={doc.id === activeId}
          onActivate={() => setActive(doc.id)}
          onClose={() => closeDocument(doc.id)}
        />
      ))}
    </div>
  );
}

interface DocumentTabProps {
  doc: DocumentEntry;
  isActive: boolean;
  onActivate(): void;
  onClose(): void;
}

function DocumentTab({ doc, isActive, onActivate, onClose }: DocumentTabProps) {
  const info = doc.session.info();
  const pending = usePendingChangeCount(doc.id);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: "6px 6px 0 0",
        border: "1px solid var(--border)",
        borderBottom: "none",
        background: isActive ? "var(--bg-panel)" : "var(--bg-hover)",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      onClick={onActivate}
      title={`${info.schema} · ${info.entityCount.toLocaleString("de-DE")} Entities`}
    >
      <span>{info.fileName}</span>
      {pending > 0 && (
        <span
          title={`${pending} ${pending === 1 ? "Änderung" : "Änderungen"} — noch nicht exportiert`}
          style={{ color: "var(--warn)" }}
        >
          ●
        </span>
      )}
      <button
        className="btn"
        style={{ padding: "0 6px", border: "none" }}
        title="Schließen"
        onClick={(event) => {
          event.stopPropagation();
          if (
            pending === 0 ||
            confirm(
              `„${info.fileName}" hat ${pending} nicht exportierte ${
                pending === 1 ? "Änderung" : "Änderungen"
              }. Trotzdem schließen?`,
            )
          ) {
            onClose();
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
