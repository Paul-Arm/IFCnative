/**
 * Modus „Ressourcen" (M9): Material, Klassifikation, Dokumente,
 * Gruppen & Systeme, Typ (auswahlbezogen) sowie Einheiten (modellweit).
 *
 * Lesen: geparste Daten über die On-Demand-Extraktoren PLUS Overlay-Kanten
 * aus `relationsOf` — der CSR des Parsers ist statisch, Zuordnungen aus
 * dieser Sitzung erscheinen deshalb als „Overlay"-Zeilen (Badge), bis die
 * Datei exportiert und neu geparst wird (siehe domain/resources/read.ts).
 * Schreiben: kompakte Anlegen-Formulare, je Formular ein Command.
 */
import { useMemo } from "react";
import { useDocRevision } from "../../commands/pipeline";
import type { ModelSession } from "../../core/session";
import {
  readClassificationRows,
  readDocumentRows,
  readGroupRows,
  readMaterialRows,
  readTypeRows,
  readUnitRows,
  type ResourceEntry,
} from "../../domain/resources/read";
import { useSelection } from "../../store/selection";
import { SectionHeading } from "./parts";
import { MaterialForm, MaterialLayersForm } from "./MaterialForms";
import {
  ClassificationForm,
  DocumentForm,
  GroupForm,
  TypeForm,
  UnitForm,
} from "./AssignForms";

interface ResourcesSectionProps {
  docId: string;
  session: ModelSession;
  /** null = keine Auswahl; dann sind nur die modellweiten Einheiten aktiv */
  expressId: number | null;
}

export default function ResourcesSection({
  docId,
  session,
  expressId,
}: ResourcesSectionProps) {
  const revision = useDocRevision(docId);
  const select = useSelection((s) => s.select);

  const rows = useMemo(
    () =>
      expressId === null
        ? null
        : {
            materials: readMaterialRows(session, expressId),
            classifications: readClassificationRows(session, expressId),
            documents: readDocumentRows(session, expressId),
            groups: readGroupRows(session, expressId),
            types: readTypeRows(session, expressId),
          },
    [session, expressId, revision],
  );
  const units = useMemo(() => readUnitRows(session), [session, revision]);

  const onPick = (entry: ResourceEntry): void => {
    if (entry.id > 0) select(docId, entry.id);
  };

  return (
    <div>
      {rows && expressId !== null ? (
        <>
          <ResourceBlock title="Material" rows={rows.materials} onPick={onPick} />
          <MaterialForm docId={docId} session={session} expressId={expressId} revision={revision} />
          <MaterialLayersForm docId={docId} session={session} expressId={expressId} />

          <ResourceBlock title="Klassifikation" rows={rows.classifications} onPick={onPick} />
          <ClassificationForm docId={docId} session={session} expressId={expressId} revision={revision} />

          <ResourceBlock title="Dokumente" rows={rows.documents} onPick={onPick} />
          <DocumentForm docId={docId} session={session} expressId={expressId} revision={revision} />

          <ResourceBlock title="Gruppen & Systeme" rows={rows.groups} onPick={onPick} />
          <GroupForm docId={docId} session={session} expressId={expressId} revision={revision} />

          <ResourceBlock title="Typ" rows={rows.types} onPick={onPick} />
          <TypeForm docId={docId} session={session} expressId={expressId} revision={revision} />
        </>
      ) : (
        <p className="pane-empty">
          Kein Objekt ausgewählt — Material, Klassifikation, Dokumente, Gruppen
          und Typ beziehen sich auf die Auswahl. Die Einheiten unten gelten
          modellweit.
        </p>
      )}

      <ResourceBlock title="Einheiten (modellweit)" rows={units} onPick={onPick} />
      <UnitForm docId={docId} session={session} />
    </div>
  );
}

function ResourceBlock({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: ResourceEntry[];
  onPick(entry: ResourceEntry): void;
}) {
  return (
    <div>
      <SectionHeading>
        {title} <span className="text-dim">({rows.length})</span>
      </SectionHeading>
      {rows.length === 0 ? (
        <p className="text-dim" style={{ margin: "0 8px 6px", fontSize: "0.75rem" }}>
          Keine Einträge.
        </p>
      ) : (
        rows.map((entry, index) => (
          <button
            key={`${entry.origin}-${entry.id}-${index}`}
            className="row-item"
            style={{ display: "flex", gap: 6, alignItems: "baseline" }}
            title={entry.id > 0 ? `#${entry.id} auswählen` : undefined}
            onClick={() => onPick(entry)}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.label || "(ohne Namen)"}
            </span>
            {entry.detail && (
              <span className="text-dim" style={{ fontSize: "0.75rem" }}>
                {entry.detail}
              </span>
            )}
            <span
              className="text-dim"
              style={{ marginLeft: "auto", fontSize: "0.7rem", flex: "0 0 auto" }}
            >
              {entry.id > 0 ? `#${entry.id} · ` : ""}
              {entry.origin === "overlay" ? "Overlay" : "geparst"}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
