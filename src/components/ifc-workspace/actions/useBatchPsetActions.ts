import {
  addNativeEmptyPropertySet,
  addNativePropertySetValues,
  addNativePropertyToSet,
  catalogObjectLabel,
  updateNativePropertyValue,
  type CatalogObjectType,
  type NativeIfcDocument,
} from "@/ifc";

import { readSimplePropertyValueText } from "../lib/entities";
import type { WorkspaceEditContext } from "./context";

function findEntityPsetByName(
  sourceDocument: NativeIfcDocument,
  entityId: number,
  psetName: string,
) {
  const token = psetName.trim().toLowerCase();
  return (sourceDocument.propertySetsByEntity.get(entityId) ?? []).find(
    (set) => set.name.trim().toLowerCase() === token,
  );
}

/**
 * Batch-Bearbeitung von Property-Sets über die Mehrfachauswahl: Psets,
 * Katalog-Klassen und einzelne Properties auf allen ausgewählten Objekten
 * anlegen bzw. typisieren.
 */
export function useBatchPsetActions(
  context: WorkspaceEditContext & {
    activeCatalogObject: CatalogObjectType | undefined;
    batchSelectionIds: number[];
  },
) {
  const {
    activeCatalogObject,
    batchSelectionIds,
    commitDocument,
    document,
    logAction,
    selectedId,
  } = context;

  const addPsetToSelection = (psetName: string) => {
    const name = psetName.trim();
    if (!name || batchSelectionIds.length === 0) {
      return;
    }
    let next = document;
    let added = 0;
    for (const id of batchSelectionIds) {
      if (findEntityPsetByName(next, id, name)) {
        continue;
      }
      next = addNativeEmptyPropertySet(next, id, name);
      added += 1;
    }
    if (next === document) {
      logAction(
        `psetBatch.addPset.skip({ name: ${JSON.stringify(name)}, reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Add Pset '${name}' to ${added.toLocaleString()} objects`,
      `psetBatch.addPset({ name: ${JSON.stringify(name)}, added: ${added}, selected: ${batchSelectionIds.length} });`,
    );
  };

  // Add the catalog class currently selected in the Objektkatalog window to the
  // batch selection: one pset per Merkmalsgruppe (with its catalog properties)
  // on each selected object.
  const addCatalogObjectToSelection = () => {
    if (!activeCatalogObject || batchSelectionIds.length === 0) {
      return;
    }
    const groups = new Map<
      string,
      {
        name: string;
        properties: Map<string, { name: string; valueType: string }>;
      }
    >();
    for (const rule of activeCatalogObject.propertyRules) {
      const key = rule.psetName.trim().toLowerCase();
      if (!key) {
        continue;
      }
      let group = groups.get(key);
      if (!group) {
        group = { name: rule.psetName, properties: new Map() };
        groups.set(key, group);
      }
      if (!group.properties.has(rule.propertyName)) {
        group.properties.set(rule.propertyName, {
          name: rule.propertyName,
          valueType: rule.valueType,
        });
      }
    }
    if (groups.size === 0) {
      return;
    }
    let next = document;
    let addedPsets = 0;
    for (const id of batchSelectionIds) {
      for (const group of groups.values()) {
        if (findEntityPsetByName(next, id, group.name)) {
          continue;
        }
        next = addNativePropertySetValues(
          next,
          id,
          group.name,
          [...group.properties.values()].map((property) => ({
            name: property.name,
            value: "",
            valueType: property.valueType,
          })),
        );
        addedPsets += 1;
      }
    }
    if (next === document) {
      logAction(
        `psetBatch.addCatalogObject.skip({ object: '${activeCatalogObject.id}', reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Add catalog class '${catalogObjectLabel(activeCatalogObject)}' (${groups.size.toLocaleString()} psets) to ${batchSelectionIds.length.toLocaleString()} objects`,
      `psetBatch.addCatalogObject({ object: '${activeCatalogObject.id}', psets: ${groups.size}, addedPsets: ${addedPsets} });`,
    );
  };

  // Neue Property auf allen ausgewählten Objekten anlegen; fehlt das Pset auf
  // einem Objekt, wird es dort mitsamt der Property erzeugt (Coverage-Ziel).
  const addPropertyToSelection = (
    psetName: string,
    propertyName: string,
    valueType: string,
    value: string,
  ) => {
    const name = propertyName.trim();
    if (!name || batchSelectionIds.length === 0) {
      return;
    }
    let next = document;
    let added = 0;
    for (const id of batchSelectionIds) {
      const set = findEntityPsetByName(next, id, psetName);
      if (set) {
        const exists = set.values.some(
          (item) => item.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (exists) {
          continue;
        }
        next = addNativePropertyToSet(next, set.id, name, value, valueType);
      } else {
        next = addNativePropertySetValues(next, id, psetName, [
          { name, value, valueType },
        ]);
      }
      added += 1;
    }
    if (next === document) {
      logAction(
        `psetBatch.addProperty.skip({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(name)}, reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Add property '${name}' to ${added.toLocaleString()} objects`,
      `psetBatch.addProperty({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(name)}, type: '${valueType}', objects: ${added} });`,
    );
  };

  // Datentyp einer Property zentral für alle ausgewählten Objekte setzen.
  // updateNativePropertyValue wendet valueType nur zusammen mit einem Wert an,
  // daher wird der aktuelle Wert mitgereicht (und dabei neu typisiert).
  const setPropertyTypeForSelection = (
    psetName: string,
    propertyName: string,
    valueType: string,
  ) => {
    if (batchSelectionIds.length === 0) {
      return;
    }
    const token = propertyName.trim().toLowerCase();
    let next = document;
    let changed = 0;
    for (const id of batchSelectionIds) {
      const set = findEntityPsetByName(next, id, psetName);
      const property = set?.values.find(
        (item) => item.name.trim().toLowerCase() === token,
      );
      if (!property) {
        continue;
      }
      const updated = updateNativePropertyValue(next, property.id, {
        value: readSimplePropertyValueText(next.entityById.get(property.id)),
        valueType,
      });
      if (updated !== next) {
        next = updated;
        changed += 1;
      }
    }
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Set type '${valueType}' for '${propertyName}' on ${changed.toLocaleString()} objects`,
      `psetBatch.setPropertyType({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(propertyName)}, type: '${valueType}', objects: ${changed} });`,
    );
  };

  const editPsetCellValue = (
    entityId: number,
    setId: number,
    propertyId: number | undefined,
    propertyName: string,
    value: string,
  ) => {
    const next =
      propertyId != null
        ? updateNativePropertyValue(document, propertyId, { value })
        : addNativePropertyToSet(document, setId, propertyName, value);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Edit ${propertyName} on #${entityId}`,
      `psetBatch.editValue({ id: ${entityId}, set: ${setId}, property: ${JSON.stringify(propertyName)} });`,
    );
  };

  return {
    addCatalogObjectToSelection,
    addPropertyToSelection,
    addPsetToSelection,
    editPsetCellValue,
    setPropertyTypeForSelection,
  };
}
