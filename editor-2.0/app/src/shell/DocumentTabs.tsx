import { useDocuments } from "../store/documents";

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
      {documents.map((doc) => {
        const info = doc.session.info();
        const isActive = doc.id === activeId;
        return (
          <div
            key={doc.id}
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
            onClick={() => setActive(doc.id)}
            title={`${info.schema} · ${info.entityCount.toLocaleString("de-DE")} Entities`}
          >
            <span>{info.fileName}</span>
            {doc.changeCount > 0 && (
              <span title="Ungespeicherte Änderungen" style={{ color: "var(--warn)" }}>
                ●
              </span>
            )}
            <button
              className="btn"
              style={{ padding: "0 6px", border: "none" }}
              title="Schließen"
              onClick={(e) => {
                e.stopPropagation();
                if (
                  doc.changeCount === 0 ||
                  confirm(`„${info.fileName}" hat ungespeicherte Änderungen. Trotzdem schließen?`)
                ) {
                  closeDocument(doc.id);
                }
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
