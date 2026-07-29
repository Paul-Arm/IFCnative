import { Plus } from "lucide-react";
import { useState } from "react";

import { type NativeIfcDocument } from "@/ifc";

import { GROUP_TYPES, TYPE_CLASSES } from "../constants";
import {
  Button,
  CollapsibleSection,
  ColorInput,
  DropdownField,
  InfoSection,
} from "../ui";
import {
  CappedItems,
  ResponsiveField,
  ResponsiveRow,
  TextField,
  TextLine,
} from "./shared";

/* ------------------------------------------------------------------ */
/* Ressourcen-Formulare (Material, Typ, Gruppe)                        */
/* ------------------------------------------------------------------ */

export function ResourceSections({
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
  onAssignType(typeName: string, typeClass: string, tag: string): void;
}) {
  const resources = document.resourcesByEntity.get(selectedId) ?? [];
  const typeAssignments =
    document.typeAssignmentsByEntity.get(selectedId) ?? [];
  const [materialName, setMaterialName] = useState("");
  const [materialCategory, setMaterialCategory] = useState("");
  const [materialPropertySetName, setMaterialPropertySetName] = useState("");
  const [materialPropertyRows, setMaterialPropertyRows] = useState("");
  const [materialStyleName, setMaterialStyleName] = useState("");
  const [materialColor, setMaterialColor] = useState("#8ea7c2");
  const [materialTransparency, setMaterialTransparency] = useState("0");
  const [layerSetName, setLayerSetName] = useState("");
  const [layerRows, setLayerRows] = useState("");
  const [layerDirection, setLayerDirection] = useState("AXIS2");
  const [layerDirectionSense, setLayerDirectionSense] = useState("POSITIVE");
  const [layerOffset, setLayerOffset] = useState("0");
  const [layerReferenceExtent, setLayerReferenceExtent] = useState("");
  const [profileSetName, setProfileSetName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMaterialName, setProfileMaterialName] = useState("");
  const [profileMaterialCategory, setProfileMaterialCategory] = useState("");
  const [profileWidth, setProfileWidth] = useState("0.2");
  const [profileDepth, setProfileDepth] = useState("0.3");
  const [profileCardinalPoint, setProfileCardinalPoint] = useState("5");
  const [profileReferenceExtent, setProfileReferenceExtent] = useState("");
  const [constituentSetName, setConstituentSetName] = useState("");
  const [constituentRows, setConstituentRows] = useState("");
  const [groupType, setGroupType] = useState("IFCZONE");
  const [groupName, setGroupName] = useState("");
  const [groupObjectType, setGroupObjectType] = useState("");
  const [groupLongName, setGroupLongName] = useState("");
  const [typeClass, setTypeClass] = useState("IFCTYPEOBJECT");
  const [typeName, setTypeName] = useState("");
  const [typeTag, setTypeTag] = useState("");

  return (
    <>
      <InfoSection title="Verknüpfte Ressourcen">
        {resources.length ? (
          <CappedItems
            items={resources}
            limit={20}
            renderItem={(resource, index) => (
              <div
                key={`${resource}-${index}`}
                className="truncate rounded-md bg-muted/30 px-2 py-1 text-xs text-foreground"
                title={resource}
              >
                {resource}
              </div>
            )}
          />
        ) : (
          <TextLine>
            Kein Material, keine Klassifikation und kein Dokument verknüpft.
          </TextLine>
        )}
      </InfoSection>
      <InfoSection title="Typzuweisungen">
        {typeAssignments.length ? (
          <CappedItems
            items={typeAssignments}
            limit={20}
            renderItem={(assignment) => (
              <div
                key={`${assignment.relationshipId}-${assignment.typeId}`}
                className="truncate rounded-md bg-muted/30 px-2 py-1 text-xs text-foreground"
              >
                #{assignment.relationshipId} → #{assignment.typeId}{" "}
                {assignment.typeClass} {assignment.typeName}
              </div>
            )}
          />
        ) : (
          <TextLine>Keine IFCRELDEFINESBYTYPE-Zuweisung.</TextLine>
        )}
      </InfoSection>

      <CollapsibleSection title="Typ zuweisen" meta="IFCRELDEFINESBYTYPE">
        <DropdownField
          label="Typklasse"
          options={TYPE_CLASSES}
          value={typeClass}
          onChange={setTypeClass}
        />
        <TextField
          label="Typname"
          placeholder="z. B. Wandtyp WD-01"
          value={typeName}
          onChangeText={setTypeName}
        />
        <TextField
          label="Tag"
          placeholder="z. B. TYP-001"
          value={typeTag}
          onChangeText={setTypeTag}
        />
        <Button
          variant="default"
          onClick={() => onAssignType(typeName, typeClass, typeTag)}
        >
          <Plus aria-hidden className="size-3.5" /> Typ zuweisen
        </Button>
      </CollapsibleSection>

      <CollapsibleSection
        title="Material"
        meta="Material, Eigenschaften & Oberflächenstil"
      >
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Material"
              placeholder="z. B. Beton C25/30"
              value={materialName}
              onChangeText={setMaterialName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Kategorie"
              placeholder="z. B. Beton"
              value={materialCategory}
              onChangeText={setMaterialCategory}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          variant="default"
          onClick={() => onAddMaterial(materialName, materialCategory)}
        >
          <Plus aria-hidden className="size-3.5" /> Material hinzufügen
        </Button>
        <TextField
          label="Material-Eigenschaftssatz"
          placeholder="z. B. Pset_MaterialCommon"
          value={materialPropertySetName}
          onChangeText={setMaterialPropertySetName}
        />
        <TextField
          label="Name | Wert | IFC-Typ"
          multiline
          mono
          placeholder={
            "MassDensity | 2400 | IFCREAL\nThermalConductivity | 1.7 | IFCREAL"
          }
          value={materialPropertyRows}
          onChangeText={setMaterialPropertyRows}
        />
        <Button
          variant="outline"
          onClick={() =>
            onAddMaterialWithProperties(
              materialName,
              materialCategory,
              materialPropertySetName,
              materialPropertyRows,
            )
          }
        >
          <Plus aria-hidden className="size-3.5" /> Materialeigenschaften
          hinzufügen
        </Button>
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Materialstil"
              placeholder="z. B. Sichtbeton"
              value={materialStyleName}
              onChangeText={setMaterialStyleName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <ColorInput
              label="Farbe"
              value={materialColor}
              onChangeText={setMaterialColor}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Transparenz 0..1"
              keyboardType="numeric"
              value={materialTransparency}
              onChangeText={setMaterialTransparency}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          variant="outline"
          onClick={() =>
            onAddMaterialStyle(
              materialName,
              materialCategory,
              materialStyleName,
              materialColor,
              materialTransparency,
            )
          }
        >
          <Plus aria-hidden className="size-3.5" /> Materialstil hinzufügen
        </Button>
      </CollapsibleSection>

      <CollapsibleSection
        title="Material-Schichten"
        meta="Layer Set & Layer Usage"
      >
        <TextField
          label="Set-Name"
          placeholder="z. B. Wandaufbau"
          value={layerSetName}
          onChangeText={setLayerSetName}
        />
        <TextField
          label="Name | Material | Dicke | Kategorie"
          multiline
          mono
          placeholder={
            "Kern | Beton | 0.2 | LoadBearing\nDämmung | Mineralwolle | 0.08 | Insulation"
          }
          value={layerRows}
          onChangeText={setLayerRows}
        />
        <Button
          variant="outline"
          onClick={() => onAddMaterialLayerSet(layerSetName, layerRows)}
        >
          <Plus aria-hidden className="size-3.5" /> Layer Set hinzufügen
        </Button>
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Richtung"
              options={["AXIS1", "AXIS2", "AXIS3"]}
              value={layerDirection}
              onChange={setLayerDirection}
            />
          </ResponsiveField>
          <ResponsiveField>
            <DropdownField
              label="Richtungssinn"
              options={["POSITIVE", "NEGATIVE"]}
              value={layerDirectionSense}
              onChange={setLayerDirectionSense}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Offset"
              keyboardType="numeric"
              value={layerOffset}
              onChangeText={setLayerOffset}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Reference extent"
              keyboardType="numeric"
              value={layerReferenceExtent}
              onChangeText={setLayerReferenceExtent}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          variant="outline"
          onClick={() =>
            onAddMaterialLayerSetUsage(
              layerSetName,
              layerRows,
              layerDirection,
              layerDirectionSense,
              layerOffset,
              layerReferenceExtent,
            )
          }
        >
          <Plus aria-hidden className="size-3.5" /> Layer Usage hinzufügen
        </Button>
      </CollapsibleSection>

      <CollapsibleSection
        title="Material-Profile"
        meta="Profile Set & Profile Usage"
      >
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Set-Name"
              placeholder="z. B. Trägerprofile"
              value={profileSetName}
              onChangeText={setProfileSetName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Profil"
              placeholder="z. B. Rechteckprofil"
              value={profileName}
              onChangeText={setProfileName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Material"
              placeholder="z. B. Stahl"
              value={profileMaterialName}
              onChangeText={setProfileMaterialName}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Kategorie"
              placeholder="z. B. LoadBearing"
              value={profileMaterialCategory}
              onChangeText={setProfileMaterialCategory}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="XDim"
              keyboardType="numeric"
              value={profileWidth}
              onChangeText={setProfileWidth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="YDim"
              keyboardType="numeric"
              value={profileDepth}
              onChangeText={setProfileDepth}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          variant="outline"
          onClick={() =>
            onAddMaterialProfileSet(
              profileSetName,
              profileName,
              profileMaterialName,
              profileMaterialCategory,
              profileWidth,
              profileDepth,
            )
          }
        >
          <Plus aria-hidden className="size-3.5" /> Profile Set hinzufügen
        </Button>
        <ResponsiveRow>
          <ResponsiveField>
            <TextField
              label="Cardinal point"
              keyboardType="numeric"
              value={profileCardinalPoint}
              onChangeText={setProfileCardinalPoint}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Reference extent"
              keyboardType="numeric"
              value={profileReferenceExtent}
              onChangeText={setProfileReferenceExtent}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          variant="outline"
          onClick={() =>
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
        >
          <Plus aria-hidden className="size-3.5" /> Profile Usage hinzufügen
        </Button>
      </CollapsibleSection>

      <CollapsibleSection title="Material-Bestandteile" meta="Constituent Set">
        <TextField
          label="Set-Name"
          placeholder="z. B. Fensteraufbau"
          value={constituentSetName}
          onChangeText={setConstituentSetName}
        />
        <TextField
          label="Name | Material | Anteil | Kategorie"
          multiline
          mono
          placeholder={
            "Rahmen | Aluminium | 0.6 | Frame\nVerglasung | Glas | 0.4 | Glazing"
          }
          value={constituentRows}
          onChangeText={setConstituentRows}
        />
        <Button
          variant="outline"
          onClick={() =>
            onAddMaterialConstituentSet(constituentSetName, constituentRows)
          }
        >
          <Plus aria-hidden className="size-3.5" /> Constituent Set hinzufügen
        </Button>
      </CollapsibleSection>

      <CollapsibleSection
        title="Gruppe / Zone / System"
        meta="IFCRELASSIGNSTOGROUP"
      >
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Gruppentyp"
              options={GROUP_TYPES}
              value={groupType}
              onChange={setGroupType}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="Gruppenname"
              placeholder="z. B. Brandabschnitt A"
              value={groupName}
              onChangeText={setGroupName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <TextField
              label="ObjectType"
              placeholder="z. B. Brandabschnitt"
              value={groupObjectType}
              onChangeText={setGroupObjectType}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <TextField
          label="LongName"
          placeholder="z. B. Brandabschnitt Ebene 1"
          value={groupLongName}
          onChangeText={setGroupLongName}
        />
        <Button
          variant="default"
          onClick={() =>
            onAddGroupAssignment(
              groupType,
              groupName,
              groupObjectType,
              groupLongName,
            )
          }
        >
          <Plus aria-hidden className="size-3.5" /> Gruppe zuweisen
        </Button>
      </CollapsibleSection>
    </>
  );
}
