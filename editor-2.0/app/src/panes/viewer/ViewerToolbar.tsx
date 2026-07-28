/**
 * Schwebende Viewer-Werkzeugleisten (M10, Blender-Stil nach dem Vorbild der
 * ersten React-App): eine vertikale Glas-Leiste links oben mit Icon-Buttons
 * (Werkzeuge, Sichtbarkeit, Schnitt, Darstellung, Neuberechnung), rechts
 * oben die benannten Ansichten, und — nur bei aktivem Schnitt-Werkzeug —
 * eine horizontale Detail-Leiste oben mittig (Achse, Position, Flip).
 *
 * Reiner Präsentations-Baustein — der Zustand liegt im ViewerPane; die
 * Leisten liegen ALS OVERLAY über dem Canvas (position absolute).
 */
import type { PresetView } from "../../core/viewer";
import type { IconComponent } from "../../shell/ribbon/icons";
import {
  IconClipBox,
  IconCrosshair,
  IconCursor,
  IconDrawing,
  IconEyeAll,
  IconEyeOff,
  IconGridLines,
  IconIsolate,
  IconKnife,
  IconMoveTool,
  IconRefresh,
  IconRotateTool,
  IconScaleTool,
  IconSun,
  IconXray,
  IconZoom,
} from "../../shell/ribbon/icons";
import type { SectionState } from "./section";
import { SECTION_AXES } from "./section";

/** Exklusiver Werkzeugmodus des Viewers (M9/M10). */
export type ViewerTool =
  | "none"
  | "move"
  | "rotate"
  | "scale"
  | "pick"
  | "slice"
  | "draw";

export interface ViewerToolbarProps {
  disabled: boolean;
  hasSelection: boolean;
  isolated: boolean;
  xray: boolean;
  section: SectionState;
  tool: ViewerTool;
  onSelectTool(tool: ViewerTool): void;
  pendingRebuild: number;
  rebuilding: boolean;
  autoRebuild: boolean;
  sky: boolean;
  grid: boolean;
  onToggleSky(): void;
  onToggleGrid(): void;
  onZoomAll(): void;
  onIsolate(): void;
  onHide(): void;
  onShowAll(): void;
  onToggleXray(): void;
  onSection(patch: Partial<SectionState>): void;
  clipBoxActive: boolean;
  onClipBoxOnSelection(): void;
  onPreset(view: PresetView): void;
  onRebuild(): void;
  onToggleAutoRebuild(): void;
}

const REBUILD_TITLE =
  "Modell neu berechnen: Sitzung exportieren und die Geometrie daraus neu " +
  "aufbauen — danach sind neue Körper, Maß-/Lageänderungen und Löschungen " +
  "in 3D sichtbar.";
const AUTO_TITLE =
  "Automatisch 2 s nach der letzten Änderung neu berechnen. " +
  "Standardmäßig aus: Der Export großer Modelle ist teuer.";

const PRESETS: ReadonlyArray<{ id: PresetView; label: string }> = [
  { id: "iso", label: "Iso" },
  { id: "top", label: "Oben" },
  { id: "front", label: "Vorne" },
  { id: "left", label: "Links" },
];

