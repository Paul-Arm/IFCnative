/**
 * Abschnitt „Prüfung": validiert die aktuelle Auswahl gegen die gewählte
 * Katalogklasse und bietet Quick-Fixes (einzeln/alle) sowie das Anlegen aller
 * Merkmalsgruppen auf der Auswahl an. Jede Aktion läuft über `execute()` und
 * ist damit undo-bar.
 */
import { useMemo } from "react";

import { useCommands, useDocRevision } from "../../commands/pipeline";
import {
  cmdApplyCatalogPsets,
  cmdCatalogQuickFix,
  cmdCatalogQuickFixAll,
} from "../../domain/catalog/commands";
import {
  CATALOG_SEVERITY_COLOR,
  CATALOG_SEVERITY_LABEL,
  catalogObjectLabel,
  type CatalogObjectType,
  type CatalogValidationFinding,
} from "../../domain/catalog/model";
import {
  suggestCatalogObjectForEntity,
  validateEntityAgainstCatalogObject,
} from "../../domain/catalog/validation";
import { useActiveDocument } from "../../store/documents";
import { useSelectionOf } from "../../store/selection";
import { useCatalog } from "./store";

/** Obergrenze der geprüften Objekte je Durchlauf. */
const CHECK_CAP = 25;

export default function CheckSection({
  objectType,
  objectTypes,
}: {
  objectType: CatalogObjectType;
  objectTypes: readonly CatalogObjectType[];
}) {
  const doc = useActiveDocument();
  const selection = useSelectionOf(doc?.id ?? null);
  const execute = useCommands((s) => s.execute);
  const select = useCatalog((s) => s.select);
  const session = doc?.session ?? null;
  // Dokument-Revision (do/undo/redo) statt `changeCount` — nach einem Undo
  // muss die Prüfung wieder die alten Befunde zeigen (Befund 5).
  const revision = useDocRevision(doc?.id ?? null);
  const checked = useMemo(() => selection.slice(0, CHECK_CAP), [selection]);

  const findings = useMemo<CatalogValidationFinding[]>(() => {
    if (!session) return [];
    return checked.flatMap((expressId) =>
      validateEntityAgainstCatalogObject(session, expressId, objectType),
    );
  }, [session, checked, objectType, revision]);

  const suggestion = useMemo(() => {
    if (!session || checked.length === 0) return undefined;
    return suggestCatalogObjectForEntity(session, checked[0], objectTypes);
  }, [session, checked, objectTypes, revision]);

  if (!doc || !session) {
    return (
      <section
        style={{ borderTop: "1px solid var(--border-60)", padding: "8px 10px" }}
      >
        <h4 className="card-title" style={{ margin: "0 0 4px" }}>
          Prüfung
        </h4>
        <p className="list-note" style={{ padding: 0 }}>
          Kein Modell geöffnet.
        </p>
      </section>
    );
  }

  const fixable = findings.filter((entry) => entry.quickFix);

  return (
    <section
      style={{ borderTop: "1px solid var(--border-60)", padding: "8px 10px" }}
    >
      <h4 className="card-title" style={{ margin: "0 0 6px" }}>
        Prüfung
      </h4>

      <div className="pane-toolbar">
        <span className="text-dim">
          {selection.length === 0
            ? "Keine Auswahl"
            : `${checked.length} von ${selection.length} ausgewählten Objekten geprüft`}
        </span>
        <button
          className="btn"
          disabled={selection.length === 0}
          onClick={() => {
            const command = cmdApplyCatalogPsets(session, selection, objectType);
            if (command) execute(doc.id, command);
          }}
          title="Alle Merkmalsgruppen der Klasse als Psets mit Katalog-Typen anlegen"
          type="button"
        >
          Pset(s) auf Auswahl anwenden
        </button>
        <button
          className="btn"
          disabled={fixable.length === 0}
          onClick={() => {
            const command = cmdCatalogQuickFixAll(session, fixable);
            if (command) execute(doc.id, command);
          }}
          type="button"
        >
          Alle Quick-Fixes ({fixable.length})
        </button>
      </div>

      {suggestion && suggestion.id !== objectType.id ? (
        <p className="text-dim" style={{ margin: "6px 0 0" }}>
          Vorschlag für #{checked[0]}:{" "}
          <button
            className="btn btn-sm"
            onClick={() => select(suggestion.id)}
            type="button"
          >
            {catalogObjectLabel(suggestion)} verwenden
          </button>
        </p>
      ) : null}

      {selection.length > 0 && findings.length === 0 ? (
        <p className="text-dim" style={{ margin: "6px 0 0" }}>
          Keine Befunde — die Auswahl erfüllt {catalogObjectLabel(objectType)}.
        </p>
      ) : null}

      <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
        {findings.map((entry) => (
          <li key={entry.id} className="list-row">
            <span
              aria-label={CATALOG_SEVERITY_LABEL[entry.severity]}
              className="dot"
              style={{ background: CATALOG_SEVERITY_COLOR[entry.severity] }}
              title={CATALOG_SEVERITY_LABEL[entry.severity]}
            />
            <span style={{ flex: 1, minWidth: 0 }}>{entry.message}</span>
            {entry.quickFix ? (
              <span className="row-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    const command = cmdCatalogQuickFix(session, entry);
                    if (command) execute(doc.id, command);
                  }}
                  type="button"
                >
                  {entry.quickFix.label}
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
