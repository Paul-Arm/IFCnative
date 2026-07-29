import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  relationshipTypesForEntities,
  type NativeIfcDocument,
  type NativeIfcRelationship,
} from "@/ifc";

import { RELATION_TYPES } from "../constants";
import {
  Badge,
  Button,
  CollapsibleSection,
  DropdownField,
  EntityDropdown,
  InfoRow,
  InfoSection,
  PanelHeader,
  PanelShell,
} from "../ui";
import { ResourceSections } from "./material-forms";
import { EditBlock, SectionHeading, TextLine, uniqueStrings } from "./shared";

/* ------------------------------------------------------------------ */
/* Tab "Beziehungen" (Beziehungen + Ressourcen)                        */
/* ------------------------------------------------------------------ */

export function RelationsResourcesPanel({
  document,
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
  onAddRelationship,
  onAssignType,
  onRemoveRelationship,
  onUpdateRelationship,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddGroupAssignment(
    groupType: string,
    groupName: string,
    objectType: string,
    longName: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
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
  onAddMaterialStyle(
    materialName: string,
    materialCategory: string,
    styleName: string,
    color: string,
    transparency: string,
  ): void;
  onAddMaterialWithProperties(
    materialName: string,
    materialCategory: string,
    propertySetName: string,
    propertyRows: string,
  ): void;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onRemoveRelationship(relationshipId: number): void;
  onUpdateRelationship(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const relationships = document.relationshipsByEntity.get(selectedId) ?? [];
  const resources = document.resourcesByEntity.get(selectedId) ?? [];
  const typeAssignments =
    document.typeAssignmentsByEntity.get(selectedId) ?? [];
  const [relType, setRelType] = useState("IFCRELAGGREGATES");
  const [sourceId, setSourceId] = useState(String(selectedId));
  const [targetId, setTargetId] = useState(String(selectedId));
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));
  const relationshipTypeOptions = useMemo(
    () =>
      relationshipTypesForEntities(
        document,
        RELATION_TYPES,
        Number(sourceId),
        Number(targetId),
      ),
    [document, sourceId, targetId],
  );
  const canCreateRelationship =
    validSource && validTarget && relationshipTypeOptions.includes(relType);

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

  useEffect(() => {
    if (
      relationshipTypeOptions.length &&
      !relationshipTypeOptions.includes(relType)
    ) {
      setRelType(relationshipTypeOptions[0]);
    }
  }, [relationshipTypeOptions, relType]);

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Beziehungen & Ressourcen"
        description={`${relationships.length.toLocaleString("de-DE")} Beziehungen · ${resources.length.toLocaleString("de-DE")} Ressourcen · ${typeAssignments.length.toLocaleString("de-DE")} Typzuweisungen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />

      <SectionHeading>Beziehungen</SectionHeading>
      <CollapsibleSection
        title="Neue Beziehung"
        meta="Beziehung zwischen zwei Objekten anlegen"
      >
        <DropdownField
          label="Beziehungsklasse"
          options={relationshipTypeOptions}
          value={relType}
          onChange={setRelType}
        />
        <EntityDropdown
          label="Quellobjekt"
          document={document}
          value={sourceId}
          onChange={setSourceId}
        />
        <EntityDropdown
          label="Zielobjekt"
          document={document}
          value={targetId}
          onChange={setTargetId}
        />
        {!relationshipTypeOptions.length ? (
          <TextLine>
            Keine gültige Beziehungsklasse für diese Quell-/Zielklassen.
          </TextLine>
        ) : null}
        <Button
          disabled={!canCreateRelationship}
          variant="default"
          onClick={() =>
            onAddRelationship(relType, Number(sourceId), Number(targetId))
          }
        >
          <Plus aria-hidden className="size-3.5" /> Beziehung hinzufügen
        </Button>
      </CollapsibleSection>
      {relationships.map((relationship) => (
        <InfoSection
          key={relationship.id}
          title={`#${relationship.id} ${relationship.type}`}
        >
          <EditableRelationship
            document={document}
            relationship={relationship}
            selectedId={selectedId}
            onRemove={onRemoveRelationship}
            onUpdate={onUpdateRelationship}
          />
        </InfoSection>
      ))}
      {!relationships.length ? (
        <TextLine>Keine Beziehungen indexiert.</TextLine>
      ) : null}

      <SectionHeading>Ressourcen</SectionHeading>
      <ResourceSections
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
        onAssignType={onAssignType}
      />
    </PanelShell>
  );
}

function EditableRelationship({
  document,
  relationship,
  selectedId,
  onRemove,
  onUpdate,
}: {
  document: NativeIfcDocument;
  relationship: NativeIfcRelationship;
  selectedId: number;
  onRemove(relationshipId: number): void;
  onUpdate(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const currentSourceId = relationship.sourceIds[0] ?? selectedId;
  const currentTargetId = relationship.targetIds[0] ?? selectedId;
  const [type, setType] = useState(relationship.type);
  const [sourceId, setSourceId] = useState(String(currentSourceId));
  const [targetId, setTargetId] = useState(String(currentTargetId));
  const compatibleTypeOptions = useMemo(
    () =>
      relationshipTypesForEntities(
        document,
        RELATION_TYPES,
        Number(sourceId),
        Number(targetId),
      ),
    [document, sourceId, targetId],
  );
  const typeOptions = useMemo(
    () => uniqueStrings([...compatibleTypeOptions, relationship.type]),
    [compatibleTypeOptions, relationship.type],
  );
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));
  const canSaveRelationship =
    validSource && validTarget && compatibleTypeOptions.includes(type);

  useEffect(() => {
    setType(relationship.type);
    setSourceId(String(currentSourceId));
    setTargetId(String(currentTargetId));
  }, [currentSourceId, currentTargetId, relationship.id, relationship.type]);

  useEffect(() => {
    if (compatibleTypeOptions.length && !compatibleTypeOptions.includes(type)) {
      setType(compatibleTypeOptions[0]);
    }
  }, [compatibleTypeOptions, type]);

  return (
    <EditBlock>
      <InfoRow label="Familie" value={relationship.family} />
      <DropdownField
        label="Beziehungsklasse"
        options={typeOptions}
        value={type}
        onChange={setType}
      />
      <EntityDropdown
        label="Quellobjekt"
        document={document}
        value={sourceId}
        onChange={setSourceId}
      />
      <EntityDropdown
        label="Zielobjekt"
        document={document}
        value={targetId}
        onChange={setTargetId}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!canSaveRelationship}
          variant="outline"
          onClick={() =>
            onUpdate(relationship.id, type, Number(sourceId), Number(targetId))
          }
        >
          <Save aria-hidden className="size-3.5" /> Speichern
        </Button>
        <Button
          title="Beziehung zum Löschen vormerken"
          variant="outline"
          onClick={() => onRemove(relationship.id)}
        >
          <Trash2 aria-hidden className="size-3.5 text-destructive" /> Löschen
          vormerken
        </Button>
      </div>
    </EditBlock>
  );
}

export function ResourcesPanel({
  document,
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
  onAssignType,
}: {
  document: NativeIfcDocument;
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
  onAssignType(typeName: string, typeClass: string, tag: string): void;
}) {
  const resources = document.resourcesByEntity.get(selectedId) ?? [];
  const typeAssignments =
    document.typeAssignmentsByEntity.get(selectedId) ?? [];
  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Ressourcen"
        description={`${resources.length.toLocaleString("de-DE")} Ressourcen · ${typeAssignments.length.toLocaleString("de-DE")} Typzuweisungen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <ResourceSections
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
        onAssignType={onAssignType}
      />
    </PanelShell>
  );
}
