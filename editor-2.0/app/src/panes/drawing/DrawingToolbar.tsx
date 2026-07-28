/**
 * Werkzeugleiste der 2D-Ansicht: Ableitungsart, Geschoss, Schnitthöhe und die
 * Aktionen. Die Neuberechnung läuft NUR auf Klick — der Geometrie-Pass
 * (`exportStep()` + Tessellierung + Schnitt über alle Dreiecke) ist teuer, ein
 * automatischer Lauf bei jeder Modelländerung oder Reglerbewegung würde das
 * Pane blockieren.
 */
import type { MeshBounds } from "./geometry";
import type { DrawingSettings } from "./drawing";
import { formatElevation, storeyLabel, type StoreyOption } from "./storeys";

interface DrawingToolbarProps {
  settings: DrawingSettings;
  storeys: readonly StoreyOption[];
  bounds: MeshBounds | null;
  busy: string | null;
  hasResult: boolean;
  /** Grund, warum die gezeigte Zeichnung veraltet ist (null = aktuell). */
  staleReason: string | null;
  onChange(patch: Partial<DrawingSettings>): void;
  onCompute(): void;
  onExport(): void;
  onReset(): void;
}

/** Wertebereich des senkrechten Schnitts entlang seiner Achse. */
export function axisRange(
  bounds: MeshBounds | null,
  mode: DrawingSettings["mode"],
): { min: number; max: number } {
  if (!bounds) return { min: -50, max: 50 };
  return mode === "section-x"
    ? { min: bounds.minX, max: bounds.maxX }
    : { min: bounds.minZ, max: bounds.maxZ };
}

export default function DrawingToolbar({
  settings,
  storeys,
  bounds,
  busy,
  hasResult,
  staleReason,
  onChange,
  onCompute,
  onExport,
  onReset,
}: DrawingToolbarProps) {
  const range = axisRange(bounds, settings.mode);
  const isPlan = settings.mode === "plan";
  const label = !hasResult ? "Berechnen" : "Aktualisieren";

  return (
    <div className="pane-toolbar">
      <select
        className="input"
        value={settings.mode}
        title="Grundriss schneidet waagerecht, Schnitt X/Z senkrecht."
        onChange={(event) =>
          onChange({ mode: event.target.value as DrawingSettings["mode"] })
        }
      >
        <option value="plan">Grundriss</option>
        <option value="section-x">Schnitt (X-Achse)</option>
        <option value="section-z">Schnitt (Z-Achse)</option>
      </select>

      {isPlan ? (
        <>
          <select
            className="input"
            value={settings.storeyId ?? ""}
            disabled={storeys.length === 0}
            onChange={(event) =>
              onChange({ storeyId: Number(event.target.value) })
            }
          >
            {storeys.map((storey) => (
              <option key={storey.expressId} value={storey.expressId}>
                {storeyLabel(storey)}
              </option>
            ))}
          </select>
          <label className="text-dim" title="Schnitthöhe über Geschossbezug">
            Schnitthöhe{" "}
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={settings.offset}
              onChange={(event) =>
                onChange({ offset: Number(event.target.value) })
              }
            />{" "}
            {settings.offset.toFixed(2).replace(".", ",")} m
          </label>
        </>
      ) : (
        <label className="text-dim" title="Lage der Schnittebene im Modell">
          Lage{" "}
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={0.1}
            value={Math.min(range.max, Math.max(range.min, settings.position))}
            onChange={(event) =>
              onChange({ position: Number(event.target.value) })
            }
          />{" "}
          {formatElevation(settings.position)}
        </label>
      )}

      <label className="text-dim" title="Teuer: verdeckte Kanten werden gestrichelt ergänzt.">
        <input
          type="checkbox"
          checked={settings.hiddenLines}
          onChange={(event) => onChange({ hiddenLines: event.target.checked })}
        />{" "}
        Verdeckte Kanten
      </label>

      <button className="btn" disabled={busy !== null} onClick={onCompute}>
        {label}
      </button>
      <button className="btn" disabled={!hasResult} onClick={onReset}>
        Ansicht zurücksetzen
      </button>
      <button className="btn" disabled={!hasResult} onClick={onExport}>
        SVG exportieren
      </button>

      {busy !== null && <span className="text-dim">{busy}</span>}
      {busy === null && staleReason !== null && (
        <span className="text-dim">{staleReason}</span>
      )}
    </div>
  );
}
