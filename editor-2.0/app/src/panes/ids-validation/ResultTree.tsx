/**
 * Ergebnisbaum: je IDS-Dokument die aufklappbare Liste seiner Spezifikationen,
 * je Spezifikation die aufklappbare Objektliste.
 *
 * Kopfzeile einer Spezifikation: Status-Punkt (grün bestanden / rot
 * fehlgeschlagen / grau nicht anwendbar), Name, Balken mit der Passrate und die
 * Zähler „geprüft/bestanden/fehlgeschlagen" — alles direkt aus
 * `IDSSpecificationResult` (siehe `model.ts`).
 */
import { useState } from "react";

import EntityList from "./EntityList";
import {
  STATUS_CSS,
  STATUS_LABELS,
  filterEntities,
  type IdsDocRow,
  type IdsFilter,
  type IdsSpecRow,
} from "./model";

function SpecItem({
  docId,
  spec,
  filter,
}: {
  docId: string;
  spec: IdsSpecRow;
  filter: IdsFilter;
}) {
  const [open, setOpen] = useState(false);
  const rows = open ? filterEntities(spec.entities, filter) : [];

  return (
    <li>
      <button
        aria-expanded={open}
        className="ids-head"
        onClick={() => setOpen((value) => !value)}
        title={spec.description ?? "Spezifikation auf-/zuklappen"}
        type="button"
      >
        <span className="text-dim" style={{ width: 10 }}>
          {open ? "▾" : "▸"}
        </span>
        <span
          aria-label={STATUS_LABELS[spec.status]}
          className="ids-dot"
          style={{ background: STATUS_CSS[spec.status] }}
        />
        <span style={{ flex: 1, minWidth: 0 }}>{spec.name}</span>
        <span
          className="ids-bar"
          title={`${Math.round(spec.passRate)} % bestanden`}
        >
          <span style={{ width: `${Math.max(0, Math.min(100, spec.passRate))}%` }} />
        </span>
        <span className="text-dim">
          {spec.applicableCount} geprüft · {spec.passedCount} bestanden ·{" "}
          {spec.failedCount} fehlgeschlagen
        </span>
      </button>
      {spec.cardinalityMessage && (
        <p className="ids-detail" style={{ color: "var(--error)" }}>
          Anzahl nicht erfüllt: {spec.cardinalityMessage}
        </p>
      )}
      {open &&
        (spec.applicableCount === 0 ? (
          <p className="ids-detail">
            Kein Objekt trifft die Anwendbarkeit — nicht anwendbar.
          </p>
        ) : (
          <EntityList docId={docId} rows={rows} />
        ))}
    </li>
  );
}

export interface ResultTreeProps {
  docId: string;
  documents: readonly IdsDocRow[];
  filter: IdsFilter;
}

export default function ResultTree({ docId, documents, filter }: ResultTreeProps) {
  return (
    <div>
      {documents.map((doc) => (
        <section key={doc.key}>
          <header
            style={{
              alignItems: "baseline",
              background: "var(--bg-hover)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
              padding: "3px 8px",
            }}
          >
            <strong style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>
              {doc.name}
            </strong>
            <span className="text-dim">
              {doc.totals.specs} Spezifikation(en) · {doc.totals.failedSpecs}{" "}
              fehlgeschlagen
            </span>
          </header>
          {doc.specs.length === 0 ? (
            <p className="text-dim" style={{ margin: 0, padding: "4px 8px" }}>
              Dieses IDS enthält keine Spezifikationen.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {doc.specs.map((spec) => (
                <SpecItem key={spec.key} docId={docId} spec={spec} filter={filter} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
