/**
 * Lens-Pane: regelbasiertes Einfärben/Ausblenden über @ifc-lite/lens.
 * Die eingebauten Presets werden gegen den Store des aktiven Dokuments
 * ausgewertet; Farb-Map und Ausblendungen gehen über den Overrides-Store
 * an das Viewer-Pane.
 */
import { useEffect, useMemo, useState } from "react";
import {
  BUILTIN_LENSES,
  evaluateAutoColorLens,
  evaluateLens,
  type Lens,
} from "@ifc-lite/lens";
import { useActiveDocument } from "../../store/documents";
import { useViewerOverrides } from "../viewer/overrides";
import { createLensProvider } from "./provider";

/** Deutsche Bezeichner der eingebauten Presets. */
const LABELS: Record<string, string> = {
  "lens-by-class": "Nach IFC-Klasse",
  "lens-structural": "Struktur",
  "lens-envelope": "Gebäudehülle",
  "lens-openings": "Öffnungen & Erschließung",
  "lens-auto-material": "Nach Material",
};

/** Presets, die in einer Ein-Modell-Sitzung ohne Gruppen-Provider nichts liefern. */
const UNSUPPORTED = new Set(["lens-by-model", "lens-by-zone"]);

const PRESETS: readonly Lens[] = BUILTIN_LENSES.filter(
  (lens) => !UNSUPPORTED.has(lens.id),
);

interface LensRow {
  id: string;
  name: string;
  color: string;
  count: number;
}

interface LensResult {
  rows: LensRow[];
  coloredCount: number;
  hiddenCount: number;
  durationMs: number;
}

export default function LensPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const applyOverrides = useViewerOverrides((s) => s.setColorOverrides);
  const clearOverrides = useViewerOverrides((s) => s.clear);
  const activeSource = useViewerOverrides((s) =>
    s.docId === docId ? s.source : null,
  );

  const [lensId, setLensId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LensResult | null>(null);

  useEffect(() => {
    setLensId("");
    setResult(null);
    setError(null);
  }, [docId]);

  const lens = useMemo(
    () => PRESETS.find((entry) => entry.id === lensId) ?? null,
    [lensId],
  );

  useEffect(() => {
    if (!doc || !docId || !lens) return;
    setBusy(true);
    setError(null);
    // Erst rendern lassen („Werte aus …"), dann die O(n)-Auswertung fahren.
    const timer = window.setTimeout(() => {
      try {
        const provider = createLensProvider(docId, doc.session);
        const evaluation = lens.autoColor
          ? evaluateAutoColorLens(lens.autoColor, provider)
          : evaluateLens(lens, provider);
        const rows: LensRow[] =
          "legend" in evaluation
            ? evaluation.legend.map((entry) => ({
                id: entry.id,
                name: entry.name,
                color: entry.color,
                count: entry.count,
              }))
            : lens.rules.map((rule) => ({
                id: rule.id,
                name: rule.name,
                color: rule.color,
                count: evaluation.ruleCounts.get(rule.id) ?? 0,
              }));
        setResult({
          rows,
          coloredCount: evaluation.colorMap.size,
          hiddenCount: evaluation.hiddenIds.size,
          durationMs: evaluation.executionTime,
        });
        applyOverrides(
          docId,
          LABELS[lens.id] ?? lens.name,
          evaluation.colorMap,
          evaluation.hiddenIds,
        );
      } catch (cause) {
        setResult(null);
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [doc, docId, lens, applyOverrides]);

  function reset(): void {
    setLensId("");
    setResult(null);
    setError(null);
    clearOverrides();
  }

  return (
    <div className="pane">
      <div className="pane-toolbar">
        <select
          className="input"
          disabled={!doc}
          value={lensId}
          onChange={(event) => setLensId(event.target.value)}
        >
          <option value="">Keine Lens</option>
          {PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {LABELS[preset.id] ?? preset.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!lensId && !activeSource}
          onClick={reset}
        >
          Zurücksetzen
        </button>
        {busy && <span className="text-dim">Werte aus …</span>}
      </div>

      <div className="pane-body">
        {!doc ? (
          <p className="pane-empty">Kein Dokument geöffnet.</p>
        ) : error ? (
          <p className="pane-empty">Auswertung fehlgeschlagen: {error}</p>
        ) : !result ? (
          <p className="pane-empty">
            Preset wählen — Treffer werden im Viewer eingefärbt.
          </p>
        ) : (
          <ResultTable result={result} stale={activeSource === null} />
        )}
      </div>
    </div>
  );
}

function ResultTable({
  result,
  stale,
}: {
  result: LensResult;
  stale: boolean;
}) {
  return (
    <>
      {stale && (
        <p className="pane-empty" style={{ paddingBottom: 0 }}>
          Im Viewer zurückgesetzt — Preset erneut wählen, um es anzuwenden.
        </p>
      )}
      <table className="kv-table">
        <thead>
          <tr>
            <th>Regel</th>
            <th style={{ width: "5rem" }}>Treffer</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.length === 0 ? (
            <tr>
              <td colSpan={2} className="dim">
                Keine Regeln in diesem Preset.
              </td>
            </tr>
          ) : (
            result.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      marginRight: 6,
                      borderRadius: 2,
                      background: row.color,
                    }}
                  />
                  {row.name}
                </td>
                <td className="dim">{row.count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <p className="text-dim" style={{ padding: "6px 8px", margin: 0 }}>
        {result.coloredCount} eingefärbt · {result.hiddenCount} ausgeblendet ·{" "}
        {Math.round(result.durationMs)} ms
      </p>
    </>
  );
}
