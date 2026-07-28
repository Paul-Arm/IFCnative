/**
 * Inspector: zeigt Details des zuletzt ausgewählten Objekts in sechs Modi
 * (Übersicht, Eigenschaften, Mengen, Beziehungen, Ressourcen, Platzierung).
 * Attribute, Eigenschaften, Mengen und Ressourcen-Zuordnungen sind editierbar;
 * jeder Schreibpfad läuft als Command durch die Pipeline
 * (`useCommands.execute`). „Platzierung" ist reine Anzeige.
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
import PlacementSection from "./PlacementSection";
import PropertiesSection from "./PropertiesSection";
import QuantitiesSection from "./QuantitiesSection";
import RelationsSection from "./RelationsSection";
import ResourcesSection from "./ResourcesSection";

type InspectorMode =
  | "overview"
  | "properties"
  | "quantities"
  | "relations"
  | "resources"
  | "placement";

const MODES: ReadonlyArray<{ id: InspectorMode; label: string }> = [
  { id: "overview", label: "Übersicht" },
  { id: "properties", label: "Eigenschaften" },
  { id: "quantities", label: "Mengen" },
  { id: "relations", label: "Beziehungen" },
  { id: "resources", label: "Ressourcen" },
  { id: "placement", label: "Platzierung" },
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
        {/* „Ressourcen" rendert auch ohne Auswahl — die Einheiten gelten modellweit. */}
        {!doc || (expressId === null && mode !== "resources") ? (
          <p className="pane-empty">
            {doc
              ? "Nichts ausgewählt — Objekt in Struktur, Viewer oder Graph wählen."
              : "Kein Dokument geöffnet."}
          </p>
        ) : (
          <>
            {expressId !== null && (
              <SelectionHeader
                count={selection.length}
                label={doc.session.labelOf(expressId)}
              />
            )}
            {mode === "overview" && expressId !== null && (
              <OverviewSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
            {mode === "properties" && expressId !== null && (
              <PropertiesSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
                query={query}
              />
            )}
            {mode === "quantities" && expressId !== null && (
              <QuantitiesSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
            {mode === "relations" && expressId !== null && (
              <RelationsSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
            {mode === "resources" && (
              <ResourcesSection
                docId={doc.id}
                session={doc.session}
                expressId={expressId}
              />
            )}
            {mode === "placement" && expressId !== null && (
              <PlacementSection
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
