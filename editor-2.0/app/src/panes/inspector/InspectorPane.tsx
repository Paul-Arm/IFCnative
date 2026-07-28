/**
 * Inspector: zeigt Details des zuletzt ausgewählten Objekts in vier Modi
 * (Übersicht, Eigenschaften, Mengen, Beziehungen). Attribute, Eigenschaften
 * und Mengen sind editierbar; jeder Schreibpfad läuft als Command durch die
 * Pipeline (`useCommands.execute`).
 *
 * Aktualität (Befund 5): Die Abschnitte hängen ihre Memos an
 * `useDocRevision(docId)` — die dokumentweite Revision aus der Pipeline, die
 * bei do, undo UND redo steigt. Ein pane-lokaler Zähler sähe weder Strg+Z
 * noch Änderungen aus anderen Panes (Batch, Graph, Katalog).
 */
import { useState } from "react";
import { useActiveDocument } from "../../store/documents";
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
  const selection = useSelectionOf(doc?.id ?? null);
  const [mode, setMode] = useState<InspectorMode>("overview");
  const [query, setQuery] = useState("");

  const expressId =
    selection.length > 0 ? selection[selection.length - 1] : null;

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
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
            {mode === "properties" && (
              <PropertiesSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
                query={query}
              />
            )}
            {mode === "quantities" && (
              <QuantitiesSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
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
