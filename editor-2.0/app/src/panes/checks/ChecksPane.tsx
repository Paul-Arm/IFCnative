/**
 * Prüfzentrum (M5): führt die registrierten Prüfquellen über das aktive
 * Dokument aus und macht die Befunde bedienbar — filtern, auswählen,
 * im 3D markieren, als BCF exportieren.
 *
 * Quellen kommen ausschließlich aus der Registry in `domain/checks/store.ts`:
 * `idsSource` trägt sich beim Laden selbst ein (statischer Import unten), die
 * Quellen aus `domain/checks/sources/**` über deren `registerCheckSources()`.
 * Letzteres wird lazy und in try/catch geladen — fehlt oder bricht das Modul,
 * bleibt das Prüfzentrum mit den übrigen Quellen bedienbar. Die UI zeigt genau
 * die Quellen, die in der Registry stehen.
 *
 * Ergebnisse veralten mit Edits: gezeigt wird die Revision des Laufs; liegt
 * die aktuelle Dokument-Revision darüber, erscheint der Hinweis
 * „Modell geändert — neu prüfen".
 */
import { useEffect, useMemo, useState } from "react";

import { useDocRevision } from "../../commands/pipeline";
import { BCF_FILE_NAME, exportFindingsAsBcf } from "../../domain/checks/bcf";
import "../../domain/checks/idsSource";
import {
  allFindings,
  checkedCount as sumChecked,
  registeredCheckSources,
  severityCounts,
  useChecks,
  useDocChecks,
} from "../../domain/checks/store";
import { useActiveDocument } from "../../store/documents";
import { useSelection } from "../../store/selection";
import { useViewerOverrides } from "../viewer/overrides";
import FilterBar from "./FilterBar";
import FindingsList from "./FindingsList";
import IdsSection from "./IdsSection";
import SourcesBar from "./SourcesBar";
import { DEFAULT_FILTER, failuresOf, filterFindings } from "./filter";
import { HIGHLIGHT_SOURCE, NO_HIDDEN, affectedEntityIds, findingColors } from "./highlight";

const ISOLATE_TITLE =
  "Setzt die Auswahl auf alle betroffenen Objekte der gefilterten Fehlschläge — " +
  "das Isolieren selbst löst die Viewer-Werkzeugleiste aus.";
const BCF_TITLE =
  `Erzeugt „${BCF_FILE_NAME}": ein BCF-Topic je angezeigtem Befund, ` +
  "mit den GlobalIds der betroffenen Objekte.";

export default function ChecksPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const session = doc?.session ?? null;
  const revision = useDocRevision(docId);
  const state = useDocChecks(docId);
  const runChecks = useChecks((s) => s.runChecks);
  const setSelection = useSelection((s) => s.setSelection);
  const applyOverrides = useViewerOverrides((s) => s.setColorOverrides);
  const clearOverrides = useViewerOverrides((s) => s.clear);
  const marked = useViewerOverrides(
    (s) => s.docId === docId && s.source === HIGHLIGHT_SOURCE,
  );

  const [filter, setFilter] = useState(DEFAULT_FILTER);
  const [error, setError] = useState<string | null>(null);
  /** Zählt hoch, sobald sich weitere Quellen eingetragen haben. */
  const [registryRevision, setRegistryRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void import("../../domain/checks/sources/register")
      .then((module) => module.registerCheckSources())
      .catch(() => false)
      .then(() => {
        if (active) setRegistryRevision((value) => value + 1);
      });
    return () => {
      active = false;
    };
  }, []);

  const sources = useMemo(() => registeredCheckSources(), [registryRevision]);
  const findings = useMemo(() => allFindings(state), [state]);
  const visible = useMemo(
    () => filterFindings(findings, filter),
    [findings, filter],
  );
  const counts = useMemo(() => severityCounts(findings), [findings]);
  const checked = sumChecked(state);
  const failedCount = affectedEntityIds(failuresOf(findings)).length;
  const stale = state.ranAtRevision !== null && revision > state.ranAtRevision;
  const enabledCount = sources.filter((id) => state.enabled[id]).length;

  async function exportBcf(): Promise<void> {
    if (!session) return;
    setError(null);
    try {
      await exportFindingsAsBcf(session, visible);
    } catch (cause) {
      setError(
        `BCF-Export fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  if (!doc || !session || !docId) {
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  }

  return (
    <div className="pane">
      <SourcesBar
        docId={docId}
        state={state}
        sources={sources}
        canRun={!state.running && enabledCount > 0}
        onRun={() => void runChecks(docId, session)}
      />
      <IdsSection />

      <div className="pane-toolbar">
        <button
          className="btn"
          disabled={visible.length === 0}
          onClick={() => void exportBcf()}
          title={BCF_TITLE}
          type="button"
        >
          BCF exportieren
        </button>
        <button
          className="btn"
          disabled={visible.length === 0}
          onClick={() =>
            setSelection(docId, affectedEntityIds(failuresOf(visible)))
          }
          title={ISOLATE_TITLE}
          type="button"
        >
          Betroffene isolieren
        </button>
        <button
          className="btn"
          data-active={marked}
          disabled={visible.length === 0}
          onClick={() =>
            applyOverrides(
              docId,
              HIGHLIGHT_SOURCE,
              findingColors(failuresOf(visible)),
              NO_HIDDEN,
            )
          }
          title="Fehler rot, Warnungen orange im 3D einfärben"
          type="button"
        >
          Im 3D markieren
        </button>
        <button
          className="btn"
          disabled={!marked}
          onClick={() => clearOverrides()}
          type="button"
        >
          Markierung aufheben
        </button>
        <span className="text-dim">
          {state.ranAtRevision === null
            ? "Noch nicht geprüft"
            : `Stand: Revision ${state.ranAtRevision}`}
        </span>
        {stale && (
          <span style={{ color: "var(--warn)" }}>
            Modell geändert — neu prüfen
          </span>
        )}
      </div>

      <FilterBar
        filter={filter}
        counts={counts}
        passedCount={Math.max(0, checked - failedCount)}
        checkedCount={checked}
        sources={sources}
        onChange={setFilter}
      />

      <div className="pane-body">
        {error && <p style={{ color: "var(--error)", padding: "6px 8px" }}>{error}</p>}
        {state.ranAtRevision === null ? (
          <p className="pane-empty">
            Quellen wählen und „Prüfen" — die Befunde erscheinen hier.
          </p>
        ) : findings.length === 0 ? (
          <p className="pane-empty">
            Keine Befunde — {checked} Objekte geprüft.
          </p>
        ) : visible.length === 0 ? (
          <p className="pane-empty">Kein Befund passt zum Filter.</p>
        ) : (
          <FindingsList docId={docId} session={session} findings={visible} />
        )}
      </div>
    </div>
  );
}
