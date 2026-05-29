import { useEffect, useState } from "react";

import {
    viewerWorldPointToIfcPlacementPoint,
    type NativeIfcDocument,
    type NativeIfcEntity,
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
import type { BodyElementDraft, CoordinateClipboard } from "./types";
import {
    Badge,
    Button,
    CollapsibleSection,
    DropdownField,
    EntityDropdown,
    LabeledInput,
    PanelHeader,
    PanelShell,
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
        const placement = coordinateClipboardToIfcPlacement(systemClipboard);
        setBodyX(placement.x);
        setBodyY(placement.y);
        setBodyZ(placement.z);
        setBodyPlacementMode("world");
      }
      return;
    }
    const placement = coordinateClipboardToIfcPlacement(coordinateClipboard);
    setBodyX(placement.x);
    setBodyY(placement.y);
    setBodyZ(placement.z);
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
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Builder"
        description="Elemente, Koerper, Psets, Ressourcen und Relationen anlegen"
        meta={
          <Badge tone={canAssignBody ? "success" : "neutral"}>IFC Edit</Badge>
        }
      />
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
        <FormRow>
          <FormField>
            <DropdownField
              label="Körperklasse"
              options={ENTITY_TYPES}
              value={bodyType}
              onChange={setBodyType}
            />
          </FormField>
          <FormField>
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
          </FormField>
        </FormRow>
        <LabeledInput
          label="Körpername"
          value={bodyName}
          onChangeText={setBodyName}
        />
        <FormRow>
          <FormField>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser X" : "Breite X"}
              keyboardType="numeric"
              value={bodyWidth}
              onChangeText={setBodyWidth}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label={bodyProfile === "cylinder" ? "Durchmesser Y" : "Tiefe Y"}
              keyboardType="numeric"
              value={bodyDepth}
              onChangeText={setBodyDepth}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Höhe Z"
              keyboardType="numeric"
              value={bodyHeight}
              onChangeText={setBodyHeight}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="X"
              keyboardType="numeric"
              value={bodyX}
              onChangeText={setBodyX}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Y"
              keyboardType="numeric"
              value={bodyY}
              onChangeText={setBodyY}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={bodyZ}
              onChangeText={setBodyZ}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="Kennzeichen"
              value={bodyTag}
              onChangeText={setBodyTag}
            />
          </FormField>
          <FormField>
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
          </FormField>
        </FormRow>
        <div className="grid gap-2 rounded-xl border bg-card/80 p-3">
          <h3 className="text-sm font-medium text-foreground">
            Koordinaten-Zwischenablage
          </h3>
          <p className="text-sm text-muted-foreground">
            {coordinateClipboard
              ? describeCoordinateClipboard(coordinateClipboard)
              : "Noch keine Koordinaten aus dem 3D-Viewer übernommen."}
          </p>
          <Button
            label={
              coordinateClipboard
                ? "Koordinaten in Körper laden"
                : "Koordinaten aus Zwischenablage lesen"
            }
            onPress={() => void loadCoordinateClipboard()}
          />
        </div>
        <FormRow>
          <FormField>
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
          </FormField>
          <FormField>
            <Button
              disabled={!canAssignBody}
              label="Der Auswahl zuweisen"
              onPress={() => onAssignBodyToSelected(bodyDraft)}
            />
          </FormField>
        </FormRow>
      </CollapsibleSection>

      <CollapsibleSection title="Beziehung" meta={shortIfc(relType)}>
        <DropdownField
          label="Beziehung"
          options={RELATION_TYPES}
          value={relType}
          onChange={setRelType}
        />
        <FormRow>
          <FormField>
            <EntityDropdown
              label="Quellobjekt"
              document={document}
              value={sourceId}
              onChange={setSourceId}
            />
          </FormField>
          <FormField>
            <EntityDropdown
              label="Zielobjekt"
              document={document}
              value={targetId}
              onChange={setTargetId}
            />
          </FormField>
        </FormRow>
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
        <FormRow>
          <FormField>
            <LabeledInput
              label="Pset"
              value={psetName}
              onChangeText={setPsetName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Eigenschaft"
              value={propertyName}
              onChangeText={setPropertyName}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <DropdownField
              label="Werttyp"
              options={PROPERTY_VALUE_TYPES}
              value={propertyValueType}
              onChange={setPropertyValueType}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Wert"
              value={propertyValue}
              onChangeText={setPropertyValue}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Pset zur Auswahl hinzufügen"
          onPress={() =>
            onAddPset(psetName, propertyName, propertyValue, propertyValueType)
          }
        />
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="QTO"
              value={qtoName}
              onChangeText={setQtoName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Menge"
              value={quantityName}
              onChangeText={setQuantityName}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <DropdownField
              label="Mengentyp"
              options={QUANTITY_TYPES}
              value={quantityType}
              onChange={setQuantityType}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Mengenwert"
              keyboardType="numeric"
              value={quantityValue}
              onChangeText={setQuantityValue}
            />
          </FormField>
        </FormRow>
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
        <FormRow>
          <FormField>
            <LabeledInput
              label="Material"
              value={materialName}
              onChangeText={setMaterialName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Materialkategorie"
              value={materialCategory}
              onChangeText={setMaterialCategory}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Material zur Auswahl hinzufügen"
          onPress={() => onAddMaterial(materialName, materialCategory)}
        />
        <Separator />
        <DropdownField
          label="Typklasse"
          options={TYPE_CLASSES}
          value={typeClass}
          onChange={setTypeClass}
        />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Typname"
              value={typeName}
              onChangeText={setTypeName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Typ-Tag"
              value={typeTag}
              onChangeText={setTypeTag}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Typ der Auswahl zuweisen"
          onPress={() => onAssignType(typeName, typeClass, typeTag)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Referenzen"
        meta={`${classificationId}, ${documentId}`}
      >
        <FormRow>
          <FormField>
            <LabeledInput
              label="Klassifikations-ID"
              value={classificationId}
              onChangeText={setClassificationId}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Klassifikationsname"
              value={classificationName}
              onChangeText={setClassificationName}
            />
          </FormField>
        </FormRow>
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
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Dokument-ID"
              value={documentId}
              onChangeText={setDocumentId}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Dokumentname"
              value={documentName}
              onChangeText={setDocumentName}
            />
          </FormField>
        </FormRow>
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
        <FormRow>
          <FormField>
            <DropdownField
              label="Einheitentyp"
              options={UNIT_TYPES}
              value={unitType}
              onChange={setUnitType}
            />
          </FormField>
          <FormField>
            <DropdownField
              label="Einheitenname"
              options={UNIT_NAMES}
              value={unitName}
              onChange={setUnitName}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Einheit hinzufügen"
          onPress={() => onAddUnit(unitType, unitName)}
        />
      </CollapsibleSection>

      <p className="text-sm text-muted-foreground">
        Aktuelle Auswahl: #{selectedId}{" "}
        {document.entityById.get(selectedId)?.type}
      </p>
    </PanelShell>
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

function FormRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}

function FormField({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}

function Separator() {
  return <div className="h-px bg-border" />;
}

function describeCoordinateClipboard(clipboard: CoordinateClipboard) {
  const source = clipboard.fileName ?? clipboard.source;
  const placement = coordinateClipboardToIfcPlacement(clipboard);
  if (clipboard.source !== "thatopen") {
    return `X ${clipboard.x}, Y ${clipboard.y}, Z ${clipboard.z} (${source}, ${clipboard.copiedAt})`;
  }
  return `Viewer X ${clipboard.x}, Y ${clipboard.y}, Z ${clipboard.z} -> IFC X ${placement.x}, Y ${placement.y}, Z ${placement.z} (${source}, ${clipboard.copiedAt})`;
}

function coordinateClipboardToIfcPlacement(clipboard: CoordinateClipboard) {
  if (clipboard.source !== "thatopen") {
    return {
      x: clipboard.x,
      y: clipboard.y,
      z: clipboard.z,
    };
  }
  const point = viewerWorldPointToIfcPlacementPoint({
    x: readCoordinateNumber(clipboard.x),
    y: readCoordinateNumber(clipboard.y),
    z: readCoordinateNumber(clipboard.z),
  });
  return {
    x: formatBodyCoordinate(point.x),
    y: formatBodyCoordinate(point.y),
    z: formatBodyCoordinate(point.z),
  };
}

function readCoordinateNumber(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBodyCoordinate(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function shortIfc(value: string) {
  return value.replace(/^IFC/i, "");
}
