import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  catalogObjectLabel,
  getNativePlacement,
  type CatalogObjectType,
  type CatalogPropertyRule,
  type CatalogValidationFinding,
  type IfcObjectCatalog,
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcPropertySet,
  type NativeIfcRelationship,
  type ObjectInfoIndex,
  type ObjectInfoValidationFinding,
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
import { findTreePath } from "./StructurePanel";
import { styles } from "./styles";
import type { EntityEditDraft, InspectorMode } from "./types";
import {
  Button,
  CollapsibleSection,
  DropdownField,
  EntityDropdown,
  InfoRow,
  InfoSection,
  LabeledInput,
  SegmentedControl,
} from "./ui";

type NativeContextMenuEvent = {
  preventDefault?: () => void;
};

const ContextMenuView = View as ComponentType<
  ComponentProps<typeof View> & {
    onContextMenu?: (event: NativeContextMenuEvent) => void;
  }
>;

export function InspectorPanel({
  activeCatalogObjectId,
  catalog,
  catalogFindings,
  document,
  mode,
  objectInfoFindings,
  objectInfoIndex,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddMaterial,
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
    return <Text style={styles.empty}>No entity selected.</Text>;
  }

  if (mode === "edit") {
    return <EditPanel entity={entity} onSave={onSaveEdit} />;
  }
  if (mode === "psets") {
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
  if (mode === "object-info") {
    return (
      <ObjectInfoInspectorPanel
        document={document}
        findings={objectInfoFindings}
        index={objectInfoIndex}
        selectedId={selectedId}
        onSelectEntity={onSelectEntity}
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

function ObjectInfoInspectorPanel({
  document,
  findings,
  index,
  selectedId,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  findings: ObjectInfoValidationFinding[];
  index: ObjectInfoIndex;
  selectedId: number;
  onSelectEntity(entityId: number): void;
}) {
  const definitions = index.definitionsByEntity.get(selectedId) ?? [];
  const outgoing = index.referencesByEntity.get(selectedId) ?? [];
  const incoming = index.references.filter(
    (reference) =>
      reference.targetDefinitions.some(
        (definition) => definition.entityId === selectedId,
      ) ||
      reference.externalDefinitions.some(
        (definition) => definition.entityId === selectedId,
      ),
  );
  const localFindings = findings.filter((finding) =>
    objectInfoFindingTouchesEntity(finding, selectedId),
  );

  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Objektinfo-ID">
        {definitions.length ? (
          definitions.map((definition) => (
            <View key={definition.propertyId} style={styles.catalogFinding}>
              <Text style={styles.diffSummaryTitle}>
                {definition.value || "-"}
              </Text>
              <Text style={styles.diffSummaryText}>
                #{definition.psetId} {definition.psetName} / #
                {definition.propertyId} {definition.propertyName}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>
            Kein ePset_Objektinformationen._ID am ausgewaehlten Objekt.
          </Text>
        )}
      </InfoSection>

      <InfoSection title="Ausgehende ID-Referenzen">
        {outgoing.length ? (
          outgoing.map((reference) => {
            const target =
              reference.targetDefinitions[0]?.entityId ??
              reference.externalDefinitions[0]?.entityId;
            return (
              <View key={reference.propertyId} style={styles.catalogFinding}>
                <Text style={styles.diffSummaryTitle}>
                  {reference.psetName}.{reference.propertyName}
                </Text>
                <Text style={styles.diffSummaryText}>
                  {reference.value || "-"}
                </Text>
                <Text style={styles.treeMeta} numberOfLines={1}>
                  {target
                    ? objectInfoEntityLabel(document, target)
                    : "Kein Ziel gefunden"}
                </Text>
                {target ? (
                  <Button
                    label="Ziel oeffnen"
                    onPress={() => onSelectEntity(target)}
                  />
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={styles.empty}>Keine ausgehenden ID-Referenzen.</Text>
        )}
      </InfoSection>

      <InfoSection title="Eingehende ID-Referenzen">
        {incoming.length ? (
          incoming.map((reference) => (
            <View key={reference.propertyId} style={styles.catalogFinding}>
              <Text style={styles.diffSummaryTitle}>
                {reference.value || "-"}
              </Text>
              <Text style={styles.diffSummaryText}>
                {reference.psetName}.{reference.propertyName}
              </Text>
              <Text style={styles.treeMeta} numberOfLines={1}>
                {objectInfoEntityLabel(document, reference.entityId)}
              </Text>
              <Button
                label="Quelle oeffnen"
                onPress={() => onSelectEntity(reference.entityId)}
              />
            </View>
          ))
        ) : (
          <Text style={styles.empty}>Keine eingehenden ID-Referenzen.</Text>
        )}
      </InfoSection>

      <InfoSection title="Lokale Findings">
        {localFindings.length ? (
          localFindings.map((finding) => (
            <View key={finding.id} style={styles.catalogFinding}>
              <Text style={styles.diffSummaryTitle}>
                {finding.severity.toUpperCase()} / {finding.kind}
              </Text>
              <Text style={styles.diffSummaryText}>{finding.message}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>Keine lokalen Objektinfo-Findings.</Text>
        )}
      </InfoSection>
    </ScrollView>
  );
}

function objectInfoFindingTouchesEntity(
  finding: ObjectInfoValidationFinding,
  entityId: number,
) {
  return (
    finding.entityId === entityId ||
    finding.definitions?.some(
      (definition) => definition.entityId === entityId,
    ) ||
    finding.externalDefinitions?.some(
      (definition) => definition.entityId === entityId,
    ) ||
    finding.references?.some((reference) => reference.entityId === entityId)
  );
}

function objectInfoEntityLabel(document: NativeIfcDocument, entityId: number) {
  const entity = document.entityById.get(entityId);
  return entity
    ? `#${entityId} ${entity.type} ${entity.name || ""}`
    : `#${entityId}`;
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
          IFCCARTESIANPOINT to edit a numeric XYZ move.
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
      <InfoSection title="Move">
        <Text style={styles.empty}>
          Edits update the placement cartesian point directly in the active IFC.
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
  activeCatalogObjectId,
  catalog,
  catalogFindings,
  document,
  selectedId,
  onAddEmptyPset,
  onAddPropertyToSet,
  onAddQuantity,
  onApplyCatalogFindings,
  onDuplicatePropertySet,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onUpdateProperty,
}: {
  activeCatalogObjectId: string;
  catalog: IfcObjectCatalog | null;
  catalogFindings: CatalogValidationFinding[];
  document: NativeIfcDocument;
  selectedId: number;
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
  onApplyCatalogFindings(findings: CatalogValidationFinding[]): void;
  onDuplicatePropertySet(setId: number): void;
  onRemovePropertyFromSet(setId: number, propertyId: number): void;
  onRemovePropertySet(setId: number): void;
  onRenamePropertySet(setId: number, name: string): void;
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const sets = document.propertySetsByEntity.get(selectedId) ?? [];
  const catalogObject = catalog?.objectTypes.find(
    (objectType) => objectType.id === activeCatalogObjectId,
  );
  const catalogPsets = useMemo(
    () => groupCatalogPsets(catalogObject),
    [catalogObject],
  );
  const [psetSource, setPsetSource] = useState("empty");
  const [emptyPsetName, setEmptyPsetName] = useState("Pset_IFCnative_Custom");
  const [qtoName, setQtoName] = useState("Qto_IFCnative_BaseQuantities");
  const [quantityName, setQuantityName] = useState("ErfassteLaenge");
  const [quantityValue, setQuantityValue] = useState("1");
  const [quantityType, setQuantityType] = useState("IFCQUANTITYLENGTH");
  const catalogRuleCount = catalogPsets.reduce(
    (total, set) => total + set.rules.length,
    0,
  );
  const catalogQuickFixes = catalogFindings.filter(
    (finding) => finding.quickFix,
  );

  const addSelectedPset = () => {
    if (psetSource === "catalog") {
      return;
    }
    onAddEmptyPset(emptyPsetName.trim() || "Pset_IFCnative_Custom");
  };

  return (
    <ScrollView style={styles.panelScroll}>
      <View style={styles.psetToolbar}>
        <View style={styles.psetToolbarSummary}>
          <Text style={styles.infoTitle}>Psets</Text>
          <Text style={styles.psetHeaderMeta}>
            {sets.length.toLocaleString()} Sets fuer #{selectedId}
          </Text>
        </View>
        <View style={styles.psetToolbarControls}>
          <View style={styles.psetSourceField}>
            <SegmentedControl
              options={["empty", "catalog"]}
              value={psetSource}
              onChange={setPsetSource}
            />
          </View>
          {psetSource === "catalog" ? (
            <View style={styles.psetCatalogHint}>
              <Text style={styles.psetCatalogHintTitle} numberOfLines={1}>
                {catalogObject
                  ? catalogObjectLabel(catalogObject)
                  : "Keine Katalogklasse gewaehlt"}
              </Text>
              <Text style={styles.psetCatalogHintMeta} numberOfLines={1}>
                {catalogObject
                  ? `${catalogPsets.length.toLocaleString()} Psets / ${catalogRuleCount.toLocaleString()} Regeln im Objektkatalog`
                  : "Auswahl im Objektkatalog-Panel treffen"}
              </Text>
            </View>
          ) : (
            <View style={styles.psetNameField}>
              <TextInput
                placeholder="Pset-Name"
                placeholderTextColor="#71717a"
                style={[styles.input, styles.psetToolbarInput]}
                value={emptyPsetName}
                onChangeText={setEmptyPsetName}
              />
            </View>
          )}
          {psetSource === "empty" ? (
            <PsetPrimaryButton label="+ Pset" onPress={addSelectedPset} />
          ) : (
            <PsetPrimaryButton
              disabled={!catalogQuickFixes.length}
              label={
                catalogQuickFixes.length ? "Katalog anwenden" : "Katalog OK"
              }
              onPress={() => onApplyCatalogFindings(catalogQuickFixes)}
            />
          )}
        </View>
      </View>

      {sets.map((set, index) => (
        <PsetTableSection
          document={document}
          key={set.id}
          set={set}
          stackIndex={sets.length - index}
          onAddPropertyToSet={onAddPropertyToSet}
          onDuplicatePropertySet={onDuplicatePropertySet}
          onRemovePropertyFromSet={onRemovePropertyFromSet}
          onRemovePropertySet={onRemovePropertySet}
          onRenamePropertySet={onRenamePropertySet}
          onUpdateProperty={onUpdateProperty}
        />
      ))}
      {!sets.length ? (
        <View style={styles.diffEmpty}>
          <Text style={styles.infoTitle}>Keine Psets</Text>
          <Text style={styles.empty}>
            Ueber + Pset ein leeres Set oder eine Vorlage aus dem Objektkatalog
            anlegen.
          </Text>
        </View>
      ) : null}

      <CollapsibleSection title="Quantity Set" meta="QTO manuell anlegen">
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="QTO name"
              value={qtoName}
              onChangeText={setQtoName}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Quantity"
              value={quantityName}
              onChangeText={setQuantityName}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <DropdownField
              label="Quantity type"
              options={QUANTITY_TYPES}
              value={quantityType}
              onChange={setQuantityType}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Value"
              keyboardType="numeric"
              value={quantityValue}
              onChangeText={setQuantityValue}
            />
          </View>
        </View>
        <Button
          label="+ Add Quantity Set"
          onPress={() =>
            onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
          }
        />
      </CollapsibleSection>
    </ScrollView>
  );
}

function PsetTableSection({
  document,
  set,
  stackIndex,
  onAddPropertyToSet,
  onDuplicatePropertySet,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onUpdateProperty,
}: {
  document: NativeIfcDocument;
  set: NativeIfcPropertySet;
  stackIndex: number;
  onAddPropertyToSet(
    setId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType?: string,
  ): void;
  onDuplicatePropertySet(setId: number): void;
  onRemovePropertyFromSet(setId: number, propertyId: number): void;
  onRemovePropertySet(setId: number): void;
  onRenamePropertySet(setId: number, name: string): void;
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const typeOptions =
    set.kind === "Qto" ? QUANTITY_TYPES : PROPERTY_VALUE_TYPES;
  const [newName, setNewName] = useState(
    set.kind === "Qto" ? "NeueMenge" : "NeueEigenschaft",
  );
  const [setName, setSetName] = useState(set.name);
  const [newType, setNewType] = useState(typeOptions[0] ?? "IFCLABEL");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    setNewType(typeOptions[0] ?? "IFCLABEL");
  }, [set.kind, typeOptions]);

  useEffect(() => {
    setSetName(set.name);
  }, [set.id, set.name]);

  const renameSet = (nextName: string) => {
    setSetName(nextName);
    onRenamePropertySet(set.id, nextName);
  };

  return (
    <View style={[styles.psetSection, { zIndex: stackIndex }]}>
      <View style={styles.psetHeader}>
        <View style={styles.diffHeaderText}>
          <TextInput
            value={setName}
            onChangeText={renameSet}
            style={styles.psetHeaderInput}
          />
          <Text style={styles.psetHeaderMeta}>
            {set.kind} #{set.id} / {set.values.length.toLocaleString()} Werte
          </Text>
        </View>
        <MiniButton
          disabled={!newName.trim()}
          label="+ Wert"
          onPress={() => {
            onAddPropertyToSet(set.id, newName, newValue, newType);
            setNewValue("");
          }}
        />
        <MiniButton
          label="Duplizieren"
          onPress={() => onDuplicatePropertySet(set.id)}
        />
        <MiniButton
          label="Pset loeschen"
          onPress={() => onRemovePropertySet(set.id)}
        />
      </View>
      <View style={styles.psetTable}>
        <View style={[styles.psetTableRow, styles.psetTableHead]}>
          <Text style={[styles.psetHeadCell, styles.psetNameCell]}>Name</Text>
          <Text style={[styles.psetHeadCell, styles.psetTypeCell]}>Typ</Text>
          <Text style={[styles.psetHeadCell, styles.psetValueCell]}>Wert</Text>
          <Text style={[styles.psetHeadCell, styles.psetActionCell]} />
        </View>
        {set.values.map((value) => (
          <EditablePropertyTableRow
            key={value.id}
            property={value}
            rawValue={editableSetValue(
              document.entityById.get(value.id),
              value.value,
            )}
            setId={set.id}
            typeOptions={typeOptions}
            onRemove={onRemovePropertyFromSet}
            onUpdate={onUpdateProperty}
          />
        ))}
        {!set.values.length ? (
          <View style={styles.psetTableEmptyRow}>
            <Text style={styles.empty}>Noch keine Werte.</Text>
          </View>
        ) : null}
        <View style={[styles.psetTableRow, styles.psetAddRow]}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            style={[styles.psetCellInput, styles.psetNameCell]}
          />
          <TextInput
            value={newType}
            onChangeText={setNewType}
            style={[styles.psetCellInput, styles.psetTypeCell]}
          />
          <PsetValueInput
            selectedType={newType}
            typeOptions={typeOptions}
            value={newValue}
            onChangeText={setNewValue}
            onSelectType={setNewType}
          />
          <View style={styles.psetActionCell} />
        </View>
      </View>
    </View>
  );
}

function EditablePropertyTableRow({
  property,
  rawValue,
  setId,
  typeOptions,
  onRemove,
  onUpdate,
}: {
  property: { id: number; name: string; value: string; type: string };
  rawValue: string;
  setId: number;
  typeOptions: string[];
  onRemove(setId: number, propertyId: number): void;
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

  const updateName = (nextName: string) => {
    setName(nextName);
    onUpdate(property.id, nextName, value, valueType);
  };

  const updateValueType = (nextType: string) => {
    setValueType(nextType);
    onUpdate(property.id, name, value, nextType);
  };

  const updateValue = (nextValue: string) => {
    setValue(nextValue);
    onUpdate(property.id, name, nextValue, valueType);
  };

  useEffect(() => {
    setName(property.name);
    setValueType(parsed.valueType);
    setValue(parsed.value);
  }, [parsed.value, parsed.valueType, property.id, property.name]);

  return (
    <View style={styles.psetTableRow}>
      <TextInput
        value={name}
        onChangeText={updateName}
        style={[styles.psetCellInput, styles.psetNameCell]}
      />
      <TextInput
        value={valueType}
        onChangeText={updateValueType}
        style={[styles.psetCellInput, styles.psetTypeCell]}
      />
      <PsetValueInput
        selectedType={valueType}
        typeOptions={typeOptions}
        value={value}
        onChangeText={updateValue}
        onSelectType={updateValueType}
      />
      <View style={styles.psetActionCell}>
        <MiniButton
          label="Loeschen"
          onPress={() => onRemove(setId, property.id)}
        />
      </View>
    </View>
  );
}

function PsetValueInput({
  selectedType,
  typeOptions,
  value,
  onChangeText,
  onSelectType,
}: {
  selectedType: string;
  typeOptions: string[];
  value: string;
  onChangeText(value: string): void;
  onSelectType(valueType: string): void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedTypeOptions = useMemo(
    () => uniqueStrings([selectedType, ...typeOptions]),
    [selectedType, typeOptions],
  );

  return (
    <ContextMenuView
      onContextMenu={(event) => {
        event.preventDefault?.();
        setOpen(true);
      }}
      style={[styles.psetValueCell, open && styles.psetValueCellOpen]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={[styles.psetCellInput, styles.psetValueInput]}
      />
      {open ? (
        <View style={styles.psetTypeMenu}>
          {normalizedTypeOptions.map((typeOption) => {
            const selected = typeOption === selectedType;
            return (
              <Pressable
                key={typeOption}
                onPress={() => {
                  onSelectType(typeOption);
                  setOpen(false);
                }}
                style={[
                  styles.psetTypeMenuOption,
                  selected && styles.dropdownOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    selected && styles.dropdownOptionTextActive,
                  ]}
                >
                  {typeOption}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </ContextMenuView>
  );
}

function PsetPrimaryButton({
  disabled,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.psetPrimaryButton,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.psetPrimaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function MiniButton({
  disabled,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.psetMiniButton,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.psetMiniButtonText}>{label}</Text>
    </Pressable>
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

function groupCatalogPsets(objectType: CatalogObjectType | undefined) {
  if (!objectType) {
    return [];
  }
  const groups = new Map<string, CatalogPropertyRule[]>();
  for (const rule of objectType.propertyRules) {
    const existing = groups.get(rule.psetName);
    if (existing) {
      existing.push(rule);
    } else {
      groups.set(rule.psetName, [rule]);
    }
  }
  return [...groups.entries()].map(([name, rules]) => ({ name, rules }));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
