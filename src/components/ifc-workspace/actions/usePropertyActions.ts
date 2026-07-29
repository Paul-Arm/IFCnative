import {
  addNativeEmptyPropertySet,
  addNativePropertyToSet,
  addNativeQuantitySet,
  addNativeSiUnit,
  duplicateNativePropertySet,
  removeNativePropertyFromSet,
  removeNativePropertySet,
  updateNativePropertySetName,
  updateNativePropertyValue,
} from "@/ifc";

import type { WorkspaceEditContext } from "./context";

/** Property-Sets, Properties, Quantities und Einheiten des aktiven Objekts. */
export function usePropertyActions(context: WorkspaceEditContext) {
  const { commitDocument, document, selectedId } = context;

  const addEmptyPset = (psetName: string) => {
    const next = addNativeEmptyPropertySet(document, selectedId, psetName);
    commitDocument(
      next,
      selectedId,
      `Add empty Pset '${psetName}' to #${selectedId}`,
      `addEmptyPset({ objectId: ${selectedId}, name: '${psetName}' });`,
    );
  };

  const addPropertyToSet = (
    setId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType = "IFCLABEL",
  ) => {
    const next = addNativePropertyToSet(
      document,
      setId,
      propertyName,
      propertyValue,
      propertyValueType,
    );
    commitDocument(
      next,
      selectedId,
      `Add property '${propertyName}' to #${setId}`,
      `addPropertyToSet({ setId: ${setId}, name: '${propertyName}', type: '${propertyValueType}' });`,
    );
  };

  const addQuantity = (
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType = "IFCQUANTITYLENGTH",
  ) => {
    const next = addNativeQuantitySet(
      document,
      selectedId,
      qtoName,
      quantityName,
      quantityValue,
      quantityType,
    );
    commitDocument(
      next,
      selectedId,
      `Add quantity '${quantityName}' to #${selectedId}`,
      `addQuantity({ objectId: ${selectedId}, name: '${quantityName}', type: '${quantityType}' });`,
    );
  };

  const addUnit = (unitType: string, unitName: string) => {
    const next = addNativeSiUnit(document, unitType, "$", unitName);
    commitDocument(
      next,
      selectedId,
      `Add unit ${unitType} ${unitName}`,
      `addUnit({ unitType: '${unitType}', name: '${unitName}' });`,
    );
  };

  const updatePsetProperty = (
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ) => {
    const next = updateNativePropertyValue(document, propertyId, {
      name: propertyName,
      value: propertyValue,
      valueType: propertyValueType,
    });
    commitDocument(
      next,
      selectedId,
      `Update property #${propertyId} '${propertyName}'`,
      `updateProperty({ id: ${propertyId}, name: '${propertyName}' });`,
    );
  };

  const deletePsetProperty = (setId: number, propertyId: number) => {
    const next = removeNativePropertyFromSet(document, setId, propertyId);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Delete property #${propertyId} from #${setId}`,
      `deleteProperty({ setId: ${setId}, id: ${propertyId} });`,
    );
  };

  const renamePset = (setId: number, name: string) => {
    const next = updateNativePropertySetName(document, setId, name);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Rename Pset #${setId} to '${name}'`,
      `renamePset({ setId: ${setId}, name: ${JSON.stringify(name)} });`,
    );
  };

  const duplicatePset = (setId: number) => {
    const set = document.propertySetsByEntity
      .get(selectedId)
      ?.find((item) => item.id === setId);
    const next = duplicateNativePropertySet(
      document,
      selectedId,
      setId,
      `${set?.name || `#${setId}`} Copy`,
    );
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Duplicate ${set?.kind ?? "Pset"} #${setId}${set ? ` '${set.name}'` : ""}`,
      `duplicatePset({ objectId: ${selectedId}, setId: ${setId} });`,
    );
  };

  const deletePset = (setId: number) => {
    const set = document.propertySetsByEntity
      .get(selectedId)
      ?.find((item) => item.id === setId);
    const next = removeNativePropertySet(document, selectedId, setId);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Delete ${set?.kind ?? "Pset"} #${setId}${set ? ` '${set.name}'` : ""}`,
      `deletePset({ objectId: ${selectedId}, setId: ${setId} });`,
    );
  };

  return {
    addEmptyPset,
    addPropertyToSet,
    addQuantity,
    addUnit,
    deletePset,
    deletePsetProperty,
    duplicatePset,
    renamePset,
    updatePsetProperty,
  };
}
