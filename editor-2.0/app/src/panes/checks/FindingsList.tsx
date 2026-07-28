/**
 * Befundliste: Schweregrad-Punkt, Quelle, Meldung, Detail und die betroffenen
 * Objekte als Chips. Ein Klick auf einen Chip wählt das Objekt aus und bittet
 * den Viewer um den Kamerafokus.
 */
import type { ModelSession } from "../../core/session";
import {
  SEVERITY_LABELS,
  SOURCE_LABELS,
  type CheckFinding,
} from "../../domain/checks/types";
import { useSelection } from "../../store/selection";
import { SEVERITY_CSS } from "./filter";

/** Anzeigegrenze je Befund — ein Clash-Lauf kann tausende Objekte treffen. */
const MAX_CHIPS = 12;

export interface FindingsListProps {
  docId: string;
  session: ModelSession;
  findings: readonly CheckFinding[];
}

export default function FindingsList({
  docId,
  session,
  findings,
}: FindingsListProps) {
  const select = useSelection((s) => s.select);
  const requestFocus = useSelection((s) => s.requestFocus);

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {findings.map((finding) => (
        <li
          key={finding.id}
          style={{
            borderBottom: "1px solid var(--border-60)",
            display: "flex",
            gap: 8,
            padding: "6px 8px",
          }}
        >
          <span
            aria-label={SEVERITY_LABELS[finding.severity]}
            title={SEVERITY_LABELS[finding.severity]}
            className="dot"
            style={{ background: SEVERITY_CSS[finding.severity], marginTop: 5 }}
          />
          <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
            <div style={{ fontSize: "0.75rem" }}>
              <span className="text-dim">{SOURCE_LABELS[finding.source]} · </span>
              {finding.message}
            </div>
            {finding.detail && (
              <div className="text-dim" style={{ fontSize: "0.7rem" }}>
                {finding.detail}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {finding.entityIds.slice(0, MAX_CHIPS).map((entityId) => (
                <button
                  key={entityId}
                  className="chip"
                  onClick={() => {
                    select(docId, entityId);
                    requestFocus(docId, entityId);
                  }}
                  title="Auswählen und im Viewer fokussieren"
                  type="button"
                >
                  <span className="mono">#{entityId}</span>{" "}
                  {session.labelOf(entityId)}
                </button>
              ))}
              {finding.entityIds.length > MAX_CHIPS && (
                <span className="text-dim" style={{ fontSize: "0.7rem" }}>
                  … und {finding.entityIds.length - MAX_CHIPS} weitere
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
