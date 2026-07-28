/**
 * 2D-Ansicht (M7): Grundrisse und Schnitte über @ifc-lite/drawing-2d.
 *
 * Ablauf einer Ableitung:
 *   1. `session.exportStep()` → `GeometryProcessor.process()` (Muster aus
 *      `domain/checks/sources/clash.ts`) — der einzige Weg zu `MeshData[]`,
 *      der Sitzungsänderungen einschließt. Ergebnis wird je Dokument-Revision
 *      gehalten, ein Reglerwechsel kostet deshalb keinen zweiten Pass.
 *   2. Geschossbezug aus der Geometrie (`storeyLevel`), plus Schnitthöhe.
 *   3. `generateFloorPlan` / `generateSection` → `Drawing2D`.
 *
 * Beide Pässe laufen NUR auf Klick. Ändert sich das Dokument (useDocRevision)
 * oder eine Einstellung, bleibt die gezeigte Zeichnung stehen und die
 * Werkzeugleiste weist sie als veraltet aus.
 *
 * Auswahl-Synchronisation: jede `DrawingLine` und jedes `cutPolygon` trägt die
 * `entityId` ihrer Quelle — Klick setzt damit die Auswahl des Dokuments
 * (Shift/Strg additiv), umgekehrt hebt die Ansicht die ausgewählten Objekte
 * farbig hervor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocRevision } from "../../commands/pipeline";
import { useActiveDocument } from "../../store/documents";
import { useSelection, useSelectionOf } from "../../store/selection";
import DrawingToolbar, { axisRange } from "./DrawingToolbar";
import DrawingView from "./DrawingView";
import {
  DEFAULT_SETTINGS,
  generateDrawing,
  settingsKey,
  type DrawingResult,
  type DrawingSettings,
} from "./drawing";
import { loadMeshes, storeyLevel, type MeshSource } from "./geometry";
import { collectStoreys, formatElevation, type StoreyOption } from "./storeys";
import { downloadSvg, drawingToSvg, svgFileName } from "./svgExport";

/** Einen Frame durchlassen, damit „Berechne …" vor dem teuren Pass erscheint. */
function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function drawingTitle(
  settings: DrawingSettings,
  storeys: readonly StoreyOption[],
  cutAt: number,
): string {
  if (settings.mode === "plan") {
    const storey = storeys.find((s) => s.expressId === settings.storeyId);
    return `Grundriss ${storey?.name ?? "Geschoss"} ${formatElevation(cutAt)}`;
  }
  const axis = settings.mode === "section-x" ? "X" : "Z";
  return `Schnitt ${axis} ${formatElevation(cutAt)}`;
}

/** Schnittlage in Mesh-Koordinaten (Meter). */
function cutHeight(
  source: MeshSource,
  settings: DrawingSettings,
  storeys: readonly StoreyOption[],
): number {
  if (settings.mode !== "plan") return settings.position;
  const storey = storeys.find((s) => s.expressId === settings.storeyId);
  const fallback = storey?.elevation ?? source.bounds.minY;
  const base = storey
    ? storeyLevel(source.meshes, storey.elementIds, fallback)
    : source.bounds.minY;
  return base + settings.offset;
}

