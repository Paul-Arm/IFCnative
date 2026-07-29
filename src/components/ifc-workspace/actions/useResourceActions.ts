import {
  addNativeApproval,
  addNativeClassification,
  addNativeConstraintObjective,
  addNativeDocumentReference,
  addNativeGroupAssignment,
  addNativeLibraryReference,
  addNativeMaterial,
  addNativeMaterialConstituentSet,
  addNativeMaterialLayerSet,
  addNativeMaterialLayerSetUsage,
  addNativeMaterialProfileSet,
  addNativeMaterialProfileSetUsage,
  addNativeMaterialStyle,
  addNativeMaterialWithProperties,
  addNativeTypeAssignment,
  removeNativeRelationship,
  updateNativeEntity,
} from "@/ifc";

import type { WorkspaceEditContext } from "./context";

/**
 * Ressourcen-Zuweisungen des aktiven Objekts: Materialien (inkl. Layer-,
 * Profil- und Constituent-Sets), Gruppen, Klassifikationen, Dokument-/
 * Bibliotheks-Referenzen, Freigaben, Constraints und Typen.
 */
export function useResourceActions(context: WorkspaceEditContext) {
  const { commitDocument, document, selectedId } = context;

  const addMaterial = (materialName: string, materialCategory: string) => {
    const next = addNativeMaterial(
      document,
      selectedId,
      materialName,
      materialCategory,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material '${materialName}' to #${selectedId}`,
      `addMaterial({ objectId: ${selectedId}, name: '${materialName}' });`,
    );
  };

  const addMaterialWithProperties = (
    materialName: string,
    materialCategory: string,
    propertySetName: string,
    propertyRows: string,
  ) => {
    const next = addNativeMaterialWithProperties(
      document,
      selectedId,
      materialName,
      materialCategory,
      propertySetName,
      propertyRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material '${materialName}' with properties to #${selectedId}`,
      `addMaterialWithProperties({ objectId: ${selectedId}, name: ${JSON.stringify(materialName)} });`,
    );
  };

  const addMaterialStyle = (
    materialName: string,
    materialCategory: string,
    styleName: string,
    color: string,
    transparency: string,
  ) => {
    const next = addNativeMaterialStyle(
      document,
      selectedId,
      materialName,
      materialCategory,
      styleName,
      color,
      transparency,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material style '${styleName}' to #${selectedId}`,
      `addMaterialStyle({ objectId: ${selectedId}, material: ${JSON.stringify(materialName)}, color: ${JSON.stringify(color)} });`,
    );
  };

  const addMaterialLayerSet = (setName: string, layerRows: string) => {
    const next = addNativeMaterialLayerSet(
      document,
      selectedId,
      setName,
      layerRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material layer set '${setName}' to #${selectedId}`,
      `addMaterialLayerSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialLayerSetUsage = (
    setName: string,
    layerRows: string,
    direction: string,
    directionSense: string,
    offset: string,
    referenceExtent: string,
  ) => {
    const next = addNativeMaterialLayerSetUsage(
      document,
      selectedId,
      setName,
      layerRows,
      direction,
      directionSense,
      offset,
      referenceExtent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material layer set usage '${setName}' to #${selectedId}`,
      `addMaterialLayerSetUsage({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialProfileSet = (
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
  ) => {
    const next = addNativeMaterialProfileSet(
      document,
      selectedId,
      setName,
      profileName,
      materialName,
      category,
      width,
      depth,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material profile set '${setName}' to #${selectedId}`,
      `addMaterialProfileSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialProfileSetUsage = (
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
    cardinalPoint: string,
    referenceExtent: string,
  ) => {
    const next = addNativeMaterialProfileSetUsage(
      document,
      selectedId,
      setName,
      profileName,
      materialName,
      category,
      width,
      depth,
      cardinalPoint,
      referenceExtent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material profile set usage '${setName}' to #${selectedId}`,
      `addMaterialProfileSetUsage({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialConstituentSet = (
    setName: string,
    constituentRows: string,
  ) => {
    const next = addNativeMaterialConstituentSet(
      document,
      selectedId,
      setName,
      constituentRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material constituent set '${setName}' to #${selectedId}`,
      `addMaterialConstituentSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addGroupAssignment = (
    groupType: string,
    groupName: string,
    objectType: string,
    longName: string,
  ) => {
    const next = addNativeGroupAssignment(
      document,
      selectedId,
      groupType,
      groupName,
      objectType,
      longName,
    );
    commitDocument(
      next,
      selectedId,
      `Assign ${groupType} '${groupName}' to #${selectedId}`,
      `addGroupAssignment({ objectId: ${selectedId}, type: ${JSON.stringify(groupType)}, name: ${JSON.stringify(groupName)} });`,
    );
  };

  const addClassification = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeClassification(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign classification '${identification}' to #${selectedId}`,
      `addClassification({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const addDocumentReference = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeDocumentReference(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign document '${identification}' to #${selectedId}`,
      `addDocumentReference({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const addLibraryReference = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeLibraryReference(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign library '${identification}' to #${selectedId}`,
      `addLibraryReference({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const addApproval = (identifier: string, name: string, status: string) => {
    const next = addNativeApproval(
      document,
      selectedId,
      identifier,
      name,
      status,
    );
    commitDocument(
      next,
      selectedId,
      `Assign approval '${identifier || name}' to #${selectedId}`,
      `addApproval({ objectId: ${selectedId}, id: '${identifier}' });`,
    );
  };

  const addConstraint = (
    name: string,
    grade: string,
    source: string,
    qualifier: string,
    intent: string,
  ) => {
    const next = addNativeConstraintObjective(
      document,
      selectedId,
      name,
      grade,
      source,
      qualifier,
      intent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign constraint '${name}' to #${selectedId}`,
      `addConstraint({ objectId: ${selectedId}, name: ${JSON.stringify(name)} });`,
    );
  };

  const assignType = (typeName: string, typeClass: string, tag: string) => {
    const next = addNativeTypeAssignment(
      document,
      selectedId,
      typeName,
      typeClass,
      tag,
    );
    commitDocument(
      next,
      selectedId,
      `Assign type '${typeName}' to #${selectedId}`,
      `assignType({ objectId: ${selectedId}, class: '${typeClass}', name: '${typeName}' });`,
    );
  };

  const updateResourceEntityArgs = (
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ) => {
    if (updates.length === 0) {
      return;
    }
    const next = updates.reduce(
      (current, update) =>
        updateNativeEntity(current, update.entityId, { args: update.args }),
      document,
    );
    commitDocument(
      next,
      selectedId,
      label,
      `updateResourceEntities({ ids: [${updates.map((update) => update.entityId).join(", ")}] });`,
    );
  };

  const removeResourceAssociation = (relationshipId: number) => {
    const relationship = document.entityById.get(relationshipId);
    const next = removeNativeRelationship(document, relationshipId);
    commitDocument(
      next,
      selectedId,
      `Remove ${relationship?.type ?? "resource association"} #${relationshipId}`,
      `removeResourceAssociation({ id: ${relationshipId} });`,
    );
  };

  return {
    addApproval,
    addClassification,
    addConstraint,
    addDocumentReference,
    addGroupAssignment,
    addLibraryReference,
    addMaterial,
    addMaterialConstituentSet,
    addMaterialLayerSet,
    addMaterialLayerSetUsage,
    addMaterialProfileSet,
    addMaterialProfileSetUsage,
    addMaterialStyle,
    addMaterialWithProperties,
    assignType,
    removeResourceAssociation,
    updateResourceEntityArgs,
  };
}
