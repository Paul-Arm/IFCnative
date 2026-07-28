/**
 * Objektliste einer Spezifikation: bestandene UND fehlgeschlagene Objekte mit
 * Status-Punkt, Label aus `session.labelOf` und — bei Fehlschlag — dem
 * Anforderungsdetail, das `validateIDS` liefert (Grund, Erwartet, Gefunden).
 *
 * Einfacher Klick wählt das Objekt aus, Doppelklick bittet den Viewer zusätzlich
 * um den Kamerafokus.
 */
import { useSelection } from "../../store/selection";
import { STATUS_CSS, STATUS_LABELS, failureText, type IdsEntityRow } from "./model";

/** Anzeigegrenze je Spezifikation — ein IDS kann tausende Objekte treffen. */
const MAX_ROWS = 300;

export interface EntityListProps {
  docId: string;
  rows: readonly IdsEntityRow[];
}

export default function EntityList({ docId, rows }: EntityListProps) {
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);

  if (rows.length === 0)
    return (
      <p className="text-dim" style={{ margin: 0, padding: "2px 8px 4px 26px" }}>
        Kein Objekt passt zum Filter.
      </p>
    );

  return (
    <div>
      {rows.slice(0, MAX_ROWS).map((row) => {
        const status = row.passed ? "pass" : "fail";
        return (
          <div key={row.key}>
            <button
              className="ids-entity"
              onClick={() => select(docId, row.expressId)}
              onDoubleClick={() => requestFocus(docId, row.expressId)}
              title="Klick wählt aus, Doppelklick fokussiert im Viewer"
              type="button"
            >
              <span
                aria-label={STATUS_LABELS[status]}
                className="ids-dot"
                style={{ background: STATUS_CSS[status] }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>{row.label}</span>
              <span className="text-dim">#{row.expressId}</span>
            </button>
            {row.failures.map((failure, index) => (
              <div className="ids-detail" key={`${row.key}-${index}`}>
                {failure.optional && <em>optional · </em>}
                {failureText(failure)}
              </div>
            ))}
          </div>
        );
      })}
      {rows.length > MAX_ROWS && (
        <p className="text-dim" style={{ margin: 0, padding: "2px 8px 4px 26px" }}>
          … und {rows.length - MAX_ROWS} weitere — Filter oder Suche eingrenzen.
        </p>
      )}
    </div>
  );
}
