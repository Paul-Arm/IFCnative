/**
 * Abschnitt „Prüfung": validiert die aktuelle Auswahl gegen die gewählte
 * Katalogklasse und bietet Quick-Fixes (einzeln/alle) sowie das Anlegen aller
 * Merkmalsgruppen auf der Auswahl an. Jede Aktion läuft über `execute()` und
 * ist damit undo-bar.
 */
import { useMemo } from "react";

import { useCommands } from "../../commands/pipeline";
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
  const changeCount = doc?.changeCount ?? 0;
  const checked = useMemo(() => selection.slice(0, CHECK_CAP), [selection]);

  const findings = useMemo<CatalogValidationFinding[]>(() => {
    if (!session) return [];
    // changeCount hängt die Prüfung an jede Modelländerung.
    void changeCount;
    return checked.flatMap((expressId) =>
      validateEntityAgainstCatalogObject(session, expressId, objectType),
    );
  }, [session, checked, objectType, changeCount]);

  const suggestion = useMemo(() => {
    if (!session || checked.length === 0) return undefined;
    return suggestCatalogObjectForEntity(session, checked[0], objectTypes);
  }, [session, checked, objectTypes]);

  if (!doc || !session) {
    return (
      <section style={{ borderTop: "1px solid var(--border)", padding: "8px 10px" }}>
        <h4 style={{ margin: "0 0 4px" }}>Prüfung</h4>
        <p className="text-dim" style={{ margin: 0 }}>
          Kein Modell geöffnet.
        </p>
      </section>
    );
  }

  const fixable = findings.filter((entry) => entry.quickFix);

  return (
    <section style={{ borderTop: "1px solid var(--border)", padding: "8px 10px" }}>
      <h4 style={{ margin: "0 0 6px" }}>Prüfung</h4>

      <div className="pane-toolbar" style={{ border: 0, padding: 0 }}>
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
            className="btn"
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
          <li
            key={entry.id}
            style={{
              alignItems: "baseline",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 6,
              padding: "3px 0",
            }}
          >
            <span
              aria-label={CATALOG_SEVERITY_LABEL[entry.severity]}
              style={{
                background: CATALOG_SEVERITY_COLOR[entry.severity],
                borderRadius: "50%",
                display: "inline-block",
                flex: "0 0 auto",
                height: 8,
                width: 8,
              }}
              title={CATALOG_SEVERITY_LABEL[entry.severity]}
            />
            <span style={{ flex: 1 }}>{entry.message}</span>
            {entry.quickFix ? (
              <button
                className="btn"
                onClick={() => {
                  const command = cmdCatalogQuickFix(session, entry);
                  if (command) execute(doc.id, command);
                }}
                type="button"
              >
                {entry.quickFix.label}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