export default function DrawingPane() {
  const doc = useActiveDocument();
  const docId = doc?.id ?? null;
  const session = doc?.session ?? null;
  const revision = useDocRevision(docId);
  const selectedIds = useSelectionOf(docId);
  const select = useSelection((s) => s.select);

  // `revision` steht bewusst in den Abhängigkeiten: der Strukturbaum ist
  // gecacht, strukturelle Edits sollen die Geschossliste trotzdem erneuern.
  const storeys = useMemo(
    () => collectStoreys(session?.spatialTree() ?? null),
    [session, revision],
  );
  const selection = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [settings, setSettings] = useState<DrawingSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<DrawingResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  /** Meshes des zuletzt berechneten Standes (Cache über Reglerwechsel hinweg). */
  const meshes = useRef<MeshSource | null>(null);

  useEffect(() => {
    meshes.current = null;
    setResult(null);
    setError(null);
    setBusy(null);
    setSettings(DEFAULT_SETTINGS);
  }, [docId]);

  // Geschossvorauswahl: unterstes Geschoss, sobald der Baum eines kennt.
  useEffect(() => {
    setSettings((current) => {
      const known = storeys.some((s) => s.expressId === current.storeyId);
      if (known || storeys.length === 0) return current;
      return { ...current, storeyId: storeys[0].expressId };
    });
  }, [storeys]);

  const patch = useCallback((next: Partial<DrawingSettings>): void => {
    setSettings((current) => ({ ...current, ...next }));
  }, []);

  const compute = useCallback(async (): Promise<void> => {
    if (!session) return;
    setError(null);
    try {
      let source = meshes.current;
      if (!source || source.revision !== revision) {
        setBusy("Geometrie wird aufbereitet …");
        await tick();
        source = await loadMeshes(session, revision);
        meshes.current = source;
      }
      // Schnittlage eines senkrechten Schnitts erst mit bekannten Ausmaßen
      // sinnvoll: außerhalb des Modells auf die Mitte setzen.
      let active = settings;
      if (active.mode !== "plan") {
        const range = axisRange(source.bounds, active.mode);
        if (active.position < range.min || active.position > range.max) {
          active = { ...active, position: (range.min + range.max) / 2 };
          setSettings(active);
        }
      }
      setBusy("Zeichnung wird abgeleitet …");
      await tick();
      const next = await generateDrawing(
        source.meshes,
        active,
        cutHeight(source, active, storeys),
        revision,
      );
      setResult(next);
      setResetToken((value) => value + 1);
    } catch (cause) {
      setResult(null);
      setError(
        `Ableitung fehlgeschlagen: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(null);
    }
  }, [session, revision, settings, storeys]);

  const pick = useCallback(
    (entityId: number, additive: boolean): void => {
      if (docId) select(docId, entityId, additive);
    },
    [docId, select],
  );

  function exportSvg(): void {
    if (!result || !session) return;
    const title = drawingTitle(settings, storeys, result.cutAt);
    downloadSvg(
      svgFileName(session.fileName, title),
      drawingToSvg(result.drawing, title, session.fileName),
    );
  }

  if (!doc || !session) {
    return <p className="pane-empty">Kein Dokument geöffnet.</p>;
  }

  const staleReason =
    result === null
      ? null
      : result.revision !== revision
        ? "Modell geändert — Aktualisieren"
        : result.key !== settingsKey(settings)
          ? "Einstellungen geändert — Aktualisieren"
          : null;

  return (
    <div className="pane">
      <DrawingToolbar
        settings={settings}
        storeys={storeys}
        bounds={meshes.current?.bounds ?? null}
        busy={busy}
        hasResult={result !== null}
        staleReason={staleReason}
        onChange={patch}
        onCompute={() => void compute()}
        onExport={exportSvg}
        onReset={() => setResetToken((value) => value + 1)}
      />
      <div className="pane-body" style={{ overflow: "hidden" }}>
        {error !== null ? (
          <p className="pane-empty">{error}</p>
        ) : settings.mode === "plan" && storeys.length === 0 ? (
          <p className="pane-empty">
            Kein Geschoss (IfcBuildingStorey) im Modell — Grundriss nicht
            ableitbar. Ein senkrechter Schnitt geht ohne Geschoss.
          </p>
        ) : result === null ? (
          <p className="pane-empty">
            Noch keine Zeichnung. „Berechnen" leitet Schnittkanten aus der
            Geometrie ab (bei großen Modellen dauert das einige Sekunden).
          </p>
        ) : result.paths.length === 0 ? (
          <p className="pane-empty">
            Die Schnittebene bei {formatElevation(result.cutAt)} trifft keine
            Geometrie — Schnitthöhe oder Geschoss anpassen.
          </p>
        ) : (
          <DrawingView
            result={result}
            selected={selection}
            resetToken={resetToken}
            onPick={pick}
          />
        )}
      </div>
      {result !== null && error === null && (
        <p className="text-dim" style={{ padding: "4px 8px", margin: 0 }}>
          Schnitt bei {formatElevation(result.cutAt)} ·{" "}
          {result.drawing.stats.cutLineCount} Schnittkanten ·{" "}
          {result.drawing.lines.length} Linien ·{" "}
          {result.drawing.cutPolygons.length} Schnittflächen ·{" "}
          {Math.round(result.drawing.stats.processingTimeMs)} ms
        </p>
      )}
    </div>
  );
}
