/**
 * IDS-Validierung (M8) — eigenes Fenster für buildingSMART-Anforderungen, mit
 * mehr Tiefe als der IDS-Bereich des Prüfzentrums: dort werden die Berichte zu
 * einer flachen Befundliste eingekocht, hier bleibt die Struktur des Berichts
 * erhalten (Dokument → Spezifikation → Objekt → Anforderung), inklusive der
 * BESTANDENEN Objekte.
 *
 * Bedienmuster übernommen vom ifc-lite-Viewer (docs/guide/ids.md): Ergebnisse
 * je Spezifikation und je Objekt durchsehen, Umschalter „nur Fehlschläge / alle",
 * getrennte 3D-Markierung für Fehlschläge (rot) und Bestandene (grün), Klick auf
 * ein Objekt springt im 3D dorthin.
 *
 * Geteilt mit dem Prüfzentrum wird alles, was es schon gibt: der app-weite
 * Dokumenten-Store und `sessionAccessor` aus `domain/checks/idsSource.ts`, die
 * Farbbrücke `panes/viewer/overrides.ts`. Neu ist nur die Auswertung.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useDocRevision } from "../../commands/pipeline";
import { useIdsDocuments } from "../../domain/checks/idsSource";
import { useActiveDocument } from "../../store/documents";
import { useViewerOverrides } from "../viewer/overrides";
import DocumentsSection from "./DocumentsSection";
import ResultTree from "./ResultTree";
import { csvFileName, downloadCsv, runResultToCsv } from "./csv";
import { IDS_HIGHLIGHT_SOURCE, NO_HIDDEN, idsColors } from "./highlight";
import { DEFAULT_IDS_FILTER, type IdsFilter } from "./model";
import { useIdsDocState, useIdsValidation } from "./store";
import "./ids-validation.css";

const CSV_TITLE =
  "Bericht der aktuell gefilterten Ergebnisse als CSV " +
  "(Spezifikation;Entity;GlobalId;Status;Detail — Semikolon, UTF-8-BOM).";
const BCF_HINT =
  `BCF-Themen aus Fehlschlägen erzeugt das Prüfzentrum (Quelle „IDS") — ` +
  "hier bewusst nicht doppelt angeboten.";

export default function IdsValidationPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const session = doc?.session ?? null;
  const revision = useDocRevision(docId);
  const state = useIdsDocState(docId);
  const run = useIdsValidation((s) => s.run);
  const reset = useIdsValidation((s) => s.reset);
  const entries = useIdsDocuments((s) => s.entries);

  const applyOverrides = useViewerOverrides((s) => s.setColorOverrides);
  const clearOverrides = useViewerOverrides((s) => s.clear);
  const marked = useViewerOverrides(
    (s) => s.docId === docId && s.source === IDS_HIGHLIGHT_SOURCE,
  );

  const [filter, setFilter] = useState<IdsFilter>(DEFAULT_IDS_FILTER);
  const [modes, setModes] = useState({ failed: true, passed: false });

  const result = state.result;
  const totals = result?.totals ?? null;
  const stale = result !== null && revision > result.ranAtRevision;

  /** Markierung anwenden — beide Umschalter zusammen ergeben eine Farb-Map. */
  function mark(next: { failed: boolean; passed: boolean }): void {
    setModes(next);
    if (!docId) return;
    const colors = idsColors(result, next);
    if (colors.size === 0) clearOverrides();
    else applyOverrides(docId, IDS_HIGHLIGHT_SOURCE, colors, NO_HIDDEN);
  }

  /**
   * Nach einem neuen Lauf die aktive Markierung nachziehen — sonst zeigt der
   * Viewer die Farben des vorigen Laufs. Hängt bewusst nur am Ergebnisobjekt:
   * `applyOverrides` verändert `marked`/`modes` nicht, es kann also nicht
   * zurückschlagen.
   */
  const markedRef = useRef(marked);
  const modesRef = useRef(modes);
  markedRef.current = marked;
  modesRef.current = modes;
  useEffect(() => {
    if (!docId || !result || !markedRef.current) return;
    const colors = idsColors(result, modesRef.current);
    if (colors.size === 0) clearOverrides();
    else applyOverrides(docId, IDS_HIGHLIGHT_SOURCE, colors, NO_HIDDEN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const summary = useMemo(() => {
    if (!totals) return null;
    return `${totals.specs} Spezifikationen · ${totals.failedSpecs} fehlgeschlagen · ${totals.checked} Objekte geprüft · ${totals.passed} bestanden · ${totals.failed} fehlgeschlagen`;
  }, [totals]);

  if (!doc || !session || !docId)
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;

  return (
    <div className="pane">
      <DocumentsSection onChanged={() => reset(docId)} />

      <div className="pane-toolbar">
        <button
          className="btn"
          disabled={state.running || entries.length === 0}
          onClick={() => void run(docId, session, revision)}
          title="Alle geladenen IDS-Dokumente gegen das aktive Modell prüfen"
          type="button"
        >
          {state.running ? "Validiere …" : "Validieren"}
        </button>
        <button
          className="btn"
          data-active={marked && modes.failed}
          disabled={!result}
          onClick={() => mark({ ...modes, failed: !modes.failed })}
          title="Fehlgeschlagene Objekte im 3D rot einfärben"
          type="button"
        >
          Fehlschläge rot markieren
        </button>
        <button
          className="btn"
          data-active={marked && modes.passed}
          disabled={!result}
          onClick={() => mark({ ...modes, passed: !modes.passed })}
          title="Bestandene Objekte im 3D grün einfärben"
          type="button"
        >
          Bestandene grün markieren
        </button>
        <button
          className="btn"
          disabled={!marked}
          onClick={() => clearOverrides()}
          type="button"
        >
          Markierung aufheben
        </button>
        <button
          className="btn"
          disabled={!result}
          onClick={() =>
            result &&
            downloadCsv(
              csvFileName(session.fileName),
              runResultToCsv(result, filter),
            )
          }
          title={CSV_TITLE}
          type="button"
        >
          Bericht (CSV)
        </button>
        <span className="text-dim" title={BCF_HINT}>
          BCF: im Prüfzentrum
        </span>
      </div>

      <div className="pane-toolbar">
        <button
          className="btn"
          data-active={filter.mode === "failed"}
          onClick={() => setFilter({ ...filter, mode: "failed" })}
          type="button"
        >
          nur Fehlschläge
        </button>
        <button
          className="btn"
          data-active={filter.mode === "all"}
          onClick={() => setFilter({ ...filter, mode: "all" })}
          type="button"
        >
          alle
        </button>
        <input
          className="input"
          onChange={(event) => setFilter({ ...filter, text: event.target.value })}
          placeholder="Objekt oder Fehlertext suchen …"
          style={{ flex: 1, minWidth: 120 }}
          type="search"
          value={filter.text}
        />
        {summary && <span className="text-dim">{summary}</span>}
        {stale && (
          <span style={{ color: "var(--warn)" }}>
            Modell geändert (Revision {revision}) — erneut validieren
          </span>
        )}
      </div>

      <div className="pane-body">
        {state.error && (
          <p style={{ color: "var(--error)", padding: "6px 8px" }}>{state.error}</p>
        )}
        {!result ? (
          <p className="pane-empty">
            {entries.length === 0
              ? `IDS-Dokument laden, dann „Validieren".`
              : `Noch nicht validiert — „Validieren" startet den Lauf.`}
          </p>
        ) : result.documents.length === 0 ? (
          <p className="pane-empty">Kein IDS-Dokument im Lauf.</p>
        ) : (
          <ResultTree
            docId={docId}
            documents={result.documents}
            filter={filter}
          />
        )}
      </div>
    </div>
  );
}
