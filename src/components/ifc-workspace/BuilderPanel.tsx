import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
    relationshipTypesForEntities,
    viewerWorldPointToIfcPlacementPoint,
    type NativeIfcDocument,
    type NativeIfcEntity,
} from "@/ifc";

import {
    CONSTRAINT_GRADES,
    ENTITY_TYPES,
    GROUP_TYPES,
    OBJECTIVE_QUALIFIERS,
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
    ColorInput,
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
  onAddApproval,
  onAddClassification,
  onAddConstraint,
  onAddDocumentReference,
  onAddGroupAssignment,
  onAddLibraryReference,
  onAddBodyElement,
  onAssignBodyToSelected,
  onAssignType,
  onAddElement,
  onAddMaterial,
  onAddMaterialConstituentSet,
  onAddMaterialLayerSet,
  onAddMaterialLayerSetUsage,
  onAddMaterialProfileSet,
  onAddMaterialProfileSetUsage,
  onAddMaterialStyle,
  onAddMaterialWithProperties,
  onAddPset,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
  onLoadSystemCoordinates,
}: {
  coordinateClipboard: CoordinateClipboard | null;
  document: NativeIfcDocument;
  selectedId: number;
  onAddApproval(identifier: string, name: string, status: string): void;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddConstraint(
    name: string,
    grade: string,
    source: string,
    qualifier: string,
    intent: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddGroupAssignment(
    groupType: string,
    groupName: string,
    objectType: string,
    longName: string,
  ): void;
  onAddLibraryReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddBodyElement(options: BodyElementDraft): void;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddElement(type: string, name: string, parentId?: number): void;
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
  const [materialPropertySetName, setMaterialPropertySetName] =
    useState("Pset_MaterialCommon");
  const [materialPropertyRows, setMaterialPropertyRows] = useState(
    "MassDensity | 2400 | IFCREAL\nThermalConductivity | 1.7 | IFCREAL",
  );
  const [materialStyleName, setMaterialStyleName] = useState(
    "IFCnative Surface Style",
  );
  const [materialColor, setMaterialColor] = useState("#8ea7c2");
  const [materialTransparency, setMaterialTransparency] = useState("0");
  const [layerSetName, setLayerSetName] = useState("Wall Layer Set");
  const [layerRows, setLayerRows] = useState(
    "Core | Concrete | 0.2 | LoadBearing\nInsulation | Mineral wool | 0.08 | Insulation",
  );
  const [layerDirection, setLayerDirection] = useState("AXIS2");
  const [layerDirectionSense, setLayerDirectionSense] = useState("POSITIVE");
  const [layerOffset, setLayerOffset] = useState("0");
  const [layerReferenceExtent, setLayerReferenceExtent] = useState("");
  const [profileSetName, setProfileSetName] = useState("Beam Profile Set");
  const [profileName, setProfileName] = useState("Rectangular Profile");
  const [profileMaterialName, setProfileMaterialName] = useState("Steel");
  const [profileMaterialCategory, setProfileMaterialCategory] =
    useState("LoadBearing");
  const [profileWidth, setProfileWidth] = useState("0.2");
  const [profileDepth, setProfileDepth] = useState("0.3");
  const [profileCardinalPoint, setProfileCardinalPoint] = useState("5");
  const [profileReferenceExtent, setProfileReferenceExtent] = useState("");
  const [constituentSetName, setConstituentSetName] = useState(
    "Window Constituent Set",
  );
  const [constituentRows, setConstituentRows] = useState(
    "Frame | Aluminium | 0.6 | Frame\nGlazing | Glass | 0.4 | Glazing",
  );
  const [groupType, setGroupType] = useState("IFCZONE");
  const [groupName, setGroupName] = useState("Brandschutzbereich A");
  const [groupObjectType, setGroupObjectType] = useState("Fire compartment");
  const [groupLongName, setGroupLongName] = useState(
    "Brandschutzbereich Ebene 1",
  );
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
  const [libraryId, setLibraryId] = useState("LIB-INSPECTION");
  const [libraryName, setLibraryName] = useState("Inspektionsbibliothek");
  const [libraryUri, setLibraryUri] = useState(
    "https://ifcnative.local/library/inspection",
  );
  const [approvalId, setApprovalId] = useState("APP-INSPECTION");
  const [approvalName, setApprovalName] = useState("Pruefung freigegeben");
  const [approvalStatus, setApprovalStatus] = useState("Approved");
  const [constraintName, setConstraintName] = useState(
    "Objektanforderung erfuellen",
  );
  const [constraintGrade, setConstraintGrade] = useState("HARD");
  const [constraintSource, setConstraintSource] = useState("IFCnative");
  const [constraintQualifier, setConstraintQualifier] =
    useState("REQUIREMENT");
  const [constraintIntent, setConstraintIntent] = useState(
    "EXPECTED PERFORMANCE",
  );
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
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
  const canAssignBody = isBodyAssignableEntity(
    document.entityById.get(selectedId),
  );

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
          options={relationshipTypeOptions}
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
        {!relationshipTypeOptions.length ? (
          <HintLine>
            Keine gueltige Beziehung fuer diese Quell-/Zielklasse.
          </HintLine>
        ) : null}
        <Button
          disabled={!canCreateRelationship}
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
        <FormRow>
          <FormField>
            <LabeledInput
              label="Material-Pset"
              value={materialPropertySetName}
              onChangeText={setMaterialPropertySetName}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Material mit Eigenschaften"
              onPress={() =>
                onAddMaterialWithProperties(
                  materialName,
                  materialCategory,
                  materialPropertySetName,
                  materialPropertyRows,
                )
              }
            />
          </FormField>
        </FormRow>
        <LabeledInput
          label="Materialeigenschaft: Name | Wert | IFC-Typ"
          multiline
          mono
          value={materialPropertyRows}
          onChangeText={setMaterialPropertyRows}
        />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Material-Stil"
              value={materialStyleName}
              onChangeText={setMaterialStyleName}
            />
          </FormField>
          <FormField>
            <ColorInput
              label="Farbe"
              value={materialColor}
              onChangeText={setMaterialColor}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Transparenz 0..1"
              keyboardType="numeric"
              value={materialTransparency}
              onChangeText={setMaterialTransparency}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Materialdarstellung"
          onPress={() =>
            onAddMaterialStyle(
              materialName,
              materialCategory,
              materialStyleName,
              materialColor,
              materialTransparency,
            )
          }
        />
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Layer-Set"
              value={layerSetName}
              onChangeText={setLayerSetName}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Material-Layer-Set"
              onPress={() => onAddMaterialLayerSet(layerSetName, layerRows)}
            />
          </FormField>
        </FormRow>
        <LabeledInput
          label="Layer: Name | Material | Dicke | Kategorie"
          multiline
          mono
          value={layerRows}
          onChangeText={setLayerRows}
        />
        <FormRow>
          <FormField>
            <DropdownField
              label="Layer-Richtung"
              options={["AXIS1", "AXIS2", "AXIS3"]}
              value={layerDirection}
              onChange={setLayerDirection}
            />
          </FormField>
          <FormField>
            <DropdownField
              label="DirectionSense"
              options={["POSITIVE", "NEGATIVE"]}
              value={layerDirectionSense}
              onChange={setLayerDirectionSense}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Offset"
              keyboardType="numeric"
              value={layerOffset}
              onChangeText={setLayerOffset}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="ReferenceExtent"
              keyboardType="numeric"
              value={layerReferenceExtent}
              onChangeText={setLayerReferenceExtent}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Layer-Set-Usage"
              onPress={() =>
                onAddMaterialLayerSetUsage(
                  layerSetName,
                  layerRows,
                  layerDirection,
                  layerDirectionSense,
                  layerOffset,
                  layerReferenceExtent,
                )
              }
            />
          </FormField>
        </FormRow>
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Profile-Set"
              value={profileSetName}
              onChangeText={setProfileSetName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Profilname"
              value={profileName}
              onChangeText={setProfileName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Profilmaterial"
              value={profileMaterialName}
              onChangeText={setProfileMaterialName}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="Profilkategorie"
              value={profileMaterialCategory}
              onChangeText={setProfileMaterialCategory}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="XDim"
              keyboardType="numeric"
              value={profileWidth}
              onChangeText={setProfileWidth}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="YDim"
              keyboardType="numeric"
              value={profileDepth}
              onChangeText={setProfileDepth}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Material-Profile-Set"
          onPress={() =>
            onAddMaterialProfileSet(
              profileSetName,
              profileName,
              profileMaterialName,
              profileMaterialCategory,
              profileWidth,
              profileDepth,
            )
          }
        />
        <FormRow>
          <FormField>
            <LabeledInput
              label="CardinalPoint"
              keyboardType="numeric"
              value={profileCardinalPoint}
              onChangeText={setProfileCardinalPoint}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="ReferenceExtent"
              keyboardType="numeric"
              value={profileReferenceExtent}
              onChangeText={setProfileReferenceExtent}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Profile-Set-Usage"
              onPress={() =>
                onAddMaterialProfileSetUsage(
                  profileSetName,
                  profileName,
                  profileMaterialName,
                  profileMaterialCategory,
                  profileWidth,
                  profileDepth,
                  profileCardinalPoint,
                  profileReferenceExtent,
                )
              }
            />
          </FormField>
        </FormRow>
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Constituent-Set"
              value={constituentSetName}
              onChangeText={setConstituentSetName}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Material-Constituent-Set"
              onPress={() =>
                onAddMaterialConstituentSet(
                  constituentSetName,
                  constituentRows,
                )
              }
            />
          </FormField>
        </FormRow>
        <LabeledInput
          label="Constituent: Name | Material | Anteil | Kategorie"
          multiline
          mono
          value={constituentRows}
          onChangeText={setConstituentRows}
        />
        <Separator />
        <FormRow>
          <FormField>
            <DropdownField
              label="Gruppentyp"
              options={GROUP_TYPES}
              value={groupType}
              onChange={setGroupType}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Gruppenname"
              value={groupName}
              onChangeText={setGroupName}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="ObjectType"
              value={groupObjectType}
              onChangeText={setGroupObjectType}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="LongName"
              value={groupLongName}
              onChangeText={setGroupLongName}
            />
          </FormField>
          <FormField>
            <Button
              label="+ Gruppe/Zone/System"
              onPress={() =>
                onAddGroupAssignment(
                  groupType,
                  groupName,
                  groupObjectType,
                  groupLongName,
                )
              }
            />
          </FormField>
        </FormRow>
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
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Bibliotheks-ID"
              value={libraryId}
              onChangeText={setLibraryId}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Bibliotheksname"
              value={libraryName}
              onChangeText={setLibraryName}
            />
          </FormField>
        </FormRow>
        <LabeledInput
          label="Bibliotheks-URI"
          value={libraryUri}
          onChangeText={setLibraryUri}
        />
        <Button
          label="+ Bibliothek hinzufuegen"
          onPress={() =>
            onAddLibraryReference(libraryId, libraryName, libraryUri)
          }
        />
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Approval-ID"
              value={approvalId}
              onChangeText={setApprovalId}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Approval-Name"
              value={approvalName}
              onChangeText={setApprovalName}
            />
          </FormField>
        </FormRow>
        <LabeledInput
          label="Approval-Status"
          value={approvalStatus}
          onChangeText={setApprovalStatus}
        />
        <Button
          label="+ Approval hinzufuegen"
          onPress={() => onAddApproval(approvalId, approvalName, approvalStatus)}
        />
        <Separator />
        <FormRow>
          <FormField>
            <LabeledInput
              label="Constraint"
              value={constraintName}
              onChangeText={setConstraintName}
            />
          </FormField>
          <FormField>
            <DropdownField
              label="Constraint-Grade"
              options={CONSTRAINT_GRADES}
              value={constraintGrade}
              onChange={setConstraintGrade}
            />
          </FormField>
          <FormField>
            <DropdownField
              label="Objective"
              options={OBJECTIVE_QUALIFIERS}
              value={constraintQualifier}
              onChange={setConstraintQualifier}
            />
          </FormField>
        </FormRow>
        <FormRow>
          <FormField>
            <LabeledInput
              label="Constraint-Quelle"
              value={constraintSource}
              onChangeText={setConstraintSource}
            />
          </FormField>
          <FormField>
            <LabeledInput
              label="Constraint-Intent"
              value={constraintIntent}
              onChangeText={setConstraintIntent}
            />
          </FormField>
        </FormRow>
        <Button
          label="+ Constraint hinzufuegen"
          onPress={() =>
            onAddConstraint(
              constraintName,
              constraintGrade,
              constraintSource,
              constraintQualifier,
              constraintIntent,
            )
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

function HintLine({ children }: { children: ReactNode }) {
  return <div className="text-xs leading-5 text-muted-foreground">{children}</div>;
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
