/**
 * Inspector: zeigt Details des zuletzt ausgewählten Objekts in vier Modi
 * (Übersicht, Eigenschaften, Mengen, Beziehungen). Einziger Schreibpfad in M1
 * ist das Editieren von Pset-Werten im Modus „Eigenschaften".
 */
import { useState } from "react";
import { useActiveDocument, useDocuments } from "../../store/documents";
import { useSelectionOf } from "../../store/selection";
import OverviewSection from "./OverviewSection";
import PropertiesSection from "./PropertiesSection";
import QuantitiesSection from "./QuantitiesSection";
import RelationsSection from "./RelationsSection";

type InspectorMode = "overview" | "properties" | "quantities" | "relations";

const MODES: ReadonlyArray<{ id: InspectorMode; label: string }> = [
  { id: "overview", label: "Übersicht" },
  { id: "properties", label: "Eigenschaften" },
  { id: "quantities", label: "Mengen" },
  { id: "relations", label: "Beziehungen" },
];

export default function InspectorPane() {
  const doc = useActiveDocument();
  const touch = useDocuments((s) => s.touch);
  const selection = useSelectionOf(doc?.id ?? null);
  const [mode, setMode] = useState<InspectorMode>("overview");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);

  const expressId =
    selection.length > 0 ? selection[selection.length - 1] : null;

  function handleMutate(): void {
    if (doc) touch(doc.id);
    setRevision((value) => value + 1);
  }

  return (
    <div className="pane">
      <div className="pane-toolbar">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            className="btn"
            data-active={mode === entry.id}
            onClick={() => setMode(entry.id)}
          >
            {entry.label}
          </button>
        ))}
        {mode === "properties" && (
          <input
            className="input"
            style={{ marginLeft: "auto", minWidth: 140 }}
            placeholder="Suchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </div>

      <div className="pane-body">
        {!doc || expressId === null ? (
          <p className="pane-empty">
            {doc
              ? "Nichts ausgewählt — Objekt in Struktur, Viewer oder Graph wählen."
              : "Kein Dokument geöffnet."}
          </p>
        ) : (
          <>
            <SelectionHeader
              count={selection.length}
              label={doc.session.labelOf(expressId)}
            />
            {mode === "overview" && (
              <OverviewSection
                session={doc.session}
                expressId={expressId}
                revision={revision}
              />
            )}
            {mode === "properties" && (
              <PropertiesSection
                session={doc.session}
                expressId={expressId}
                query={query}
                revision={revision}
                onMutate={handleMutate}
              />
            )}
            {mode === "quantities" && (
              <QuantitiesSection session={doc.session} expressId={expressId} />
            )}
            {mode === "relations" && (
              <RelationsSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SelectionHeader({ count, label }: { count: number; label: string }) {
  return (
    <div
      style={{
        padding: "6px 8px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {count > 1 && (
        <div className="text-dim" style={{ fontSize: "0.75rem" }}>
          {count} Objekte ausgewählt — Details für zuletzt gewähltes
        </div>
      )}
      <div style={{ fontWeight: 600 }}>{label}</div>
    </div>
  );
}
