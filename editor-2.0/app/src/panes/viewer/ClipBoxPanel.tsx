/**
 * Clip-Box-Panel (M9): kompaktes Overlay-Panel mit sechs Flächen-Reglern
 * (min/max je IFC-Achse, Meter) für die aktive Clip-Box. Liegt als absolut
 * positioniertes Element über dem Canvas (rechts oben), Zustand kommt aus
 * dem sectionStore; der Regler-Bereich ist der Modellumfang + 10 % Rand.
 */
import { useSectionStore } from "./sectionStore";
import type { AxisBox, BoxAxis } from "./sliceMath";
import { formatMeter } from "./worldCoords";

const AXES: ReadonlyArray<{ id: BoxAxis; label: string }> = [
  { id: "x", label: "X" },
  { id: "y", label: "Y" },
  { id: "z", label: "Z" },
];

const PANEL_STYLE = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 240,
  padding: "8px 10px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: "0.8125rem",
} as const;

const ROW_STYLE = {
  display: "grid",
  gridTemplateColumns: "14px 1fr 62px",
  alignItems: "center",
  gap: 6,
} as const;

export default function ClipBoxPanel({
  boxIfc,
  rangeIfc,
  onReset,
}: {
  /** Aktive Box (IFC-Meter). */
  boxIfc: AxisBox;
  /** Reglerbereich (Modell-Bounds + Rand, IFC-Meter). */
  rangeIfc: AxisBox;
  /** „Zurücksetzen": Box wieder auf den vollen Modellumfang. */
  onReset(): void;
}) {
  const patchBox = useSectionStore((s) => s.patchBox);
  const setBox = useSectionStore((s) => s.setBox);

  return (
    <div style={PANEL_STYLE} role="group" aria-label="Clip-Box">
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong style={{ flex: 1 }}>Clip-Box</strong>
        <button className="btn" onClick={onReset} title="Box auf den gesamten Modellumfang zurücksetzen">
          Zurücksetzen
        </button>
        <button className="btn" onClick={() => setBox(null)} title="Clip-Box ausschalten">
          Aus
        </button>
      </div>
      {AXES.map((axis) => (
        <div key={axis.id}>
          <SideSlider axis={axis} side="min" value={boxIfc.min[axis.id]} range={rangeIfc} onChange={patchBox} />
          <SideSlider axis={axis} side="max" value={boxIfc.max[axis.id]} range={rangeIfc} onChange={patchBox} />
        </div>
      ))}
      <span className="text-dim" style={{ fontSize: "0.6875rem" }}>
        Sechs Flächen: min/max je Achse in Metern (IFC-Koordinaten).
      </span>
    </div>
  );
}

function SideSlider({
  axis,
  side,
  value,
  range,
  onChange,
}: {
  axis: { id: BoxAxis; label: string };
  side: "min" | "max";
  value: number;
  range: AxisBox;
  onChange(axis: BoxAxis, side: "min" | "max", value: number): void;
}) {
  const lo = range.min[axis.id];
  const hi = range.max[axis.id];
  return (
    <div style={ROW_STYLE}>
      <span className="text-dim">{side === "min" ? axis.label : ""}</span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={0.01}
        value={value}
        aria-label={`Clip-Box ${axis.label} ${side === "min" ? "Minimum" : "Maximum"}`}
        onChange={(event) => onChange(axis.id, side, Number(event.target.value))}
      />
      <span className="text-dim" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {formatMeter(value)} m
      </span>
    </div>
  );
}
