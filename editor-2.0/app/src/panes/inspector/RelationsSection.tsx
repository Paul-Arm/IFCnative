/**
 * Modus „Beziehungen": Nachbarn des Objekts, gruppiert nach Beziehungsart.
 * Klick wählt die Gegenseite aus, Doppelklick zentriert zusätzlich den Viewer.
 *
 * Befund 7: Beziehungen leben im Sitzungs-Overlay (`relationRevision`), das
 * Graph-Pane und Kaskaden-Dialog mitschreiben. Zusätzlich hängt das Memo an
 * der Dokument-Revision, damit ein Undo einer Beziehungsänderung hier ankommt.
 */
import { useMemo } from "react";
import { useDocRevision } from "../../commands/pipeline";
import type { ModelSession } from "../../core/session";
import type { RelationRow } from "../../core/model/relations";
import { useSelection } from "../../store/selection";
import { SectionHeading } from "./parts";

interface RelationsSectionProps {
  docId: string;
  session: ModelSession;
  expressId: number;
}

interface RelationGroup {
  label: string;
  rows: RelationRow[];
}

export default function RelationsSection({
  docId,
  session,
  expressId,
}: RelationsSectionProps) {
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);
  const revision = useDocRevision(docId);

  const groups = useMemo(
    () => groupByLabel(session.relationsOf(expressId)),
    [session, expressId, revision],
  );

  if (groups.length === 0) {
    return <p className="pane-empty">Keine Beziehungen für dieses Objekt.</p>;
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label}>
          <SectionHeading>
            {group.label}{" "}
            <span className="text-dim">({group.rows.length})</span>
          </SectionHeading>
          {group.rows.map((row) => (
            <button
              key={`${row.direction}-${row.relType}-${row.otherId}`}
              className="row-item"
              title={
                row.direction === "forward"
                  ? "Ausgehende Beziehung"
                  : "Eingehende Beziehung"
              }
              onClick={() => select(docId, row.otherId)}
              onDoubleClick={() => {
                select(docId, row.otherId);
                requestFocus(docId, row.otherId);
              }}
            >
              <span className="text-dim" style={{ marginRight: 6 }}>
                {row.direction === "forward" ? "→" : "←"}
              </span>
              {row.otherType}
              {row.otherName ? ` ‚${row.otherName}'` : ""}
              <span className="text-dim"> #{row.otherId}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function groupByLabel(rows: RelationRow[]): RelationGroup[] {
  const byLabel = new Map<string, RelationRow[]>();
  for (const row of rows) {
    const bucket = byLabel.get(row.label);
    if (bucket) bucket.push(row);
    else byLabel.set(row.label, [row]);
  }
  return [...byLabel.entries()]
    .map(([label, groupRows]) => ({ label, rows: groupRows }))
    .sort((a, b) => a.label.localeCompare(b.label, "de-DE"));
}
