/**
 * Baukasten (M5): Bauteile mit Extrusionskörper erzeugen, Maße und Position
 * der Auswahl ändern, Öffnungen einschneiden. Jeder Schreibpfad läuft als
 * Command durch die Pipeline (`useCommands.execute`) und ist damit undo-bar.
 *
 * Aktualität (Befund 5): Die Abschnitte hängen ihre Memos an
 * `useDocRevision(docId)` — die dokumentweite Revision der Pipeline.
 */
import { useMemo, useState } from "react";
import { useActiveDocument } from "../../store/documents";
import { useSelectionOf } from "../../store/selection";
import { useDocRevision } from "../../commands/pipeline";
import { baseTypesOf } from "../../core/model/relationshipRules";
import CreateSection from "./CreateSection";
import EditSection from "./EditSection";
import OpeningSection from "./OpeningSection";

type BuilderMode = "create" | "edit" | "opening";

const MODES: ReadonlyArray<{ id: BuilderMode; label: string }> = [
  { id: "create", label: "Neues Bauteil" },
  { id: "edit", label: "Auswahl bearbeiten" },
  { id: "opening", label: "Öffnung" },
];

/** Gehört der Typ zur räumlichen Struktur (möglicher Parent)? */
function isSpatial(type: string): boolean {
  const chain = baseTypesOf(type).map((name) => name.toLowerCase());
  return (
    chain.includes("ifcspatialelement") ||
    chain.includes("ifcspatialstructureelement") ||
    chain.includes("ifcproject")
  );
}

export default function BuilderPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const selection = useSelectionOf(docId);
  const revision = useDocRevision(docId);
  const [mode, setMode] = useState<BuilderMode>("create");

  const selected = selection.length > 0 ? selection[selection.length - 1] : null;

  const kind = useMemo(() => {
    if (!doc || selected === null) return null;
    const type = doc.session.identityOf(selected).type;
    return { type, spatial: isSpatial(type) };
    // revision: nach Löschen/Reklassifizieren neu bewerten
  }, [doc, selected, revision]);

  if (!doc || !docId) {
    return (
      <div className="pane">
        <p className="pane-empty">Kein Dokument geöffnet.</p>
      </div>
    );
  }

  const elementId = kind && !kind.spatial ? selected : null;
  const spatialId = kind?.spatial ? selected : null;

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
      </div>

      <div className="pane-body" style={{ padding: "0 8px 10px" }}>
        {mode === "create" && (
          <CreateSection
            docId={docId}
            session={doc.session}
            selectedSpatialId={spatialId}
          />
        )}

        {mode === "edit" &&
          (elementId === null ? (
            <p className="pane-empty">
              Kein Bauteil ausgewählt — Objekt in Struktur, Viewer oder Graph
              wählen.
            </p>
          ) : (
            <EditSection
              docId={docId}
              session={doc.session}
              expressId={elementId}
            />
          ))}

        {mode === "opening" &&
          (elementId === null ? (
            <p className="pane-empty">
              Kein Bauteil ausgewählt — Öffnungen brauchen ein durchbrochenes
              Bauteil.
            </p>
          ) : (
            <OpeningSection
              docId={docId}
              session={doc.session}
              hostId={elementId}
            />
          ))}

        <p
          className="text-dim"
          style={{ fontSize: "0.75rem", marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 6 }}
        >
          3D-Ansicht: „Modell neu berechnen" im Viewer zeigt neue Körper.
        </p>
      </div>
    </div>
  );
}
