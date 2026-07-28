/**
 * Presets und Farbgebung der Beziehungsarten für das Graph-Pane.
 * Ein Preset legt fest, welche RelationshipTypes beim Traversieren
 * berücksichtigt werden; `types === null` bedeutet „alle".
 */
import { RelationshipType } from "@ifc-lite/data";
import type { IfcDataStore } from "@ifc-lite/parser";
import { RELATION_LABELS } from "../../core/model/relations";

/** Alle vom Parser gelieferten Beziehungsarten, in Anzeigereihenfolge. */
export const ALL_RELATION_TYPES: readonly RelationshipType[] = [
  RelationshipType.ContainsElements,
  RelationshipType.Aggregates,
  RelationshipType.ReferencedInSpatialStructure,
  RelationshipType.DefinesByProperties,
  RelationshipType.DefinesByType,
  RelationshipType.AssociatesMaterial,
  RelationshipType.AssociatesClassification,
  RelationshipType.AssociatesDocument,
  RelationshipType.AssignsToGroup,
  RelationshipType.AssignsToProduct,
  RelationshipType.VoidsElement,
  RelationshipType.FillsElement,
  RelationshipType.ConnectsElements,
  RelationshipType.ConnectsPathElements,
  RelationshipType.SpaceBoundary,
];

export type PresetId =
  | "overview"
  | "spatial"
  | "properties"
  | "resources"
  | "geometry"
  | "custom";

export interface GraphPreset {
  id: PresetId;
  label: string;
  /** null = keine Einschränkung */
  types: readonly RelationshipType[] | null;
}

export const PRESETS: readonly GraphPreset[] = [
  { id: "overview", label: "Übersicht", types: null },
  {
    id: "spatial",
    label: "Räumlich",
    types: [
      RelationshipType.ContainsElements,
      RelationshipType.Aggregates,
      RelationshipType.ReferencedInSpatialStructure,
    ],
  },
  {
    id: "properties",
    label: "Eigenschaften",
    types: [
      RelationshipType.DefinesByProperties,
      RelationshipType.DefinesByType,
    ],
  },
  {
    id: "resources",
    label: "Ressourcen",
    types: [
      RelationshipType.AssociatesMaterial,
      RelationshipType.AssociatesClassification,
      RelationshipType.AssociatesDocument,
      RelationshipType.AssignsToGroup,
    ],
  },
  {
    id: "geometry",
    label: "Geometrie/Topologie",
    types: [
      RelationshipType.VoidsElement,
      RelationshipType.FillsElement,
      RelationshipType.ConnectsElements,
      RelationshipType.ConnectsPathElements,
      RelationshipType.SpaceBoundary,
    ],
  },
  { id: "custom", label: "Benutzerdefiniert", types: null },
];

export function presetById(id: PresetId): GraphPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Aktive Beziehungsarten eines Presets, auf die im Modell vorhandenen
 * beschränkt. „Übersicht" liefert alle vorhandenen.
 */
export function typesOfPreset(
  id: PresetId,
  available: ReadonlySet<RelationshipType>,
): Set<RelationshipType> {
  const preset = presetById(id);
  const source = preset.types ?? ALL_RELATION_TYPES;
  const active = new Set<RelationshipType>();
  for (const type of source) if (available.has(type)) active.add(type);
  return active;
}

export function relationLabel(type: RelationshipType): string {
  return RELATION_LABELS[type] ?? `Beziehung ${type}`;
}

/** Farbe je Beziehungskategorie — in hellem und dunklem Theme lesbar. */
const RELATION_COLORS: Record<number, string> = {
  [RelationshipType.ContainsElements]: "#4c8ff0",
  [RelationshipType.Aggregates]: "#4c8ff0",
  [RelationshipType.ReferencedInSpatialStructure]: "#4c8ff0",
  [RelationshipType.DefinesByProperties]: "#2aa198",
  [RelationshipType.DefinesByType]: "#2aa198",
  [RelationshipType.AssociatesMaterial]: "#d98324",
  [RelationshipType.AssociatesClassification]: "#d98324",
  [RelationshipType.AssociatesDocument]: "#d98324",
  [RelationshipType.AssignsToGroup]: "#d98324",
  [RelationshipType.AssignsToProduct]: "#d98324",
  [RelationshipType.VoidsElement]: "#a56cd8",
  [RelationshipType.FillsElement]: "#a56cd8",
  [RelationshipType.ConnectsElements]: "#a56cd8",
  [RelationshipType.ConnectsPathElements]: "#a56cd8",
  [RelationshipType.SpaceBoundary]: "#a56cd8",
};

export function relationColor(type: RelationshipType): string {
  return RELATION_COLORS[type] ?? "#8b8b96";
}

/** Nur die CSR-Spalte, die für die Typ-Erhebung gebraucht wird. */
interface EdgeTypeColumn {
  edgeTypes?: ArrayLike<number>;
}

const MODEL_TYPES = new WeakMap<object, ReadonlySet<RelationshipType>>();

/**
 * Beziehungsarten, die im Modell tatsächlich vorkommen — einmal pro Store
 * über die CSR-Typspalte erhoben und gecacht. Ohne Spalte (ältere Stores)
 * werden alle bekannten Arten angeboten.
 */
export function relationTypesInModel(
  store: IfcDataStore,
): ReadonlySet<RelationshipType> {
  const key = store as unknown as object;
  const cached = MODEL_TYPES.get(key);
  if (cached) return cached;

  const known = new Set<number>(ALL_RELATION_TYPES);
  const found = new Set<RelationshipType>();
  const graph = store.relationships as unknown as {
    forward?: EdgeTypeColumn;
    inverse?: EdgeTypeColumn;
  };
  for (const half of [graph.forward, graph.inverse]) {
    const column = half?.edgeTypes;
    if (!column) continue;
    for (let i = 0; i < column.length; i++) {
      const value = column[i];
      if (known.has(value)) found.add(value as RelationshipType);
    }
  }
  const result: ReadonlySet<RelationshipType> =
    found.size > 0 ? found : new Set(ALL_RELATION_TYPES);
  MODEL_TYPES.set(key, result);
  return result;
}

/** Vorhandene Arten in stabiler Anzeigereihenfolge. */
export function orderedTypes(
  available: ReadonlySet<RelationshipType>,
): RelationshipType[] {
  return ALL_RELATION_TYPES.filter((type) => available.has(type));
}
