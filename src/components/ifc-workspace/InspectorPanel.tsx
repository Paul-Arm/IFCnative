import { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import {
  getNativePlacement,
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcRelationship,
} from "@/ifc";

import {
  ENTITY_TYPES,
  PROPERTY_VALUE_TYPES,
  QUANTITY_TYPES,
  RELATION_TYPES,
  TYPE_CLASSES,
  UNIT_NAMES,
  UNIT_TYPES,
} from "./constants";
import { styles } from "./styles";
import type { EntityEditDraft, InspectorMode } from "./types";
import { findTreePath } from "./StructurePanel";
import {
  Button,
  DropdownField,
  EntityDropdown,
  InfoRow,
  InfoSection,
  LabeledInput,
} from "./ui";

export function InspectorPanel({
  document,
  mode,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddMaterial,
  onAssignType,
  onAddPset,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
  onMovePlacement,
  onRemoveRelationship,
  onSaveEdit,
  onUpdateProperty,
  onUpdateRelationship,
}: {
  document: NativeIfcDocument;
  mode: InspectorMode;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddPset(
    psetName: string,
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
  onMovePlacement(x: string, y: string, z: string): void;
  onRemoveRelationship(relationshipId: number): void;
  onSaveEdit(draft: EntityEditDraft): void;
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
    return <Text style={styles.empty}>No entity selected.</Text>;
  }

  if (mode === "edit") {
    return <EditPanel entity={entity} onSave={onSaveEdit} />;
  }
  if (mode === "psets") {
    return (
      <PsetPanel
        document={document}
        selectedId={selectedId}
        onAddPset={onAddPset}
        onAddQuantity={onAddQuantity}
        onUpdateProperty={onUpdateProperty}
      />
    );
  }
  if (mode === "placement") {
    return (
      <PlacementPanel
        document={document}
        selectedId={selectedId}
        onMove={onMovePlacement}
      />
    );
  }
  if (mode === "relations") {
    return (
      <RelationsPanel
        document={document}
        selectedId={selectedId}
        onAddRelationship={onAddRelationship}
        onRemoveRelationship={onRemoveRelationship}
        onUpdateRelationship={onUpdateRelationship}
      />
    );
  }
  if (mode === "refs") {
    return <ReferencesPanel document={document} selectedId={selectedId} />;
  }
  if (mode === "resources") {
    return (
      <ResourcesPanel
        document={document}
        selectedId={selectedId}
        onAddClassification={onAddClassification}
        onAddDocumentReference={onAddDocumentReference}
        onAddMaterial={onAddMaterial}
        onAssignType={onAssignType}
      />
    );
  }
  if (mode === "units") {
    return <UnitsPanel document={document} onAddUnit={onAddUnit} />;
  }
  return <InfoPanel document={document} entity={entity} />;
}

function InfoPanel({
  document,
  entity,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
}) {
  const path = findTreePath(document, entity.id);
  const resources = document.resourcesByEntity.get(entity.id) ?? [];
  const sets = document.propertySetsByEntity.get(entity.id) ?? [];
  const relationships = document.relationshipsByEntity.get(entity.id) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Identity">
        <InfoRow label="ID" value={`#${entity.id}`} />
        <InfoRow label="Class" value={entity.type} />
        <InfoRow label="GlobalId" value={entity.globalId || "-"} />
        <InfoRow label="Name" value={entity.name || "-"} />
        <InfoRow label="Description" value={entity.description || "-"} />
      </InfoSection>
      <InfoSection title="Document">
        <InfoRow label="File" value={document.fileName} />
        <InfoRow label="Schema" value={document.schema} />
        <InfoRow
          label="Entities"
          value={document.entities.length.toLocaleString()}
        />
        <InfoRow
          label="Types"
          value={document.entitiesByType.size.toLocaleString()}
        />
      </InfoSection>
      <InfoSection title="Spatial Path">
        {path.length ? (
          path.map((item) => (
            <Text key={item.id} style={styles.infoText}>
              #{item.id} {item.type}: {item.name || item.type}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No spatial path.</Text>
        )}
      </InfoSection>
      <InfoSection title="Resources">
        {resources.length ? (
          resources.map((item) => (
            <Text key={item} style={styles.infoText}>
              {item}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No resources linked.</Text>
        )}
      </InfoSection>
      <InfoSection title="Properties / Quantities">
        {sets.length ? (
          sets.map((set) => (
            <Text key={set.id} style={styles.infoText}>
              #{set.id} {set.kind} {set.name}:{" "}
              {set.values
                .map((value) => `${value.name}=${value.value}`)
                .join(", ")}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No Psets or QTOs linked.</Text>
        )}
      </InfoSection>
      <InfoSection title="Relationships">
        {relationships.length ? (
          relationships.map((relationship) => (
            <Text key={relationship.id} style={styles.infoText}>
              #{relationship.id} {relationship.type}:{" "}
              {relationship.sourceIds.map((id) => `#${id}`).join(",") || "-"} -{" "}
              {relationship.targetIds.map((id) => `#${id}`).join(",") || "-"}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No relationships indexed.</Text>
        )}
      </InfoSection>
      <InfoSection title="STEP">
        <Text style={styles.codeBlock}>
          #{entity.id}= {entity.type}({entity.args.join(",")});
        </Text>
      </InfoSection>
    </ScrollView>
  );
}

function EditPanel({
  entity,
  onSave,
}: {
  entity: NativeIfcEntity;
  onSave(draft: EntityEditDraft): void;
}) {
  const rawArgsValue = entity.args.join(",");
  const [type, setType] = useState(entity.type);
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description);
  const [rawArgs, setRawArgs] = useState(rawArgsValue);

  useEffect(() => {
    setType(entity.type);
    setName(entity.name);
    setDescription(entity.description);
    setRawArgs(rawArgsValue);
  }, [entity.description, entity.id, entity.name, entity.type, rawArgsValue]);

  return (
    <ScrollView style={styles.panelScroll}>
      <DropdownField
        label="Class"
        options={ENTITY_TYPES}
        value={type}
        onChange={setType}
      />
      <LabeledInput label="Name" value={name} onChangeText={setName} />
      <LabeledInput
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <LabeledInput
        label="Raw STEP arguments"
        value={rawArgs}
        onChangeText={setRawArgs}
        multiline
        mono
      />
      <Button
        label="Save Entity"
        primary
        onPress={() => onSave({ description, name, rawArgs, type })}
      />
    </ScrollView>
  );
}

function PlacementPanel({
  document,
  selectedId,
  onMove,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onMove(x: string, y: string, z: string): void;
}) {
  const placement = getNativePlacement(document, selectedId);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");

  useEffect(() => {
    if (!placement) {
      setX("0");
      setY("0");
      setZ("0");
      return;
    }
    setX(String(placement.x));
    setY(String(placement.y));
    setZ(String(placement.z));
  }, [placement?.pointId, placement?.x, placement?.y, placement?.z]);

  if (!placement) {
    return (
      <View style={styles.diffEmpty}>
        <Text style={styles.infoTitle}>No editable local placement</Text>
        <Text style={styles.empty}>
          Select a product with IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D →
          IFCCARTESIANPOINT to draft a numeric XYZ move.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Selected placement">
        <InfoRow label="Product" value={`#${placement.productId}`} />
        <InfoRow label="Placement" value={`#${placement.placementId}`} />
        <InfoRow label="Axis" value={`#${placement.axisPlacementId}`} />
        <InfoRow label="Point" value={`#${placement.pointId}`} />
        <InfoRow
          label="Relative to"
          value={placement.relativeTo ? `#${placement.relativeTo}` : "$"}
        />
      </InfoSection>
      <InfoSection title="Draft move">
        <Text style={styles.empty}>
          Edits update only the placement cartesian point and stay pending until
          reviewed in IFC Diff / Review.
        </Text>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="X"
              keyboardType="numeric"
              value={x}
              onChangeText={setX}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Y"
              keyboardType="numeric"
              value={y}
              onChangeText={setY}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={z}
              onChangeText={setZ}
            />
          </View>
        </View>
        <Button
          label="Stage Placement Move"
          primary
          onPress={() => onMove(x, y, z)}
        />
      </InfoSection>
    </ScrollView>
  );
}

function PsetPanel({
  document,
  selectedId,
  onAddPset,
  onAddQuantity,
  onUpdateProperty,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddPset(
    psetName: string,
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
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const [psetName, setPsetName] = useState("Pset_IFCnative_Custom");
  const [propertyName, setPropertyName] = useState("Status");
  const [propertyValue, setPropertyValue] = useState("Entwurf");
  const [propertyValueType, setPropertyValueType] = useState("IFCLABEL");
  const [qtoName, setQtoName] = useState("Qto_IFCnative_BaseQuantities");
  const [quantityName, setQuantityName] = useState("ErfassteLaenge");
  const [quantityValue, setQuantityValue] = useState("1");
  const [quantityType, setQuantityType] = useState("IFCQUANTITYLENGTH");
  const sets = document.propertySetsByEntity.get(selectedId) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Property Set</Text>
        <LabeledInput
          label="Pset name"
          value={psetName}
          onChangeText={setPsetName}
        />
        <LabeledInput
          label="Property"
          value={propertyName}
          onChangeText={setPropertyName}
        />
        <DropdownField
          label="Value type"
          options={PROPERTY_VALUE_TYPES}
          value={propertyValueType}
          onChange={setPropertyValueType}
        />
        <LabeledInput
          label="Value"
          value={propertyValue}
          onChangeText={setPropertyValue}
        />
        <Button
          label="+ Add Pset"
          primary
          onPress={() =>
            onAddPset(psetName, propertyName, propertyValue, propertyValueType)
          }
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Quantity Set</Text>
        <LabeledInput
          label="QTO name"
          value={qtoName}
          onChangeText={setQtoName}
        />
        <LabeledInput
          label="Quantity"
          value={quantityName}
          onChangeText={setQuantityName}
        />
        <DropdownField
          label="Quantity type"
          options={QUANTITY_TYPES}
          value={quantityType}
          onChange={setQuantityType}
        />
        <LabeledInput
          label="Value"
          keyboardType="numeric"
          value={quantityValue}
          onChangeText={setQuantityValue}
        />
        <Button
          label="+ Add Quantity"
          onPress={() =>
            onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
          }
        />
      </View>
      {sets.map((set) => (
        <InfoSection key={set.id} title={`${set.kind} #${set.id} ${set.name}`}>
          {set.values.map((value) => (
            <EditablePropertyRow
              key={value.id}
              property={value}
              rawValue={editableSetValue(
                document.entityById.get(value.id),
                value.value,
              )}
              onUpdate={onUpdateProperty}
            />
          ))}
        </InfoSection>
      ))}
      {!sets.length ? (
        <Text style={styles.empty}>No Psets or QTOs indexed.</Text>
      ) : null}
    </ScrollView>
  );
}

function EditablePropertyRow({
  property,
  rawValue,
  onUpdate,
}: {
  property: { id: number; name: string; value: string; type: string };
  rawValue: string;
  onUpdate(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const parsed = parseTypedPropertyValue(rawValue);
  const [name, setName] = useState(property.name);
  const [valueType, setValueType] = useState(parsed.valueType);
  const [value, setValue] = useState(parsed.value);
  const propertyOptions = useMemo(
    () =>
      uniqueStrings([
        ...PROPERTY_VALUE_TYPES,
        ...QUANTITY_TYPES,
        parsed.valueType,
      ]),
    [parsed.valueType],
  );

  useEffect(() => {
    setName(property.name);
    setValueType(parsed.valueType);
    setValue(parsed.value);
  }, [parsed.value, parsed.valueType, property.id, property.name]);

  return (
    <View style={styles.editBlock}>
      <LabeledInput
        label={`Property #${property.id}`}
        value={name}
        onChangeText={setName}
      />
      <DropdownField
        label="Value type"
        options={propertyOptions}
        value={valueType}
        onChange={setValueType}
      />
      <LabeledInput label="Value" value={value} onChangeText={setValue} />
      <Button
        label="Save Property"
        onPress={() => onUpdate(property.id, name, value, valueType)}
      />
    </View>
  );
}

function RelationsPanel({
  document,
  selectedId,
  onAddRelationship,
  onRemoveRelationship,
  onUpdateRelationship,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onRemoveRelationship(relationshipId: number): void;
  onUpdateRelationship(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const relationships = document.relationshipsByEntity.get(selectedId) ?? [];
  const [relType, setRelType] = useState("IFCRELAGGREGATES");
  const [sourceId, setSourceId] = useState(String(selectedId));
  const [targetId, setTargetId] = useState(String(selectedId));
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

  return (
    <ScrollView style={styles.panelScroll}>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Relationship</Text>
        <DropdownField
          label="Relationship class"
          options={RELATION_TYPES}
          value={relType}
          onChange={setRelType}
        />
        <EntityDropdown
          label="Source object"
          document={document}
          value={sourceId}
          onChange={setSourceId}
        />
        <EntityDropdown
          label="Target object"
          document={document}
          value={targetId}
          onChange={setTargetId}
        />
        <Button
          disabled={!validSource || !validTarget}
          label="+ Add Relationship"
          primary
          onPress={() =>
            onAddRelationship(relType, Number(sourceId), Number(targetId))
          }
        />
      </View>
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
        <Text style={styles.empty}>No relationships indexed.</Text>
      ) : null}
    </ScrollView>
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
  const typeOptions = useMemo(
    () => uniqueStrings([...RELATION_TYPES, relationship.type]),
    [relationship.type],
  );
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));

  useEffect(() => {
    setType(relationship.type);
    setSourceId(String(currentSourceId));
    setTargetId(String(currentTargetId));
  }, [currentSourceId, currentTargetId, relationship.id, relationship.type]);

  return (
    <View style={styles.editBlock}>
      <InfoRow label="Family" value={relationship.family} />
      <DropdownField
        label="Relationship class"
        options={typeOptions}
        value={type}
        onChange={setType}
      />
      <EntityDropdown
        label="Source object"
        document={document}
        value={sourceId}
        onChange={setSourceId}
      />
      <EntityDropdown
        label="Target object"
        document={document}
        value={targetId}
        onChange={setTargetId}
      />
      <View style={styles.row}>
        <View style={styles.flexField}>
          <Button
            disabled={!validSource || !validTarget}
            label="Save Relationship"
            onPress={() =>
              onUpdate(
                relationship.id,
                type,
                Number(sourceId),
                Number(targetId),
              )
            }
          />
        </View>
        <View style={styles.flexField}>
          <Button
            label="Stage Delete Relationship"
            onPress={() => onRemove(relationship.id)}
          />
        </View>
      </View>
    </View>
  );
}

function ResourcesPanel({
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddMaterial,
  onAssignType,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
}) {
  const resources = document.resourcesByEntity.get(selectedId) ?? [];
  const typeAssignments =
    document.typeAssignmentsByEntity.get(selectedId) ?? [];
  const [materialName, setMaterialName] = useState("Inspektionsbeton");
  const [materialCategory, setMaterialCategory] = useState("Beton");
  const [typeClass, setTypeClass] = useState("IFCTYPEOBJECT");
  const [typeName, setTypeName] = useState("Inspektionselement-Typ");
  const [typeTag, setTypeTag] = useState("TYPE-INSPECTION");
  const [classificationId, setClassificationId] = useState(
    "IFCNATIVE-INSPECTION",
  );
  const [classificationName, setClassificationName] =
    useState("Inspektionsziel");
  const [classificationUri, setClassificationUri] = useState(
    "https://ifcnative.local/classification/inspection-target",
  );
  const [documentId, setDocumentId] = useState("DOC-INSPECTION");
  const [documentName, setDocumentName] = useState("Inspektionsbericht");
  const [documentUri, setDocumentUri] = useState(
    "https://ifcnative.local/documents/inspection-report",
  );

  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Linked Resources">
        {resources.length ? (
          resources.map((resource) => (
            <Text key={resource} style={styles.infoText}>
              {resource}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>
            No material, classification or document linked.
          </Text>
        )}
      </InfoSection>
      <InfoSection title="Type assignments">
        {typeAssignments.length ? (
          typeAssignments.map((assignment) => (
            <Text
              key={`${assignment.relationshipId}-${assignment.typeId}`}
              style={styles.infoText}
            >
              #{assignment.relationshipId} → #{assignment.typeId}{" "}
              {assignment.typeClass} {assignment.typeName}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No IFCRELDEFINESBYTYPE assignment.</Text>
        )}
      </InfoSection>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Assign Type</Text>
        <DropdownField
          label="Type class"
          options={TYPE_CLASSES}
          value={typeClass}
          onChange={setTypeClass}
        />
        <LabeledInput
          label="Type name"
          value={typeName}
          onChangeText={setTypeName}
        />
        <LabeledInput
          label="Type tag"
          value={typeTag}
          onChangeText={setTypeTag}
        />
        <Button
          label="+ Assign Type"
          primary
          onPress={() => onAssignType(typeName, typeClass, typeTag)}
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Material</Text>
        <LabeledInput
          label="Material"
          value={materialName}
          onChangeText={setMaterialName}
        />
        <LabeledInput
          label="Category"
          value={materialCategory}
          onChangeText={setMaterialCategory}
        />
        <Button
          label="+ Add Material"
          primary
          onPress={() => onAddMaterial(materialName, materialCategory)}
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Classification</Text>
        <LabeledInput
          label="Identification"
          value={classificationId}
          onChangeText={setClassificationId}
        />
        <LabeledInput
          label="Name"
          value={classificationName}
          onChangeText={setClassificationName}
        />
        <LabeledInput
          label="Location / URI"
          value={classificationUri}
          onChangeText={setClassificationUri}
        />
        <Button
          label="+ Add Classification"
          onPress={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Document</Text>
        <LabeledInput
          label="Identification"
          value={documentId}
          onChangeText={setDocumentId}
        />
        <LabeledInput
          label="Name"
          value={documentName}
          onChangeText={setDocumentName}
        />
        <LabeledInput
          label="Location / URI"
          value={documentUri}
          onChangeText={setDocumentUri}
        />
        <Button
          label="+ Add Document"
          onPress={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </View>
    </ScrollView>
  );
}

function ReferencesPanel({
  document,
  selectedId,
}: {
  document: NativeIfcDocument;
  selectedId: number;
}) {
  const outgoing = document.outgoingRefs.get(selectedId) ?? [];
  const incoming = document.incomingRefs.get(selectedId) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Outgoing">
        {outgoing.length ? (
          outgoing.map((id) => (
            <Text key={id} style={styles.infoText}>
              -&gt; #{id} {document.entityById.get(id)?.type ?? ""}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>None.</Text>
        )}
      </InfoSection>
      <InfoSection title="Incoming">
        {incoming.length ? (
          incoming.map((entity) => (
            <Text key={entity.id} style={styles.infoText}>
              &lt;- #{entity.id} {entity.type}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>None.</Text>
        )}
      </InfoSection>
    </ScrollView>
  );
}

function UnitsPanel({
  document,
  onAddUnit,
}: {
  document: NativeIfcDocument;
  onAddUnit(unitType: string, unitName: string): void;
}) {
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
  return (
    <ScrollView style={styles.panelScroll}>
      <DropdownField
        label="Unit type"
        options={UNIT_TYPES}
        value={unitType}
        onChange={setUnitType}
      />
      <DropdownField
        label="Unit name"
        options={UNIT_NAMES}
        value={unitName}
        onChange={setUnitName}
      />
      <Button
        label="+ Add Unit"
        primary
        onPress={() => onAddUnit(unitType, unitName)}
      />
      {document.units.map((unit) => (
        <Text key={unit} style={styles.infoText}>
          {unit}
        </Text>
      ))}
    </ScrollView>
  );
}

function editableSetValue(
  entity: NativeIfcEntity | undefined,
  fallback: string,
) {
  if (!entity) {
    return fallback;
  }
  if (QUANTITY_TYPES.includes(entity.type)) {
    return `${entity.type}(${entity.args[3] ?? "0"})`;
  }
  return entity.args[2] ?? fallback;
}

function parseTypedPropertyValue(rawValue: string) {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (!match) {
    return { value: trimmed === "-" ? "" : trimmed, valueType: "IFCLABEL" };
  }
  const valueType = normalizePropertyValueType(match[1]);
  const inner = match[2].trim();
  if (valueType === "IFCBOOLEAN") {
    const flag = inner.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
    return { value: flag === "F" ? "False" : "True", valueType };
  }
  const unquoted = inner.match(/^'([\s\S]*)'$/)?.[1];
  if (unquoted != null) {
    return { value: unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function normalizePropertyValueType(type: string) {
  const normalized = type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : "IFCLABEL";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
