/**
 * Toolbar des Graph-Panes: Preset, Tiefe, Feinfilter der Beziehungsarten,
 * Suche und Anker-Steuerung.
 */
import { useEffect, useRef, useState } from "react";
import type { RelationshipType } from "@ifc-lite/data";
import {
  PRESETS,
  relationColor,
  relationLabel,
  type PresetId,
} from "./presets";

export interface GraphToolbarProps {
  presetId: PresetId;
  onPreset(id: PresetId): void;
  depth: number;
  onDepth(depth: number): void;
  /** Im Modell vorkommende Beziehungsarten, in Anzeigereihenfolge */
  availableTypes: readonly RelationshipType[];
  activeTypes: ReadonlySet<RelationshipType>;
  onToggleType(type: RelationshipType): void;
  onAllTypes(): void;
  onNoTypes(): void;
  search: string;
  onSearch(value: string): void;
  onAnchorFromSelection(): void;
  canAnchor: boolean;
  onResetLayout(): void;
  canResetLayout: boolean;
  /** Ausgewählte Kante löschen (M2) */
  onDeleteRelation(): void;
  canDeleteRelation: boolean;
  /** Ausgewähltes Objekt mit Kaskadenplan löschen (M2) */
  onDeleteEntity(): void;
  canDeleteEntity: boolean;
  status: string;
}

const DEPTHS = [1, 2, 3, 4, 5] as const;

export default function GraphToolbar(props: GraphToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent): void {
      const node = event.target as globalThis.Node | null;
      if (node && !filterRef.current?.contains(node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  return (
    <div className="pane-toolbar">
      <select
        className="input"
        value={props.presetId}
        title="Preset der Beziehungsarten"
        onChange={(e) => props.onPreset(e.target.value as PresetId)}
      >
        {PRESETS.filter(
          (preset) => preset.id !== "custom" || props.presetId === "custom",
        ).map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>

      <label className="text-dim" htmlFor="graph-depth">
        Tiefe
      </label>
      <select
        id="graph-depth"
        className="input"
        value={props.depth}
        onChange={(e) => props.onDepth(Number(e.target.value))}
      >
        {DEPTHS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <div className="graph-filter" ref={filterRef}>
        <button
          className="btn"
          data-active={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          disabled={props.availableTypes.length === 0}
        >
          Beziehungsarten ({props.activeTypes.size}/
          {props.availableTypes.length}) ▾
        </button>
        {menuOpen && (
          <div className="graph-filter-menu">
            {props.availableTypes.map((type) => (
              <label className="graph-filter-item" key={type}>
                <input
                  type="checkbox"
                  checked={props.activeTypes.has(type)}
                  onChange={() => props.onToggleType(type)}
                />
                <span
                  className="graph-filter-dot"
                  style={{ background: relationColor(type) }}
                />
                {relationLabel(type)}
              </label>
            ))}
            <div className="graph-filter-actions">
              <button className="btn" onClick={props.onAllTypes}>
                Alle
              </button>
              <button className="btn" onClick={props.onNoTypes}>
                Keine
              </button>
            </div>
          </div>
        )}
      </div>

      <input
        className="input"
        type="search"
        placeholder="Knoten suchen …"
        value={props.search}
        onChange={(e) => props.onSearch(e.target.value)}
        style={{ width: 150 }}
      />

      <button
        className="btn"
        onClick={props.onAnchorFromSelection}
        disabled={!props.canAnchor}
        title="Graph auf das zuletzt ausgewählte Objekt neu aufbauen"
      >
        Auswahl als Anker
      </button>

      <button
        className="btn"
        onClick={props.onResetLayout}
        disabled={!props.canResetLayout}
        title="Manuell verschobene Knoten zurücksetzen"
      >
        Layout zurücksetzen
      </button>

      <button
        className="btn"
        onClick={props.onDeleteRelation}
        disabled={!props.canDeleteRelation}
        title="Ausgewählte Beziehung entfernen (Entf)"
      >
        Beziehung löschen
      </button>

      <button
        className="btn"
        onClick={props.onDeleteEntity}
        disabled={!props.canDeleteEntity}
        title="Ausgewähltes Objekt mit Kaskadenplan löschen (Entf)"
      >
        Objekt löschen …
      </button>

      <span className="text-dim" style={{ marginLeft: "auto" }}>
        {props.status}
      </span>
    </div>
  );
}
