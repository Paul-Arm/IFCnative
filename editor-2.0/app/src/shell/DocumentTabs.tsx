/**
 * Dokument-Tabs in der Kopfleiste — Browser-Tab-Optik nach dem Vorbild der
 * ersten React-App: zweizeilig (Name + Schema/Entitäten), Status-Punkt links,
 * Schließen-Kreuz erst bei Hover. Der Dirty-Punkt und die Schließen-Rückfrage
 * hängen an der Undo-Stack-Tiefe (`usePendingChangeCount`, Befund 3/15) —
 * `changeCount` zählt die append-only Mutationsliste und bliebe nach einem
 * vollständigen Undo stehen, sodass der Tab „ungespeichert" meldete, obwohl
 * nichts offen ist.
 */
import { usePendingChangeCount } from "../commands/pipeline";
import { useDocuments, type DocumentEntry } from "../store/documents";

export function DocumentTabs() {
  const { documents, activeId, setActive, closeDocument } = useDocuments();
  if (documents.length === 0) return null;

  return (
    <div className="doc-tabs">
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
    <div className="doc-tab" data-active={isActive ? "true" : undefined}>
      <button
        type="button"
        className="doc-tab-btn"
        onClick={onActivate}
        title={`${info.fileName} · ${info.schema} · ${info.entityCount.toLocaleString("de-DE")} Entities`}
      >
        <span className="doc-tab-name">
          <span className="doc-tab-dot" aria-hidden="true" />
          <span>{info.fileName}</span>
          {pending > 0 ? (
            <span
              className="doc-tab-dirty"
              title={`${pending} ${pending === 1 ? "Änderung" : "Änderungen"} — noch nicht exportiert`}
            />
          ) : null}
        </span>
        <span className="doc-tab-sub">
          {info.schema} · {info.entityCount.toLocaleString("de-DE")} Entitäten
        </span>
      </button>
      <button
        type="button"
        className="doc-tab-close"
        title="Schließen"
        aria-label={`„${info.fileName}“ schließen`}
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
