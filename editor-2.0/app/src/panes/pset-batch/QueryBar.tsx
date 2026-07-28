/**
 * Auswahlquellen-Leiste: zeigt die aktuelle Auswahl aus Baum/Viewer und bietet
 * daneben eine abfragebasierte Auswahl (IFC-Klasse + optionaler
 * Property-Filter). „Auswahl setzen" ersetzt die Dokumentauswahl komplett —
 * alle anderen Panes ziehen dadurch mit.
 */
import { useMemo, useState } from "react";
import type { ModelSession } from "../../core/session";
import {
  QUERY_OPERATORS,
  hasPartialFilter,
  isRunnable,
  modelTypes,
  runQuery,
  type QueryOperator,
  type QuerySpec,
} from "./query";

interface QueryBarProps {
  session: ModelSession;
  selectionCount: number;
  onApply(expressIds: number[]): void;
}

const EMPTY_SPEC: QuerySpec = {
  ifcClass: "",
  psetName: "",
  propName: "",
  operator: "=",
  value: "",
};

export default function QueryBar({
  session,
  selectionCount,
  onApply,
}: QueryBarProps) {
  const [spec, setSpec] = useState<QuerySpec>(EMPTY_SPEC);
  const [hits, setHits] = useState<number | null>(null);
  const types = useMemo(() => modelTypes(session), [session]);

  function patch(part: Partial<QuerySpec>): void {
    setSpec((current) => ({ ...current, ...part }));
    setHits(null);
  }

  function apply(): void {
    const ids = runQuery(session, spec);
    setHits(ids.length);
    onApply(ids);
  }

  const partial = hasPartialFilter(spec);
  const ready = isRunnable(spec);

  return (
    <div className="pane-toolbar">
      <span className="text-dim">
        {selectionCount} {selectionCount === 1 ? "Objekt" : "Objekte"} aus
        Auswahl
      </span>
      <span className="batch-divider" />

      <input
        className="input"
        list="batch-ifc-types"
        style={{ minWidth: 150 }}
        placeholder="IFC-Klasse …"
        value={spec.ifcClass}
        title="Im Modell vorkommende Klassen — Vorschlagsliste"
        onChange={(event) => patch({ ifcClass: event.target.value })}
      />
      <datalist id="batch-ifc-types">
        {types.map((type) => (
          <option key={type.raw} value={type.raw}>
            {type.label} ({type.count})
          </option>
        ))}
      </datalist>

      <input
        className="input"
        style={{
          minWidth: 110,
          borderColor: partial && !spec.psetName.trim() ? "var(--warn)" : undefined,
        }}
        placeholder="Pset (optional)"
        value={spec.psetName}
        onChange={(event) => patch({ psetName: event.target.value })}
      />
      <input
        className="input"
        style={{
          minWidth: 110,
          borderColor: partial && !spec.propName.trim() ? "var(--warn)" : undefined,
        }}
        placeholder="Property"
        value={spec.propName}
        onChange={(event) => patch({ propName: event.target.value })}
      />
      <select
        className="input"
        value={spec.operator}
        onChange={(event) =>
          patch({ operator: event.target.value as QueryOperator })
        }
      >
        {QUERY_OPERATORS.map((operator) => (
          <option key={operator} value={operator}>
            {operator}
          </option>
        ))}
      </select>
      <input
        className="input"
        style={{
          minWidth: 100,
          borderColor: partial && !spec.value.trim() ? "var(--warn)" : undefined,
        }}
        placeholder="Wert"
        value={spec.value}
        onChange={(event) => patch({ value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && ready) {
            event.preventDefault();
            apply();
          }
        }}
      />

      <button
        className="btn"
        disabled={!ready}
        title={
          partial
            ? "Property-Filter braucht Pset, Property und Wert — oder alle drei leer"
            : "Ersetzt die Auswahl im gesamten Editor"
        }
        onClick={apply}
      >
        Auswahl setzen
      </button>
      {hits !== null && (
        <span className="text-dim">
          {hits === 0 ? "kein Treffer" : `${hits} Treffer`}
        </span>
      )}
    </div>
  );
}