function ToolButton({
  icon: Icon,
  title,
  active,
  disabled,
  onClick,
  badge,
}: {
  icon: IconComponent;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className="fab-btn"
      data-active={active ? "true" : undefined}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="fab-icon" />
      {badge !== undefined && badge > 0 ? (
        <span className="fab-badge">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </button>
  );
}

export default function ViewerToolbar(props: ViewerToolbarProps) {
  const { disabled, hasSelection, section, tool } = props;
  const pickTool = (next: ViewerTool) =>
    props.onSelectTool(tool === next ? "none" : next);

  return (
    <>
      {/* — linke Werkzeug-Leiste — */}
      <div className="viewer-fab" role="toolbar" aria-label="Viewer-Werkzeuge">
        <ToolButton
          icon={IconCursor}
          title="Auswählen (Standard)"
          active={tool === "none"}
          disabled={disabled}
          onClick={() => props.onSelectTool("none")}
        />
        <ToolButton
          icon={IconMoveTool}
          title="Verschieben (W) — Achsenpfeile ziehen, Live-Vorschau"
          active={tool === "move"}
          disabled={disabled}
          onClick={() => pickTool("move")}
        />
        <ToolButton
          icon={IconRotateTool}
          title="Rotieren (R) — Ring ziehen, Yaw um die Z-Achse"
          active={tool === "rotate"}
          disabled={disabled}
          onClick={() => pickTool("rotate")}
        />
        <ToolButton
          icon={IconScaleTool}
          title="Skalieren (S) — Achsgriffe ziehen, Umschalt = uniform"
          active={tool === "scale"}
          disabled={disabled}
          onClick={() => pickTool("scale")}
        />
        <ToolButton
          icon={IconDrawing}
          title="Polygon zeichnen (P) — Umriss klicken, Doppelklick/Enter schließt"
          active={tool === "draw"}
          disabled={disabled}
          onClick={() => pickTool("draw")}
        />
        <ToolButton
          icon={IconCrosshair}
          title="Koordinaten picken — Klick liefert den Weltpunkt (Statuszeile + Zwischenablage)"
          active={tool === "pick"}
          disabled={disabled}
          onClick={() => pickTool("pick")}
        />

        <span className="fab-divider" aria-hidden="true" />

        <ToolButton
          icon={IconZoom}
          title="Auf Modell zoomen"
          disabled={disabled}
          onClick={props.onZoomAll}
        />
        <ToolButton
          icon={IconIsolate}
          title="Auswahl isolieren"
          active={props.isolated}
          disabled={disabled || (!hasSelection && !props.isolated)}
          onClick={props.onIsolate}
        />
        <ToolButton
          icon={IconEyeOff}
          title="Auswahl ausblenden"
          disabled={disabled || !hasSelection}
          onClick={props.onHide}
        />
        <ToolButton
          icon={IconEyeAll}
          title="Alles zeigen"
          disabled={disabled}
          onClick={props.onShowAll}
        />
        <ToolButton
          icon={IconXray}
          title="X-Ray (Auswahl bleibt deckend)"
          active={props.xray}
          disabled={disabled}
          onClick={props.onToggleXray}
        />

        <span className="fab-divider" aria-hidden="true" />

        <ToolButton
          icon={IconKnife}
          title="Schneiden (X) — Ziehen verschiebt die Schnittebene"
          active={tool === "slice"}
          disabled={disabled}
          onClick={() => pickTool("slice")}
        />
        <ToolButton
          icon={IconClipBox}
          title="Clip-Box auf die Auswahl setzen (+10 % Rand); ohne Auswahl auf das Modell"
          active={props.clipBoxActive}
          disabled={disabled}
          onClick={props.onClipBoxOnSelection}
        />

        <span className="fab-divider" aria-hidden="true" />

        <ToolButton
          icon={IconSun}
          title="Himmel an/aus"
          active={props.sky}
          disabled={disabled}
          onClick={props.onToggleSky}
        />
        <ToolButton
          icon={IconGridLines}
          title="Bodenraster an/aus"
          active={props.grid}
          disabled={disabled}
          onClick={props.onToggleGrid}
        />

        <span className="fab-divider" aria-hidden="true" />

        <ToolButton
          icon={IconRefresh}
          title={REBUILD_TITLE}
          disabled={disabled || props.rebuilding}
          badge={props.pendingRebuild}
          onClick={props.onRebuild}
        />
        <button
          type="button"
          className="fab-btn fab-auto"
          data-active={props.autoRebuild ? "true" : undefined}
          disabled={disabled}
          title={AUTO_TITLE}
          aria-pressed={props.autoRebuild}
          onClick={props.onToggleAutoRebuild}
        >
          A
        </button>
      </div>

      {/* — Ansichten rechts oben — */}
      <div className="viewer-presets" role="toolbar" aria-label="Ansichten">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="preset-btn"
            disabled={disabled}
            onClick={() => props.onPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* — Schnitt-Details, nur bei aktivem Werkzeug — */}
      {tool === "slice" && (
        <div className="viewer-slicebar" role="toolbar" aria-label="Schnittebene">
          <select
            className="input"
            disabled={disabled}
            value={section.axis}
            onChange={(event) =>
              props.onSection({
                axis: event.target.value as SectionState["axis"],
              })
            }
          >
            {SECTION_AXES.map((axis) => (
              <option key={axis.id} value={axis.id}>
                Achse {axis.label}
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
            data-active={section.flipped}
            disabled={disabled}
            title="Schnittrichtung umkehren"
            onClick={() => props.onSection({ flipped: !section.flipped })}
          >
            Flip
          </button>
          <button
            className="btn"
            data-active={section.enabled}
            disabled={disabled}
            onClick={() => props.onSection({ enabled: !section.enabled })}
          >
            {section.enabled ? "An" : "Aus"}
          </button>
        </div>
      )}
    </>
  );
}
