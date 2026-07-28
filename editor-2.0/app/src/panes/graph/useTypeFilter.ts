/**
 * Zustand des Beziehungsarten-Filters: Preset plus manuelle Feinauswahl.
 * Solange nichts manuell gewählt wurde, gilt die Menge des Presets.
 */
import { useCallback, useMemo, useState } from "react";
import type { RelationshipType } from "@ifc-lite/data";
import type { IfcDataStore } from "@ifc-lite/parser";
import {
  orderedTypes,
  relationTypesInModel,
  typesOfPreset,
  type PresetId,
} from "./presets";

const NO_TYPES: ReadonlySet<RelationshipType> = new Set<RelationshipType>();

export interface TypeFilter {
  presetId: PresetId;
  /** Im Modell vorkommende Arten in Anzeigereihenfolge */
  availableTypes: RelationshipType[];
  /** Aktuell wirksame Arten */
  activeTypes: ReadonlySet<RelationshipType>;
  setPreset(id: PresetId): void;
  toggleType(type: RelationshipType): void;
  selectAll(): void;
  selectNone(): void;
}

export function useTypeFilter(store: IfcDataStore | null): TypeFilter {
  const [presetId, setPresetId] = useState<PresetId>("overview");
  const [chosen, setChosen] = useState<ReadonlySet<RelationshipType> | null>(
    null,
  );

  const available = useMemo(
    () => (store ? relationTypesInModel(store) : NO_TYPES),
    [store],
  );
  const availableTypes = useMemo(() => orderedTypes(available), [available]);
  const activeTypes = useMemo<ReadonlySet<RelationshipType>>(
    () => chosen ?? typesOfPreset(presetId, available),
    [chosen, presetId, available],
  );

  const setPreset = useCallback(
    (id: PresetId) => {
      setPresetId(id);
      setChosen(typesOfPreset(id, available));
    },
    [available],
  );

  const toggleType = useCallback(
    (type: RelationshipType) => {
      setChosen((current) => {
        const next = new Set(current ?? typesOfPreset(presetId, available));
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      });
      setPresetId("custom");
    },
    [presetId, available],
  );

  const selectAll = useCallback(() => {
    setPresetId("overview");
    setChosen(new Set(available));
  }, [available]);

  const selectNone = useCallback(() => {
    setPresetId("custom");
    setChosen(new Set<RelationshipType>());
  }, []);

  return {
    presetId,
    availableTypes,
    activeTypes,
    setPreset,
    toggleType,
    selectAll,
    selectNone,
  };
}
