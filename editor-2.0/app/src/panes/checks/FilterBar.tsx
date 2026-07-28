/**
 * Zähler- und Filterzeile: Schweregrad-Umschalter mit Anzahl, „bestanden"-
 * Statistik, Textsuche und Quellenfilter.
 */
import {
  SEVERITY_LABELS,
  SOURCE_LABELS,
  type CheckSeverity,
  type CheckSourceId,
} from "../../domain/checks/types";
import { SEVERITY_CSS, type FindingFilter } from "./filter";

const SEVERITIES: readonly CheckSeverity[] = ["error", "warning", "info"];

export interface FilterBarProps {
  filter: FindingFilter;
  counts: Record<CheckSeverity, number>;
  /** Objekte ohne Fehlschlag im letzten Lauf. */
  passedCount: number;
  checkedCount: number;
  sources: readonly CheckSourceId[];
  onChange(filter: FindingFilter): void;
}

export default function FilterBar({
  filter,
  counts,
  passedCount,
  checkedCount,
  sources,
  onChange,
}: FilterBarProps) {
  return (
    <div className="pane-toolbar">
      {SEVERITIES.map((severity) => (
        <button
          key={severity}
          className="btn"
          data-active={filter.severities[severity]}
          onClick={() =>
            onChange({
              ...filter,
              severities: {
                ...filter.severities,
                [severity]: !filter.severities[severity],
              },
            })
          }
          title={`${SEVERITY_LABELS[severity]} ein-/ausblenden`}
          type="button"
        >
          <span
            aria-hidden
            style={{
              background: SEVERITY_CSS[severity],
              borderRadius: "50%",
              display: "inline-block",
              height: 8,
              marginRight: 6,
              width: 8,
            }}
          />
          {SEVERITY_LABELS[severity]} {counts[severity]}
        </button>
      ))}
      <span
        className="text-dim"
        title={`${checkedCount} Objekte geprüft`}
      >
        {passedCount} bestanden
      </span>
      <input
        className="input"
        placeholder="Suchen …"
        value={filter.text}
        onChange={(event) => onChange({ ...filter, text: event.target.value })}
        style={{ flex: "1 1 8rem", minWidth: "6rem" }}
      />
      <select
        className="input"
        value={filter.source}
        onChange={(event) =>
          onChange({
            ...filter,
            source: event.target.value as FindingFilter["source"],
          })
        }
      >
        <option value="all">Alle Quellen</option>
        {sources.map((source) => (
          <option key={source} value={source}>
            {SOURCE_LABELS[source]}
          </option>
        ))}
      </select>
    </div>
  );
}
