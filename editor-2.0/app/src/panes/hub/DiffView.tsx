/**
 * Ergebnis eines Standvergleichs: Zusammenfassung und die drei Listen.
 *
 * Einträge unter „geändert" sind anklickbar — der Klick versucht, das Objekt
 * über seine GlobalId im AKTIVEN Dokument auszuwählen. Für „hinzugefügt" und
 * „entfernt" ist das nicht sinnvoll (das Objekt fehlt je nach Blickrichtung in
 * einem der Stände), sie bleiben reine Anzeige.
 */
import type { HubDiff, HubDiffElement } from "../../domain/hub/types";

/** Anzeigegrenze je Liste — ein Vergleich kann tausende Objekte umfassen. */
const MAX_ROWS = 200;

export interface DiffViewProps {
  diff: HubDiff;
  labelA: string;
  labelB: string;
  canSelect: boolean;
  onSelect(element: HubDiffElement): void;
  onClose(): void;
}

function describe(element: HubDiffElement): string {
  const parts = [element.label, element.globalId].filter(
    (part): part is string => Boolean(part),
  );
  const suffix = element.expressId === undefined ? "" : ` · #${element.expressId}`;
  return parts.join(" · ") + suffix;
}

function Section({
  title,
  elements,
  interactive,
  canSelect,
  onSelect,
}: {
  title: string;
  elements: readonly HubDiffElement[];
  interactive: boolean;
  canSelect: boolean;
  onSelect(element: HubDiffElement): void;
}) {
  return (
    <section style={{ borderTop: "1px solid var(--border)" }}>
      <div className="pane-toolbar" style={{ borderBottom: "none" }}>
        <strong>{title}</strong>
        <span className="text-dim">{elements.length}</span>
      </div>
      {elements.length === 0 ? (
        <p className="pane-empty" style={{ padding: "0 16px 8px" }}>
          Keine Einträge.
        </p>
      ) : (
        <>
          {elements.slice(0, MAX_ROWS).map((element, index) =>
            interactive ? (
              <button
                key={`${element.globalId}-${index}`}
                className="row-item"
                disabled={!canSelect}
                onClick={() => onSelect(element)}
                title={
                  canSelect
                    ? "Im aktiven Dokument auswählen (über GlobalId)"
                    : "Kein Dokument geöffnet"
                }
                type="button"
              >
                {describe(element)}
              </button>
            ) : (
              <div
                key={`${element.globalId}-${index}`}
                className="row-item"
                style={{ cursor: "default" }}
              >
                {describe(element)}
              </div>
            ),
          )}
          {elements.length > MAX_ROWS && (
            <p className="text-dim" style={{ padding: "2px 8px" }}>
              … und {elements.length - MAX_ROWS} weitere
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default function DiffView({
  diff,
  labelA,
  labelB,
  canSelect,
  onSelect,
  onClose,
}: DiffViewProps) {
  const { summary } = diff;
  return (
    <div>
      <div className="pane-toolbar">
        <strong>Vergleich</strong>
        <span className="text-dim">
          {labelA} → {labelB}
        </span>
        <span className="text-dim">
          + {summary.added} hinzugefügt · − {summary.removed} entfernt · ±{" "}
          {summary.modified} geändert
        </span>
        <span style={{ marginLeft: "auto" }} />
        <button className="btn" onClick={onClose} type="button">
          Schließen
        </button>
      </div>
      <Section
        title="Geändert"
        elements={diff.modified}
        interactive
        canSelect={canSelect}
        onSelect={onSelect}
      />
      <Section
        title="Hinzugefügt"
        elements={diff.added}
        interactive={false}
        canSelect={canSelect}
        onSelect={onSelect}
      />
      <Section
        title="Entfernt"
        elements={diff.removed}
        interactive={false}
        canSelect={canSelect}
        onSelect={onSelect}
      />
    </div>
  );
}
