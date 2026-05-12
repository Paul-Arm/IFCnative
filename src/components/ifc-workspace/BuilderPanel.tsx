import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";

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
import type { BodyElementDraft, CoordinateClipboard } from "./types";
import {
  Button,
  CollapsibleSection,
  DropdownField,
  EntityDropdown,
  LabeledInput,
} from "./ui";

export function BuilderPanel({
  coordinateClipboard,
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddBodyElement,
  onAssignBodyToSelected,
  onAssignType,
  onAddElement,
  onAddMaterial,
  onAddPset,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
  onLoadSystemCoordinates,
}: {
  coordinateClipboard: CoordinateClipboard | null;
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
  onAddBodyElement(options: BodyElementDraft): void;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddElement(type: string, name: string, parentId?: number): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
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
  onLoadSystemCoordinates(): Promise<CoordinateClipboard | undefined>;
}) {
  const [type, setType] = useState("IFCBUILDINGELEMENTPROXY");
  const [name, setName] = useState("Neues Element");
  const [bodyType, setBodyType] = useState("IFCBUILTELEMENT");
  const [bodyName, setBodyName] = useState("Neuer 3D-Körper");
  const [bodyWidth, setBodyWidth] = useState("4");
  const [bodyDepth, setBodyDepth] = useState("2");
  const [bodyHeight, setBodyHeight] = useState("1.5");
  const [bodyProfile, setBodyProfile] = useState<"rectangle" | "cylinder">(
    "rectangle",
  );
  const [bodyPlacementMode, setBodyPlacementMode] = useState<
    "parent" | "world"
  >("parent");
  const [bodyX, setBodyX] = useState("0");
  const [bodyY, setBodyY] = useState("0");
  const [bodyZ, setBodyZ] = useState("0");
  const [bodyTag, setBodyTag] = useState("IFCNATIVE-BODY");
  const [relType, setRelType] = useState("IFCRELAGGREGATES");
  const [sourceId, setSourceId] = useState(String(selectedId));
  const [targetId, setTargetId] = useState(String(selectedId));
  const [psetName, setPsetName] = useState("Pset_IFCnative_Custom");
  const [propertyName, setPropertyName] = useState("Status");
  const [propertyValue, setPropertyValue] = useState("Entwurf");
  const [propertyValueType, setPropertyValueType] = useState("IFCLABEL");
  const [qtoName, setQtoName] = useState("Qto_IFCnative_BaseQuantities");
  const [quantityName, setQuantityName] = useState("ErfassteLaenge");
  const [quantityValue, setQuantityValue] = useState("1");
  const [quantityType, setQuantityType] = useState("IFCQUANTITYLENGTH");
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
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));
  const canAssignBody = isBodyAssignableEntity(
    document.entityById.get(selectedId),
  );

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

  const loadCoordinateClipboard = async () => {
    if (!coordinateClipboard) {
      const systemClipboard = await onLoadSystemCoordinates();
      if (systemClipboard) {
        setBodyX(systemClipboard.x);
        setBodyY(systemClipboard.y);
        setBodyZ(systemClipboard.z);
        setBodyPlacementMode("world");
      }
      return;
    }
    setBodyX(coordinateClipboard.x);
    setBodyY(coordinateClipboard.y);
    setBodyZ(coordinateClipboard.z);
    setBodyPlacementMode("world");
  };

  const bodyDraft: BodyElementDraft = {
    depth: bodyDepth,
    height: bodyHeight,
    name: bodyName,
    placementMode: bodyPlacementMode,
    profile: bodyProfile,
    tag: bodyTag,
    type: bodyType,
    width: bodyWidth,
    x: bodyX,
    y: bodyY,
    z: bodyZ,
  };

  return (
    <ScrollView style={styles.panelScroll}>
      <CollapsibleSection
        defaultOpen
        title="Element"
        meta={`${shortIfc(type)} unter #${selectedId}`}
      >
        <DropdownField
          label="Elementklasse"
          options={ENTITY_TYPES}
          value={type}
          onChange={setType}
        />
        <LabeledInput label="Elementname" value={name} onChangeText={setName} />
        <Button
          label="+ Element unter Auswahl anlegen"
          primary
          onPress={() => onAddElement(type, name, selectedId)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title="3D-Körper"
        meta={`${bodyProfile === "cylinder" ? "Zylinder" : "Rechteck"} ${bodyWidth} x ${bodyDepth} x ${bodyHeight}`}
      >
        <View style={styles.row}>
          <View style={styles.flexField}>
            <DropdownField
              label="Körperklasse"
              options={ENTITY_TYPES}
              value={bodyType}
              onChange={setBodyType}
            />
          </View>
          <View style={styles.flexField}>
            <DropdownField
              label="Profil"
              options={[
                { label: "Rechteck", value: "rectangle" },
                { label: "Zylinder", value: "cylinder" },
              ]}
              value={bodyProfile}
              onChange={(value) =>
                setBodyProfile(value as "rectangle" | "cylinder")
              }
            />
          </View>
        </View>
        <LabeledInput
          label="Körpername"
          value={bodyName}
          onChangeText={setBodyName}
        />
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser X" : "Breite X"}
              keyboardType="numeric"
              value={bodyWidth}
              onChangeText={setBodyWidth}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser Y" : "Tiefe Y"}
              keyboardType="numeric"
              value={bodyDepth}
              onChangeText={setBodyDepth}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Höhe Z"
              keyboardType="numeric"
              value={bodyHeight}
              onChangeText={setBodyHeight}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="X"
              keyboardType="numeric"
              value={bodyX}
              onChangeText={setBodyX}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Y"
              keyboardType="numeric"
              value={bodyY}
              onChangeText={setBodyY}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={bodyZ}
              onChangeText={setBodyZ}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Kennzeichen"
              value={bodyTag}
              onChangeText={setBodyTag}
            />
          </View>
          <View style={styles.flexField}>
            <DropdownField
              label="Spawn-Bezug"
              options={[
                {
                  detail: "XYZ relativ zur Auswahl",
                  label: "Relativ zur Auswahl",
                  value: "parent",
                },
                {
                  detail: "Picker-Koordinaten",
                  label: "Weltkoordinaten",
                  value: "world",
                },
              ]}
              value={bodyPlacementMode}
              onChange={(value) =>
                setBodyPlacementMode(value as "parent" | "world")
              }
            />
          </View>
        </View>
        <View style={styles.editBlock}>
          <Text style={styles.infoTitle}>Koordinaten-Zwischenablage</Text>
          <Text style={styles.empty}>
            {coordinateClipboard
              ? `X ${coordinateClipboard.x}, Y ${coordinateClipboard.y}, Z ${coordinateClipboard.z} (${coordinateClipboard.copiedAt})`
              : "Noch keine Koordinaten aus dem 3D-Viewer übernommen."}
          </Text>
          <Button
            label={
              coordinateClipboard
                ? "Koordinaten in Körper laden"
                : "Koordinaten aus Zwischenablage lesen"
            }
            onPress={() => void loadCoordinateClipboard()}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <Button
              label={
                bodyProfile === "cylinder"
                  ? "+ Zylinder anlegen"
                  : "+ Rechteck anlegen"
              }
              primary
              onPress={() =>
                onAddBodyElement({ ...bodyDraft, parentId: selectedId })
              }
            />
          </View>
          <View style={styles.flexField}>
            <Button
              disabled={!canAssignBody}
              label="Der Auswahl zuweisen"
              onPress={() => onAssignBodyToSelected(bodyDraft)}
            />
          </View>
        </View>
      </CollapsibleSection>

      <CollapsibleSection title="Beziehung" meta={shortIfc(relType)}>
        <DropdownField
          label="Beziehung"
          options={RELATION_TYPES}
          value={relType}
          onChange={setRelType}
        />
        <View style={styles.row}>
          <View style={styles.flexField}>
            <EntityDropdown
              label="Quellobjekt"
              document={document}
              value={sourceId}
              onChange={setSourceId}
            />
          </View>
          <View style={styles.flexField}>
            <EntityDropdown
              label="Zielobjekt"
              document={document}
              value={targetId}
              onChange={setTargetId}
            />
          </View>
        </View>
        <Button
          disabled={!validSource || !validTarget}
          label="+ Beziehung anlegen"
          onPress={() =>
            onAddRelationship(relType, Number(sourceId), Number(targetId))
          }
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Pset und Menge"
        meta={`${propertyName}, ${quantityName}`}
      >
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Pset"
              value={psetName}
              onChangeText={setPsetName}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Eigenschaft"
              value={propertyName}
              onChangeText={setPropertyName}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <DropdownField
              label="Werttyp"
              options={PROPERTY_VALUE_TYPES}
              value={propertyValueType}
              onChange={setPropertyValueType}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Wert"
              value={propertyValue}
              onChangeText={setPropertyValue}
            />
          </View>
        </View>
        <Button
          label="+ Pset zur Auswahl hinzufügen"
          onPress={() =>
            onAddPset(psetName, propertyName, propertyValue, propertyValueType)
          }
        />
        <View style={styles.separator} />
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput label="QTO" value={qtoName} onChangeText={setQtoName} />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Menge"
              value={quantityName}
              onChangeText={setQuantityName}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <DropdownField
              label="Mengentyp"
              options={QUANTITY_TYPES}
              value={quantityType}
              onChange={setQuantityType}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Mengenwert"
              keyboardType="numeric"
              value={quantityValue}
              onChangeText={setQuantityValue}
            />
          </View>
        </View>
        <Button
          label="+ Menge zur Auswahl hinzufügen"
          onPress={() =>
            onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
          }
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Ressourcen"
        meta={`${materialName}, ${typeName}`}
      >
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Material"
              value={materialName}
              onChangeText={setMaterialName}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Materialkategorie"
              value={materialCategory}
              onChangeText={setMaterialCategory}
            />
          </View>
        </View>
        <Button
          label="+ Material zur Auswahl hinzufügen"
          onPress={() => onAddMaterial(materialName, materialCategory)}
        />
        <View style={styles.separator} />
        <DropdownField
          label="Typklasse"
          options={TYPE_CLASSES}
          value={typeClass}
          onChange={setTypeClass}
        />
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Typname"
              value={typeName}
              onChangeText={setTypeName}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Typ-Tag"
              value={typeTag}
              onChangeText={setTypeTag}
            />
          </View>
        </View>
        <Button
          label="+ Typ der Auswahl zuweisen"
          onPress={() => onAssignType(typeName, typeClass, typeTag)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Referenzen"
        meta={`${classificationId}, ${documentId}`}
      >
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Klassifikations-ID"
              value={classificationId}
              onChangeText={setClassificationId}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Klassifikationsname"
              value={classificationName}
              onChangeText={setClassificationName}
            />
          </View>
        </View>
        <LabeledInput
          label="Klassifikations-URI"
          value={classificationUri}
          onChangeText={setClassificationUri}
        />
        <Button
          label="+ Klassifikation hinzufügen"
          onPress={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
        <View style={styles.separator} />
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="Dokument-ID"
              value={documentId}
              onChangeText={setDocumentId}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Dokumentname"
              value={documentName}
              onChangeText={setDocumentName}
            />
          </View>
        </View>
        <LabeledInput
          label="Dokument-URI"
          value={documentUri}
          onChangeText={setDocumentUri}
        />
        <Button
          label="+ Dokument hinzufügen"
          onPress={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </CollapsibleSection>

      <CollapsibleSection title="Einheiten" meta={`${unitType}: ${unitName}`}>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <DropdownField
              label="Einheitentyp"
              options={UNIT_TYPES}
              value={unitType}
              onChange={setUnitType}
            />
          </View>
          <View style={styles.flexField}>
            <DropdownField
              label="Einheitenname"
              options={UNIT_NAMES}
              value={unitName}
              onChange={setUnitName}
            />
          </View>
        </View>
        <Button
          label="+ Einheit hinzufügen"
          onPress={() => onAddUnit(unitType, unitName)}
        />
      </CollapsibleSection>

      <Text style={styles.empty}>
        Aktuelle Auswahl: #{selectedId}{" "}
        {document.entityById.get(selectedId)?.type}
      </Text>
    </ScrollView>
  );
}

function isBodyAssignableEntity(entity?: NativeIfcEntity) {
  return (
    Boolean(entity) &&
    !entity?.type.startsWith("IFCREL") &&
    !entity?.type.startsWith("IFCPROPERTY") &&
    !entity?.type.startsWith("IFCQUANTITY") &&
    ![
      "IFCPROJECT",
      "IFCOWNERHISTORY",
      "IFCAPPLICATION",
      "IFCUNITASSIGNMENT",
      "IFCSIUNIT",
    ].includes(entity?.type ?? "") &&
    (entity?.args.length ?? 0) >= 7
  );
}

function shortIfc(value: string) {
  return value.replace(/^IFC/i, "");
}
