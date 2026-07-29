import {
  type CatalogValidationFinding,
  type IfcObjectCatalog,
  type NativeIfcDocument,
  type ObjectInfoIndex,
  type ObjectInfoValidationFinding,
} from "@/ifc";

import type { BodyElementDraft, EntityEditDraft, InspectorMode } from "../types";
import { DocumentOverview, OverviewPanel } from "./overview";
import { PlacementGeometryPanel } from "./placement";
import { PsetPanel } from "./pset-panel";
import { RelationsResourcesPanel } from "./relations";

export const INSPECTOR_MODES: { value: InspectorMode; label: string }[] = [
  { value: "overview", label: "Übersicht" },
  { value: "properties", label: "Eigenschaften" },
  { value: "placement", label: "Platzierung" },
  { value: "relations", label: "Beziehungen" },
];

export function InspectorPanel({
  activeCatalogObjectId,
  catalog,
  catalogFindings,
  document,
  mode,
  objectInfoFindings,
  objectInfoIndex,
  selectedId,
  onAddGroupAssignment,
  onAddMaterial,
  onAddMaterialConstituentSet,
  onAddMaterialLayerSet,
  onAddMaterialLayerSetUsage,
  onAddMaterialProfileSet,
  onAddMaterialProfileSetUsage,
  onAddMaterialStyle,
  onAddMaterialWithProperties,
  onAssignBodyToSelected,
  onAssignType,
  onAddEmptyPset,
  onAddPropertyToSet,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
  onApplyCatalogFindings,
  onDuplicatePropertySet,
  onMovePlacement,
  onRemoveRelationship,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onSaveEdit,
  onSelectEntity,
  onUpdateProperty,
  onUpdateRelationship,
}: {
  activeCatalogObjectId: string;
  catalog: IfcObjectCatalog | null;
  catalogFindings: CatalogValidationFinding[];
  document: NativeIfcDocument;
  mode: InspectorMode;
  objectInfoFindings: ObjectInfoValidationFinding[];
  objectInfoIndex: ObjectInfoIndex;
  selectedId: number;
  onAddGroupAssignment(
    groupType: string,
    groupName: string,
    objectType: string,
    longName: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAddMaterialWithProperties(
    materialName: string,
    materialCategory: string,
    propertySetName: string,
    propertyRows: string,
  ): void;
  onAddMaterialStyle(
    materialName: string,
    materialCategory: string,
    styleName: string,
    color: string,
    transparency: string,
  ): void;
  onAddMaterialConstituentSet(setName: string, constituentRows: string): void;
  onAddMaterialLayerSet(setName: string, layerRows: string): void;
  onAddMaterialLayerSetUsage(
    setName: string,
    layerRows: string,
    direction: string,
    directionSense: string,
    offset: string,
    referenceExtent: string,
  ): void;
  onAddMaterialProfileSet(
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
  ): void;
  onAddMaterialProfileSetUsage(
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
    cardinalPoint: string,
    referenceExtent: string,
  ): void;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddEmptyPset(psetName: string): void;
  onAddPropertyToSet(
    setId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType?: string,
  ): void;
  onAddQuantity(
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType?: string,
  ): void;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onAddUnit(unitType: string, unitName: string): void;
  onApplyCatalogFindings(findings: CatalogValidationFinding[]): void;
  onDuplicatePropertySet(setId: number): void;
  onMovePlacement(x: string, y: string, z: string): void;
  onRemoveRelationship(relationshipId: number): void;
  onRemovePropertyFromSet(setId: number, propertyId: number): void;
  onRemovePropertySet(setId: number): void;
  onRenamePropertySet(setId: number, name: string): void;
  onSaveEdit(draft: EntityEditDraft): void;
  onSelectEntity(entityId: number): void;
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
  onUpdateRelationship(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const entity = document.entityById.get(selectedId);
  if (!entity) {
    return (
      <DocumentOverview
        document={document}
        objectInfoFindings={objectInfoFindings}
        onSelectEntity={onSelectEntity}
      />
    );
  }

  // Unbekannte (z. B. veraltete) Modus-Werte fallen auf die Übersicht zurück.
  const activeMode: InspectorMode = INSPECTOR_MODES.some(
    (item) => item.value === mode,
  )
    ? mode
    : "overview";

  if (activeMode === "properties") {
    return (
      <PsetPanel
        activeCatalogObjectId={activeCatalogObjectId}
        catalog={catalog}
        catalogFindings={catalogFindings}
        document={document}
        selectedId={selectedId}
        onAddEmptyPset={onAddEmptyPset}
        onAddPropertyToSet={onAddPropertyToSet}
        onAddQuantity={onAddQuantity}
        onApplyCatalogFindings={onApplyCatalogFindings}
        onDuplicatePropertySet={onDuplicatePropertySet}
        onRemovePropertyFromSet={onRemovePropertyFromSet}
        onRemovePropertySet={onRemovePropertySet}
        onRenamePropertySet={onRenamePropertySet}
        onUpdateProperty={onUpdateProperty}
      />
    );
  }
  if (activeMode === "placement") {
    return (
      <PlacementGeometryPanel
        document={document}
        entity={entity}
        selectedId={selectedId}
        onAssignBodyToSelected={onAssignBodyToSelected}
        onMove={onMovePlacement}
        onSelectEntity={onSelectEntity}
      />
    );
  }
  if (activeMode === "relations") {
    return (
      <RelationsResourcesPanel
        document={document}
        selectedId={selectedId}
        onAddGroupAssignment={onAddGroupAssignment}
        onAddMaterial={onAddMaterial}
        onAddMaterialConstituentSet={onAddMaterialConstituentSet}
        onAddMaterialLayerSet={onAddMaterialLayerSet}
        onAddMaterialLayerSetUsage={onAddMaterialLayerSetUsage}
        onAddMaterialProfileSet={onAddMaterialProfileSet}
        onAddMaterialProfileSetUsage={onAddMaterialProfileSetUsage}
        onAddMaterialStyle={onAddMaterialStyle}
        onAddMaterialWithProperties={onAddMaterialWithProperties}
        onAddRelationship={onAddRelationship}
        onAssignType={onAssignType}
        onRemoveRelationship={onRemoveRelationship}
        onUpdateRelationship={onUpdateRelationship}
      />
    );
  }
  return (
    <OverviewPanel
      document={document}
      entity={entity}
      objectInfoFindings={objectInfoFindings}
      objectInfoIndex={objectInfoIndex}
      onAddUnit={onAddUnit}
      onSaveEdit={onSaveEdit}
      onSelectEntity={onSelectEntity}
    />
  );
}
