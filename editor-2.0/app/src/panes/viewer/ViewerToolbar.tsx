/**
 * Werkzeugleiste des Viewers: Sichtbarkeit, X-Ray, Schnittebene und
 * benannte Ansichten. Reiner Präsentations-Baustein — der Zustand liegt
 * im ViewerPane.
 */
import type { PresetView } from "../../core/viewer";
import type { SectionState } from "./section";
import { SECTION_AXES } from "./section";

export interface ViewerToolbarProps {
  disabled: boolean;
  hasSelection: boolean;
  isolated: boolean;
  xray: boolean;
  section: SectionState;
  onZoomAll(): void;
  onIsolate(): void;
  onHide(): void;
  onShowAll(): void;
  onToggleXray(): void;
  onSection(patch: Partial<SectionState>): void;
  onPreset(view: PresetView): void;
}

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
    </div>
  );
}
