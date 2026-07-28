/**
 * Werkzeugleiste des Viewers: Sichtbarkeit, X-Ray, Schnittebene und
 * benannte Ansichten. Reiner Präsentations-Baustein — der Zustand liegt
 * im ViewerPane.
 */
import type { PresetView } from "../../core/viewer";
import type { SectionState } from "./section";
import { SECTION_AXES } from "./section";

/** Exklusiver Werkzeugmodus des Viewers (M9). */
export type ViewerTool = "none" | "move" | "pick";

export interface ViewerToolbarProps {
  disabled: boolean;
  hasSelection: boolean;
  isolated: boolean;
  xray: boolean;
  section: SectionState;
  /** Aktives Werkzeug (Verschieben / Koordinaten picken). */
  tool: ViewerTool;
  onSelectTool(tool: ViewerTool): void;
  /** Offene Modelländerungen seit dem letzten Geometrie-Stand (Badge-Zähler). */
  pendingRebuild: number;
  /** Export läuft gerade — Neuberechnung sperren. */
  rebuilding: boolean;
  autoRebuild: boolean;
  onZoomAll(): void;
  onIsolate(): void;
  onHide(): void;
  onShowAll(): void;
  onToggleXray(): void;
  onSection(patch: Partial<SectionState>): void;
  onPreset(view: PresetView): void;
  onRebuild(): void;
  onToggleAutoRebuild(): void;
}

const REBUILD_TITLE =
  "Sitzung exportieren und die Geometrie daraus neu aufbauen — " +
  "danach sind neue Körper, Maßänderungen und Löschungen in 3D sichtbar.";
const AUTO_TITLE =
  "Automatisch 2 s nach der letzten Änderung neu berechnen. " +
  "Standardmäßig aus: Der Export großer Modelle ist teuer.";

const MOVE_TITLE =
  "Werkzeug „Verschieben“ (Taste W): Achsenpfeile am ausgewählten Bauteil " +
  "ziehen; beim Loslassen wird die Verschiebung als Command ausgeführt.";
const PICK_TITLE =
  "Werkzeug „Koordinaten picken“: Klick auf Geometrie liefert den Weltpunkt " +
  "in Metern (Statuszeile + Zwischenablage).";

const PRESETS: ReadonlyArray<{ id: PresetView; label: string }> = [
  { id: "iso", label: "Iso" },
  { id: "top", label: "Oben" },
  { id: "front", label: "Vorne" },
  { id: "left", label: "Links" },
];

export default function ViewerToolbar(props: ViewerToolbarProps) {
  const { disabled, hasSelection, section } = props;
  return (
    <div className="pane-toolbar">
      <button className="btn" disabled={disabled} onClick={props.onZoomAll}>
        Zoom auf Modell
      </button>
      <button
        className="btn"
        data-active={props.isolated}
        disabled={disabled || (!hasSelection && !props.isolated)}
        onClick={props.onIsolate}
      >
        Isolieren
      </button>
      <button
        className="btn"
        disabled={disabled || !hasSelection}
        onClick={props.onHide}
      >
        Ausblenden
      </button>
      <button className="btn" disabled={disabled} onClick={props.onShowAll}>
        Alles zeigen
      </button>
      <button
        className="btn"
        data-active={props.xray}
        disabled={disabled}
        onClick={props.onToggleXray}
      >
        X-Ray
      </button>

      <button
        className="btn"
        data-active={props.tool === "move"}
        disabled={disabled}
        title={MOVE_TITLE}
        onClick={() =>
          props.onSelectTool(props.tool === "move" ? "none" : "move")
        }
      >
        Verschieben (W)
      </button>
      <button
        className="btn"
        data-active={props.tool === "pick"}
        disabled={disabled}
        title={PICK_TITLE}
        onClick={() =>
          props.onSelectTool(props.tool === "pick" ? "none" : "pick")
        }
      >
        Koordinaten picken
      </button>

      <span className="text-dim" style={{ marginLeft: 8 }}>
        Schnitt
      </span>
      <select
        className="input"
        disabled={disabled}
        value={section.axis}
        onChange={(event) =>
          props.onSection({ axis: event.target.value as SectionState["axis"] })
        }
      >
        {SECTION_AXES.map((axis) => (
          <option key={axis.id} value={axis.id}>
            {axis.label}
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        value={section.position}
        aria-label="Position der Schnittebene"
        onChange={(event) =>
          props.onSection({ position: Number(event.target.value) })
        }
      />
      <button
        className="btn"
        data-active={section.enabled}
        disabled={disabled}
        onClick={() => props.onSection({ enabled: !section.enabled })}
      >
        {section.enabled ? "Schnitt an" : "Schnitt aus"}
      </button>

      <span className="text-dim" style={{ marginLeft: 8 }}>
        Ansicht
      </span>
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          className="btn"
          disabled={disabled}
          onClick={() => props.onPreset(preset.id)}
        >
          {preset.label}
        </button>
      ))}

      <button
        className="btn"
        style={{ marginLeft: 8 }}
        data-active={props.pendingRebuild > 0}
        disabled={disabled || props.rebuilding}
        title={REBUILD_TITLE}
        onClick={props.onRebuild}
      >
        {props.rebuilding ? "Berechne …" : "Modell neu berechnen"}
        {props.pendingRebuild > 0 && <Badge count={props.pendingRebuild} />}
      </button>
      <label className="text-dim" title={AUTO_TITLE} style={LABEL_STYLE}>
        <input
          type="checkbox"
          checked={props.autoRebuild}
          onChange={props.onToggleAutoRebuild}
        />
        automatisch
      </label>
    </div>
  );
}

const LABEL_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: "0.8125rem",
} as const;

/** Zähler der offenen Änderungen direkt am Button. */
function Badge({ count }: { count: number }) {
  return (
    <span
      style={{
        marginLeft: 6,
        padding: "0 5px",
        borderRadius: 8,
        background: "var(--accent)",
        color: "var(--bg-panel)",
        fontSize: "0.6875rem",
      }}
    >
      {count}
    </span>
  );
}
