import { Button as ShadcnButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Copy, Plus, Save, Trash2 } from "lucide-react";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentProps,
    type ReactNode,
} from "react";

import {
    catalogObjectLabel,
    getNativeBodyRepresentation,
    getNativePlacementWorld,
    ifcPlacementPointToViewerWorldPoint,
    nativeWorldToLocalPlacementPoint,
    quote,
    relationshipTypesForEntities,
    splitTopLevel,
    unquote,
    viewerWorldPointToIfcPlacementPoint,
    type CatalogObjectType,
    type CatalogPropertyRule,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
    type NativeBodyProfile,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type NativeIfcPropertySet,
    type NativeIfcRelationship,
    type ObjectInfoIndex,
    type ObjectInfoValidationFinding,
} from "@/ifc";
import { cn } from "@/lib/utils";

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
import { findTreePath } from "./StructurePanel";
import type { BodyElementDraft, EntityEditDraft, InspectorMode } from "./types";
import {
    Badge,
    Button,
    CollapsibleSection,
    ColorInput,
    DataTable,
    DataTableCell,
    DropdownField,
    EntityDropdown,
    InfoRow,
    InfoSection,
    LabeledInput,
    PanelHeader,
    PanelShell,
    SegmentedControl,
    type DataTableColumn,
} from "./ui";

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
    return <EmptyBlock>No entity selected.</EmptyBlock>;
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
      <PlacementGeometryPanel
        document={document}
        entity={entity}
        selectedId={selectedId}
        onAssignBodyToSelected={onAssignBodyToSelected}
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
    );
  }
  if (mode === "units") {
    return <UnitsPanel document={document} onAddUnit={onAddUnit} />;
  }
  return <InfoPanel document={document} entity={entity} />;
}

function EmptyBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4">
      {title ? (
        <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      ) : null}
      <div className="text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function TextLine({ children }: { children: ReactNode }) {
  return (
    <div className="text-sm leading-6 text-muted-foreground">{children}</div>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-foreground">
      <code>{children}</code>
    </pre>
  );
}

function ItemCard({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
      {children}
    </div>
  );
}

function ItemTitle({ children }: { children: ReactNode }) {
  return <div className="text-sm font-medium text-foreground">{children}</div>;
}

function ItemMeta({ children }: { children: ReactNode }) {
  return (
    <div className="truncate text-xs text-muted-foreground">{children}</div>
  );
}

function EditBlock({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-md border border-border/60 bg-card p-3">
      {title ? (
        <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function ResponsiveRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

function ResponsiveField({ children }: { children: ReactNode }) {
  return <div className="min-w-0">{children}</div>;
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
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`#${entity.id}`}
        title={entity.name || entity.type}
        description={`${entity.type} / ${sets.length.toLocaleString()} Psets / ${relationships.length.toLocaleString()} Relationen`}
        meta={<Badge tone="neutral">Info</Badge>}
      />
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
            <TextLine key={item.id}>
              #{item.id} {item.type}: {item.name || item.type}
            </TextLine>
          ))
        ) : (
          <TextLine>No spatial path.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="Resources">
        {resources.length ? (
          resources.map((item) => <TextLine key={item}>{item}</TextLine>)
        ) : (
          <TextLine>No resources linked.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="Properties / Quantities">
        {sets.length ? (
          sets.map((set) => (
            <TextLine key={set.id}>
              #{set.id} {set.kind} {set.name}:{" "}
              {set.values
                .map((value) => `${value.name}=${value.value}`)
                .join(", ")}
            </TextLine>
          ))
        ) : (
          <TextLine>No Psets or QTOs linked.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="Relationships">
        {relationships.length ? (
          relationships.map((relationship) => (
            <TextLine key={relationship.id}>
              #{relationship.id} {relationship.type}:{" "}
              {relationship.sourceIds.map((id) => `#${id}`).join(",") || "-"} -{" "}
              {relationship.targetIds.map((id) => `#${id}`).join(",") || "-"}
            </TextLine>
          ))
        ) : (
          <TextLine>No relationships indexed.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="STEP">
        <CodeBlock>
          #{entity.id}= {entity.type}({entity.args.join(",")});
        </CodeBlock>
      </InfoSection>
    </PanelShell>
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
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Objektinfo"
        description={`${definitions.length.toLocaleString()} IDs / ${outgoing.length.toLocaleString()} ausgehend / ${incoming.length.toLocaleString()} eingehend`}
        meta={
          <Badge tone={localFindings.length ? "warning" : "success"}>
            {localFindings.length} Findings
          </Badge>
        }
      />
      <InfoSection title="Objektinfo-ID">
        {definitions.length ? (
          definitions.map((definition) => (
            <ItemCard key={definition.propertyId}>
              <ItemTitle>{definition.value || "-"}</ItemTitle>
              <ItemMeta>
                #{definition.psetId} {definition.psetName} / #
                {definition.propertyId} {definition.propertyName}
              </ItemMeta>
            </ItemCard>
          ))
        ) : (
          <TextLine>
            Kein ePset_Objektinformationen._ID am ausgewaehlten Objekt.
          </TextLine>
        )}
      </InfoSection>

      <InfoSection title="Ausgehende ID-Referenzen">
        {outgoing.length ? (
          outgoing.map((reference) => {
            const target =
              reference.targetDefinitions[0]?.entityId ??
              reference.externalDefinitions[0]?.entityId;
            return (
              <ItemCard key={reference.propertyId}>
                <ItemTitle>
                  {reference.psetName}.{reference.propertyName}
                </ItemTitle>
                <TextLine>{reference.value || "-"}</TextLine>
                <ItemMeta>
                  {target
                    ? objectInfoEntityLabel(document, target)
                    : "Kein Ziel gefunden"}
                </ItemMeta>
                {target ? (
                  <Button
                    label="Ziel oeffnen"
                    onPress={() => onSelectEntity(target)}
                  />
                ) : null}
              </ItemCard>
            );
          })
        ) : (
          <TextLine>Keine ausgehenden ID-Referenzen.</TextLine>
        )}
      </InfoSection>

      <InfoSection title="Eingehende ID-Referenzen">
        {incoming.length ? (
          incoming.map((reference) => (
            <ItemCard key={reference.propertyId}>
              <ItemTitle>{reference.value || "-"}</ItemTitle>
              <TextLine>
                {reference.psetName}.{reference.propertyName}
              </TextLine>
              <ItemMeta>
                {objectInfoEntityLabel(document, reference.entityId)}
              </ItemMeta>
              <Button
                label="Quelle oeffnen"
                onPress={() => onSelectEntity(reference.entityId)}
              />
            </ItemCard>
          ))
        ) : (
          <TextLine>Keine eingehenden ID-Referenzen.</TextLine>
        )}
      </InfoSection>

      <InfoSection title="Lokale Findings">
        {localFindings.length ? (
          localFindings.map((finding) => (
            <ItemCard key={finding.id}>
              <ItemTitle>
                {finding.severity.toUpperCase()} / {finding.kind}
              </ItemTitle>
              <TextLine>{finding.message}</TextLine>
            </ItemCard>
          ))
        ) : (
          <TextLine>Keine lokalen Objektinfo-Findings.</TextLine>
        )}
      </InfoSection>
    </PanelShell>
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
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`#${entity.id}`}
        title="Entity bearbeiten"
        description={entity.type}
        meta={<Badge tone="warning">STEP</Badge>}
      />
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
    </PanelShell>
  );
}

type PlacementCoordinateSpace = "welt" | "viewer";

function formatPlacementCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function readPlacementCoordinate(value: string) {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function PlacementGeometryPanel({
  document,
  entity,
  selectedId,
  onAssignBodyToSelected,
  onMove,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
  selectedId: number;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onMove(x: string, y: string, z: string): void;
}) {
  const placement = getNativePlacementWorld(document, selectedId);
  const body = getNativeBodyRepresentation(document, selectedId);
  const [space, setSpace] = useState<PlacementCoordinateSpace>("welt");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  const [profile, setProfile] = useState<NativeBodyProfile>(
    body.profile ?? "rectangle",
  );
  const [width, setWidth] = useState(formatEditableNumber(body.width, "1"));
  const [depth, setDepth] = useState(formatEditableNumber(body.depth, "1"));
  const [height, setHeight] = useState(formatEditableNumber(body.height, "1"));

  const displayPoint = useMemo(() => {
    if (!placement) {
      return { x: 0, y: 0, z: 0 };
    }
    const world = {
      x: placement.worldX,
      y: placement.worldY,
      z: placement.worldZ,
    };
    return space === "viewer"
      ? ifcPlacementPointToViewerWorldPoint(world)
      : world;
  }, [placement?.worldX, placement?.worldY, placement?.worldZ, space]);

  useEffect(() => {
    setX(formatPlacementCoordinate(displayPoint.x));
    setY(formatPlacementCoordinate(displayPoint.y));
    setZ(formatPlacementCoordinate(displayPoint.z));
  }, [placement?.pointId, displayPoint.x, displayPoint.y, displayPoint.z]);

  useEffect(() => {
    setProfile(body.profile ?? "rectangle");
    setWidth(formatEditableNumber(body.width, "1"));
    setDepth(formatEditableNumber(body.depth ?? body.width, "1"));
    setHeight(formatEditableNumber(body.height, "1"));
  }, [
    body.bodyRepresentationId,
    body.depth,
    body.height,
    body.profile,
    body.profileId,
    body.solidId,
    body.width,
  ]);

  const applyMove = () => {
    if (!placement) {
      return;
    }
    const input = {
      x: readPlacementCoordinate(x),
      y: readPlacementCoordinate(y),
      z: readPlacementCoordinate(z),
    };
    const worldTarget =
      space === "viewer" ? viewerWorldPointToIfcPlacementPoint(input) : input;
    const local = nativeWorldToLocalPlacementPoint(
      document,
      selectedId,
      worldTarget,
    );
    if (!local) {
      return;
    }
    onMove(
      formatPlacementCoordinate(local.x),
      formatPlacementCoordinate(local.y),
      formatPlacementCoordinate(local.z),
    );
  };

  const bodyDraft: BodyElementDraft = {
    depth,
    height,
    name: entity.name || "Assigned Body",
    profile,
    type: entity.type,
    width,
    x: "0",
    y: "0",
    z: "0",
  };

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Placement & Geometrie"
        description={
          placement
            ? `Welt: ${formatPlacementCoordinate(placement.worldX)}, ${formatPlacementCoordinate(placement.worldY)}, ${formatPlacementCoordinate(placement.worldZ)}`
            : "Keine editierbare Platzierung"
        }
        meta={
          <Badge
            tone={
              body.canEdit ? "success" : body.canAssign ? "info" : "neutral"
            }
          >
            {body.canEdit
              ? "Editable"
              : body.canAssign
                ? "Assignable"
                : "Read only"}
          </Badge>
        }
      />

      {placement ? (
        <InfoSection title="Position">
          <SegmentedControl
            options={["welt", "viewer"]}
            value={space}
            onChange={(value) => setSpace(value as PlacementCoordinateSpace)}
          />
          <TextLine>
            {space === "viewer"
              ? "Viewer-Koordinaten (Y = Höhe), wie im 3D-Fenster gepickt."
              : "IFC-Weltkoordinaten (Z = Höhe), absolut im Modell."}
          </TextLine>
          <ResponsiveRow>
            <ResponsiveField>
              <LabeledInput
                label="X"
                keyboardType="numeric"
                value={x}
                onChangeText={setX}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label={space === "viewer" ? "Y (Höhe)" : "Y"}
                keyboardType="numeric"
                value={y}
                onChangeText={setY}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label={space === "viewer" ? "Z" : "Z (Höhe)"}
                keyboardType="numeric"
                value={z}
                onChangeText={setZ}
              />
            </ResponsiveField>
          </ResponsiveRow>
          <TextLine>
            Lokal
            {placement.relativeTo
              ? ` (relativ zu #${placement.relativeTo})`
              : ""}
            : {formatPlacementCoordinate(placement.x)},{" "}
            {formatPlacementCoordinate(placement.y)},{" "}
            {formatPlacementCoordinate(placement.z)}
          </TextLine>
          <Button label="Position übernehmen" primary onPress={applyMove} />
        </InfoSection>
      ) : (
        <EmptyBlock title="Keine editierbare Platzierung">
          Produkt mit IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D →
          IFCCARTESIANPOINT auswählen, um die Position zu bearbeiten.
        </EmptyBlock>
      )}

      <InfoSection title="Abmessungen">
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Profil"
              options={[
                { label: "Rechteck", value: "rectangle" },
                { label: "Zylinder", value: "cylinder" },
              ]}
              value={profile}
              onChange={(value) => setProfile(value as NativeBodyProfile)}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label={profile === "cylinder" ? "Durchmesser X" : "Breite X"}
              keyboardType="numeric"
              value={width}
              onChangeText={setWidth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label={profile === "cylinder" ? "Durchmesser Y" : "Tiefe Y"}
              keyboardType="numeric"
              value={depth}
              onChangeText={setDepth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Höhe Z"
              keyboardType="numeric"
              value={height}
              onChangeText={setHeight}
            />
          </ResponsiveField>
        </ResponsiveRow>
        {body.message ? <TextLine>{body.message}</TextLine> : null}
        <Button
          disabled={!body.canAssign}
          label={
            body.hasRepresentation
              ? "Geometrie aktualisieren"
              : "Geometrie zuweisen"
          }
          primary
          onPress={() => onAssignBodyToSelected(bodyDraft)}
        />
      </InfoSection>

      <CollapsibleSection
        title="IFC-Referenzen"
        meta={`Produkt #${selectedId} ${entity.type}`}
      >
        {placement ? (
          <>
            <InfoRow label="Placement" value={`#${placement.placementId}`} />
            <InfoRow label="Axis" value={`#${placement.axisPlacementId}`} />
            <InfoRow label="Point" value={`#${placement.pointId}`} />
            <InfoRow
              label="Relative to"
              value={placement.relativeTo ? `#${placement.relativeTo}` : "$"}
            />
          </>
        ) : (
          <InfoRow label="Placement" value="$" />
        )}
        <InfoRow
          label="Shape"
          value={body.shapeId ? `#${body.shapeId}` : "$"}
        />
        <InfoRow
          label="Body"
          value={
            body.bodyRepresentationId ? `#${body.bodyRepresentationId}` : "$"
          }
        />
        <InfoRow
          label="Solid"
          value={body.solidId ? `#${body.solidId}` : "$"}
        />
        <InfoRow
          label="Profile"
          value={
            body.profileId
              ? `#${body.profileId} ${body.profileType ?? ""}`.trim()
              : "$"
          }
        />
      </CollapsibleSection>
    </PanelShell>
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
  const [psetSearch, setPsetSearch] = useState("");
  const psetSearchInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedPsetSearch = psetSearch.trim().toLowerCase();
  const visibleSets = useMemo(
    () => filterPropertySets(sets, document, normalizedPsetSearch),
    [document, normalizedPsetSearch, sets],
  );
  const catalogRuleCount = catalogPsets.reduce(
    (total, set) => total + set.rules.length,
    0,
  );
  const catalogQuickFixes = catalogFindings.filter(
    (finding) => finding.quickFix,
  );

  useEffect(() => {
    const browserWindow = globalThis.window;
    if (!browserWindow) {
      return undefined;
    }
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "f"
      ) {
        return;
      }
      event.preventDefault();
      psetSearchInputRef.current?.focus();
    };
    browserWindow.addEventListener("keydown", handleFindShortcut);
    return () => {
      browserWindow.removeEventListener("keydown", handleFindShortcut);
    };
  }, []);

  const addSelectedPset = () => {
    if (psetSource === "catalog") {
      return;
    }
    onAddEmptyPset(emptyPsetName.trim() || "Pset_IFCnative_Custom");
  };

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Psets & Quantities"
        description={
          normalizedPsetSearch
            ? `${visibleSets.length.toLocaleString()} von ${sets.length.toLocaleString()} Sets sichtbar`
            : `${sets.length.toLocaleString()} Sets verkn\u00fcpft`
        }
        meta={<Badge tone="info">Kompakt</Badge>}
      />

      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-56 flex-1">
            <Input
              ref={psetSearchInputRef}
              className="h-8"
              placeholder="Psets, Eigenschaften, Werte suchen \u2026"
              value={psetSearch}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setPsetSearch(event.currentTarget.value)}
            />
          </div>
          <SegmentedControl
            options={["empty", "catalog"]}
            value={psetSource}
            onChange={setPsetSource}
          />
        </div>
        {psetSource === "catalog" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {catalogObject
                  ? catalogObjectLabel(catalogObject)
                  : "Keine Katalogklasse gew\u00e4hlt"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {catalogObject
                  ? `${catalogPsets.length.toLocaleString()} Psets \u00b7 ${catalogRuleCount.toLocaleString()} Regeln`
                  : "Auswahl im Objektkatalog-Panel treffen"}
              </div>
            </div>
            <ShadcnButton
              disabled={!catalogQuickFixes.length}
              size="sm"
              onClick={() => onApplyCatalogFindings(catalogQuickFixes)}
            >
              {catalogQuickFixes.length ? "Katalog anwenden" : "Katalog OK"}
            </ShadcnButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 min-w-56 flex-1"
              placeholder="Pset-Name"
              value={emptyPsetName}
              onChange={(event) => setEmptyPsetName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addSelectedPset();
                }
              }}
            />
            <ShadcnButton size="sm" onClick={addSelectedPset}>
              <Plus aria-hidden className="size-3.5" /> Pset
            </ShadcnButton>
          </div>
        )}
      </div>

      {visibleSets.length ? (
        <div className="flex flex-col gap-3">
          {visibleSets.map(({ set, values }) => (
            <PsetTableSection
              document={document}
              key={set.id}
              set={set}
              visibleValues={values}
              searchActive={!!normalizedPsetSearch}
              onAddPropertyToSet={onAddPropertyToSet}
              onDuplicatePropertySet={onDuplicatePropertySet}
              onRemovePropertyFromSet={onRemovePropertyFromSet}
              onRemovePropertySet={onRemovePropertySet}
              onRenamePropertySet={onRenamePropertySet}
              onUpdateProperty={onUpdateProperty}
            />
          ))}
        </div>
      ) : null}
      {sets.length > 0 && !visibleSets.length ? (
        <EmptyBlock title="Keine Treffer">
          Der aktuelle Pset-Filter findet keine Sets, Eigenschaften oder Werte.
        </EmptyBlock>
      ) : null}
      {!sets.length ? (
        <EmptyBlock title="Keine Psets">
          Ueber + Pset ein leeres Set oder eine Vorlage aus dem Objektkatalog
          anlegen.
        </EmptyBlock>
      ) : null}

      <CollapsibleSection title="Quantity Set" meta="QTO manuell anlegen">
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="QTO name"
              value={qtoName}
              onChangeText={setQtoName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Quantity"
              value={quantityName}
              onChangeText={setQuantityName}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Quantity type"
              options={QUANTITY_TYPES}
              value={quantityType}
              onChange={setQuantityType}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Value"
              keyboardType="numeric"
              value={quantityValue}
              onChangeText={setQuantityValue}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          label="+ Add Quantity Set"
          onPress={() =>
            onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
          }
        />
      </CollapsibleSection>
    </PanelShell>
  );
}

const PSET_TABLE_COLUMNS: DataTableColumn[] = [
  { flex: 1.1, header: "Name", key: "name", minWidth: 130 },
  { flex: 0.7, header: "Typ", key: "type", minWidth: 100 },
  { flex: 1.4, header: "Wert", key: "value", minWidth: 130 },
  { header: "", key: "actions", width: 32 },
];

export function PsetTableSection({
  document,
  set,
  visibleValues,
  searchActive,
  onAddPropertyToSet,
  onDuplicatePropertySet,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onUpdateProperty,
}: {
  document: NativeIfcDocument;
  set: NativeIfcPropertySet;
  visibleValues: NativeIfcPropertySet["values"];
  searchActive: boolean;
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

  const commitSetName = (nextName = setName) => {
    if (nextName.trim() !== set.name) {
      onRenamePropertySet(set.id, nextName);
    }
  };

  const isQto = set.kind === "Qto";
  const accentClasses = isQto
    ? "border-l-amber-400 bg-amber-50/40"
    : "border-l-emerald-400 bg-emerald-50/40";
  const headerAccent = isQto
    ? "bg-amber-50/70 border-amber-200/60"
    : "bg-emerald-50/70 border-emerald-200/60";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 border-l-[3px] bg-card shadow-sm",
        accentClasses,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-2.5 py-2",
          headerAccent,
        )}
      >
        <Badge tone={isQto ? "warning" : "success"}>{set.kind}</Badge>
        <Input
          className="h-7 min-w-40 flex-1 rounded-md border-transparent bg-transparent px-2 text-sm font-semibold text-foreground shadow-none hover:bg-white/70 focus-visible:border-ring focus-visible:bg-white"
          value={setName}
          onBlur={() => commitSetName()}
          onChange={(event) => setSetName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          #{set.id} ·{" "}
          {searchActive
            ? `${visibleValues.length.toLocaleString()}/${set.values.length.toLocaleString()}`
            : set.values.length.toLocaleString()}{" "}
          Werte
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label="Duplizieren"
            icon={<Copy aria-hidden className="size-3.5" />}
            onPress={() => onDuplicatePropertySet(set.id)}
          />
          <IconButton
            label="Löschen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onPress={() => onRemovePropertySet(set.id)}
          />
        </div>
      </div>
      <div className="p-2">
        <DataTable
          columns={PSET_TABLE_COLUMNS}
          emptyMessage={
            searchActive ? "Keine passenden Werte." : "Noch keine Werte."
          }
          keyExtractor={(value) => String(value.id)}
          rows={visibleValues}
          renderRow={(value) => (
            <EditablePropertyTableCells
              columns={PSET_TABLE_COLUMNS}
              property={value}
              propertyEntity={document.entityById.get(value.id)}
              setId={set.id}
              typeOptions={typeOptions}
              onRemove={onRemovePropertyFromSet}
              onUpdate={onUpdateProperty}
            />
          )}
          footer={
            <PsetAddTableCells
              columns={PSET_TABLE_COLUMNS}
              disabled={!newName.trim()}
              name={newName}
              selectedType={newType}
              typeOptions={typeOptions}
              value={newValue}
              onAdd={() => {
                onAddPropertyToSet(set.id, newName, newValue, newType);
                setNewValue("");
              }}
              onChangeName={setNewName}
              onChangeType={setNewType}
              onChangeValue={setNewValue}
            />
          }
        />
      </div>
    </section>
  );
}

function EditablePropertyTableCells({
  columns,
  property,
  propertyEntity,
  setId,
  typeOptions,
  onRemove,
  onUpdate,
}: {
  columns: DataTableColumn[];
  property: { id: number; name: string; value: string; type: string };
  propertyEntity?: NativeIfcEntity;
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
  const rawValue = editableSetValue(propertyEntity, property.value);
  const parsed = parseTypedPropertyValue(rawValue, propertyEntity);
  const [name, setName] = useState(property.name);
  const [valueType, setValueType] = useState(parsed.valueType);
  const [value, setValue] = useState(parsed.value);

  const commitUpdate = (
    next: {
      name?: string;
      value?: string;
      valueType?: string;
    } = {},
  ) => {
    const committedName = next.name ?? name;
    const committedValue = next.value ?? value;
    const committedValueType = next.valueType ?? valueType;
    if (
      committedName === property.name &&
      committedValue === parsed.value &&
      committedValueType === parsed.valueType
    ) {
      return;
    }
    onUpdate(property.id, committedName, committedValue, committedValueType);
  };

  const updateValueType = (nextType: string) => {
    setValueType(nextType);
    commitUpdate({ valueType: nextType });
  };

  useEffect(() => {
    setName(property.name);
    setValueType(parsed.valueType);
    setValue(parsed.value);
  }, [parsed.value, parsed.valueType, property.id, property.name]);

  return (
    <>
      <DataTableCell column={columns[0]}>
        <PsetCellInput
          value={name}
          onBlur={() => commitUpdate()}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataTableCell>
      <DataTableCell column={columns[1]}>
        <PsetTypeSelect
          selectedType={valueType}
          typeOptions={typeOptions}
          onSelectType={updateValueType}
        />
      </DataTableCell>
      <DataTableCell column={columns[2]}>
        <PsetCellInput
          value={value}
          onBlur={() => commitUpdate()}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataTableCell>
      <DataTableCell column={columns[3]}>
        <div className="flex justify-end">
          <IconButton
            label="Eigenschaft l\u00f6schen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onPress={() => onRemove(setId, property.id)}
          />
        </div>
      </DataTableCell>
    </>
  );
}

function PsetAddTableCells({
  columns,
  disabled,
  name,
  selectedType,
  typeOptions,
  value,
  onAdd,
  onChangeName,
  onChangeType,
  onChangeValue,
}: {
  columns: DataTableColumn[];
  disabled: boolean;
  name: string;
  selectedType: string;
  typeOptions: string[];
  value: string;
  onAdd(): void;
  onChangeName(value: string): void;
  onChangeType(value: string): void;
  onChangeValue(value: string): void;
}) {
  return (
    <>
      <DataTableCell column={columns[0]}>
        <PsetCellInput
          className="font-medium"
          value={name}
          onChange={(event) => onChangeName(event.currentTarget.value)}
        />
      </DataTableCell>
      <DataTableCell column={columns[1]}>
        <PsetTypeSelect
          selectedType={selectedType}
          typeOptions={typeOptions}
          onSelectType={onChangeType}
        />
      </DataTableCell>
      <DataTableCell column={columns[2]}>
        <PsetCellInput
          value={value}
          onChange={(event) => onChangeValue(event.currentTarget.value)}
        />
      </DataTableCell>
      <DataTableCell column={columns[3]}>
        <div className="flex justify-end">
          <IconButton
            disabled={disabled}
            label="Wert hinzuf\u00fcgen"
            tone="primary"
            icon={<Plus aria-hidden className="size-3.5" />}
            onPress={onAdd}
          />
        </div>
      </DataTableCell>
    </>
  );
}

function PsetCellInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-7 rounded-md border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/45 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-1",
        className,
      )}
      {...props}
    />
  );
}

function PsetTypeSelect({
  selectedType,
  typeOptions,
  onSelectType,
}: {
  selectedType: string;
  typeOptions: string[];
  onSelectType(valueType: string): void;
}) {
  const normalizedTypeOptions = useMemo(
    () => uniqueStrings([selectedType, ...typeOptions]),
    [selectedType, typeOptions],
  );

  return (
    <Select
      value={selectedType}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onSelectType(nextValue);
        }
      }}
    >
      <SelectTrigger
        className="h-7 w-full rounded-md border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/45 focus-visible:ring-1"
        size="sm"
      >
        <SelectValue className="truncate">
          {propertyValueTypeLabel(selectedType)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-72">
        {normalizedTypeOptions.map((typeOption) => (
          <SelectItem key={typeOption} value={typeOption}>
            {propertyValueTypeLabel(typeOption)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IconButton({
  disabled,
  icon,
  label,
  tone = "neutral",
  onPress,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "danger" | "primary";
  onPress(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
        tone === "primary" &&
          "text-primary hover:bg-primary/10 hover:text-primary",
      )}
    >
      {icon}
    </button>
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
        title="Relationen"
        description={`${relationships.length.toLocaleString()} Beziehungen indexiert`}
        meta={<Badge tone="neutral">Graph</Badge>}
      />
      <EditBlock title="Add Relationship">
        <DropdownField
          label="Relationship class"
          options={relationshipTypeOptions}
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
        {!relationshipTypeOptions.length ? (
          <TextLine>
            No valid relationship for this source/target class.
          </TextLine>
        ) : null}
        <Button
          disabled={!canCreateRelationship}
          label="+ Add Relationship"
          primary
          onPress={() =>
            onAddRelationship(relType, Number(sourceId), Number(targetId))
          }
        />
      </EditBlock>
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
        <TextLine>No relationships indexed.</TextLine>
      ) : null}
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
      <ResponsiveRow>
        <ResponsiveField>
          <Button
            disabled={!canSaveRelationship}
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
        </ResponsiveField>
        <ResponsiveField>
          <Button
            label="Stage Delete Relationship"
            onPress={() => onRemove(relationship.id)}
          />
        </ResponsiveField>
      </ResponsiveRow>
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
  const [materialName, setMaterialName] = useState("Inspektionsbeton");
  const [materialCategory, setMaterialCategory] = useState("Beton");
  const [materialPropertySetName, setMaterialPropertySetName] = useState(
    "Pset_MaterialCommon",
  );
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

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Ressourcen"
        description={`${resources.length.toLocaleString()} Ressourcen / ${typeAssignments.length.toLocaleString()} Typzuweisungen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <InfoSection title="Linked Resources">
        {resources.length ? (
          resources.map((resource) => (
            <TextLine key={resource}>{resource}</TextLine>
          ))
        ) : (
          <TextLine>No material, classification or document linked.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="Type assignments">
        {typeAssignments.length ? (
          typeAssignments.map((assignment) => (
            <TextLine key={`${assignment.relationshipId}-${assignment.typeId}`}>
              #{assignment.relationshipId} → #{assignment.typeId}{" "}
              {assignment.typeClass} {assignment.typeName}
            </TextLine>
          ))
        ) : (
          <TextLine>No IFCRELDEFINESBYTYPE assignment.</TextLine>
        )}
      </InfoSection>
      <EditBlock title="Assign Type">
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
      </EditBlock>
      <EditBlock title="Add Material">
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
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Material property set"
              value={materialPropertySetName}
              onChangeText={setMaterialPropertySetName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Add Material Properties"
              onPress={() =>
                onAddMaterialWithProperties(
                  materialName,
                  materialCategory,
                  materialPropertySetName,
                  materialPropertyRows,
                )
              }
            />
          </ResponsiveField>
        </ResponsiveRow>
        <LabeledInput
          label="Name | Value | IFC type"
          multiline
          mono
          value={materialPropertyRows}
          onChangeText={setMaterialPropertyRows}
        />
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Material style"
              value={materialStyleName}
              onChangeText={setMaterialStyleName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <ColorInput
              label="Color"
              value={materialColor}
              onChangeText={setMaterialColor}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Transparency 0..1"
              keyboardType="numeric"
              value={materialTransparency}
              onChangeText={setMaterialTransparency}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          label="+ Add Material Style"
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
      </EditBlock>
      <EditBlock title="Add Material Layer Set">
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Set name"
              value={layerSetName}
              onChangeText={setLayerSetName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Add Layer Set"
              onPress={() => onAddMaterialLayerSet(layerSetName, layerRows)}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <LabeledInput
          label="Name | Material | Thickness | Category"
          multiline
          mono
          value={layerRows}
          onChangeText={setLayerRows}
        />
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Direction"
              options={["AXIS1", "AXIS2", "AXIS3"]}
              value={layerDirection}
              onChange={setLayerDirection}
            />
          </ResponsiveField>
          <ResponsiveField>
            <DropdownField
              label="Sense"
              options={["POSITIVE", "NEGATIVE"]}
              value={layerDirectionSense}
              onChange={setLayerDirectionSense}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Offset"
              keyboardType="numeric"
              value={layerOffset}
              onChangeText={setLayerOffset}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Reference extent"
              keyboardType="numeric"
              value={layerReferenceExtent}
              onChangeText={setLayerReferenceExtent}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Add Layer Usage"
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
          </ResponsiveField>
        </ResponsiveRow>
      </EditBlock>
      <EditBlock title="Add Material Profile Set">
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Set name"
              value={profileSetName}
              onChangeText={setProfileSetName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Profile"
              value={profileName}
              onChangeText={setProfileName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Material"
              value={profileMaterialName}
              onChangeText={setProfileMaterialName}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Category"
              value={profileMaterialCategory}
              onChangeText={setProfileMaterialCategory}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="XDim"
              keyboardType="numeric"
              value={profileWidth}
              onChangeText={setProfileWidth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="YDim"
              keyboardType="numeric"
              value={profileDepth}
              onChangeText={setProfileDepth}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          label="+ Add Profile Set"
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
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Cardinal point"
              keyboardType="numeric"
              value={profileCardinalPoint}
              onChangeText={setProfileCardinalPoint}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Reference extent"
              keyboardType="numeric"
              value={profileReferenceExtent}
              onChangeText={setProfileReferenceExtent}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Add Profile Usage"
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
          </ResponsiveField>
        </ResponsiveRow>
      </EditBlock>
      <EditBlock title="Add Material Constituent Set">
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="Set name"
              value={constituentSetName}
              onChangeText={setConstituentSetName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Add Constituent Set"
              onPress={() =>
                onAddMaterialConstituentSet(constituentSetName, constituentRows)
              }
            />
          </ResponsiveField>
        </ResponsiveRow>
        <LabeledInput
          label="Name | Material | Fraction | Category"
          multiline
          mono
          value={constituentRows}
          onChangeText={setConstituentRows}
        />
      </EditBlock>
      <EditBlock title="Assign Group / Zone / System">
        <ResponsiveRow>
          <ResponsiveField>
            <DropdownField
              label="Group type"
              options={GROUP_TYPES}
              value={groupType}
              onChange={setGroupType}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Group name"
              value={groupName}
              onChangeText={setGroupName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="ObjectType"
              value={groupObjectType}
              onChangeText={setGroupObjectType}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <ResponsiveRow>
          <ResponsiveField>
            <LabeledInput
              label="LongName"
              value={groupLongName}
              onChangeText={setGroupLongName}
            />
          </ResponsiveField>
          <ResponsiveField>
            <Button
              label="+ Assign Group"
              onPress={() =>
                onAddGroupAssignment(
                  groupType,
                  groupName,
                  groupObjectType,
                  groupLongName,
                )
              }
            />
          </ResponsiveField>
        </ResponsiveRow>
      </EditBlock>
    </PanelShell>
  );
}

type ResourceAssociation = {
  relationship: NativeIfcRelationship;
  relationshipEntity: NativeIfcEntity;
  resource: NativeIfcEntity;
};

type ResourceEditCallbacks = {
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
};

function getResourceAssociations(
  document: NativeIfcDocument,
  selectedId: number,
  relationshipTypes: string[],
): ResourceAssociation[] {
  const allowedTypes = new Set(relationshipTypes);
  return (document.relationshipsByEntity.get(selectedId) ?? []).flatMap(
    (relationship) => {
      if (
        !allowedTypes.has(relationship.type) ||
        !relationship.sourceIds.includes(selectedId)
      ) {
        return [];
      }
      const relationshipEntity = document.entityById.get(relationship.id);
      if (!relationshipEntity) {
        return [];
      }
      return relationship.targetIds.flatMap((resourceId) => {
        const resource = document.entityById.get(resourceId);
        return resource ? [{ relationship, relationshipEntity, resource }] : [];
      });
    },
  );
}

function EditableReferenceResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, resource } = association;
  const [location, setLocation] = useState(
    readOptionalStepString(resource.args[0]),
  );
  const [identification, setIdentification] = useState(
    readOptionalStepString(resource.args[1]),
  );
  const [name, setName] = useState(readOptionalStepString(resource.args[2]));

  useEffect(() => {
    setLocation(readOptionalStepString(resource.args[0]));
    setIdentification(readOptionalStepString(resource.args[1]));
    setName(readOptionalStepString(resource.args[2]));
  }, [resource.args, resource.id]);

  const label =
    resource.type === "IFCCLASSIFICATIONREFERENCE"
      ? "Classification"
      : resource.type === "IFCDOCUMENTREFERENCE"
        ? "Document"
        : "Library";

  return (
    <CompactResourceCard
      title={`${label} #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() =>
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(location),
                1: writeOptionalStepString(identification),
                2: writeOptionalStepString(name),
              }),
              entityId: resource.id,
            },
          ],
          `Update ${label.toLowerCase()} #${resource.id}`,
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput
          label="Identification"
          value={identification}
          onChangeText={setIdentification}
        />
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactTextInput
          label="Location / URI"
          value={location}
          onChangeText={setLocation}
        />
      </div>
    </CompactResourceCard>
  );
}

function CompactResourceCard({
  children,
  relation,
  title,
  onRemove,
  onSave,
}: {
  children: ReactNode;
  relation: string;
  title: string;
  onRemove(): void;
  onSave(): void;
}) {
  return (
    <section className="grid gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
            {title}
          </h3>
          <span className="truncate text-[0.65rem] text-muted-foreground">
            {relation}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ShadcnButton
            aria-label={`${title} speichern`}
            className="h-7 gap-1 px-2 text-xs"
            size="sm"
            type="button"
            onClick={onSave}
          >
            <Save aria-hidden className="size-3" />
            <span>Speichern</span>
          </ShadcnButton>
          <ShadcnButton
            aria-label={`${title} Zuordnung entfernen`}
            className="h-7 gap-1 px-2 text-xs"
            size="sm"
            type="button"
            variant="outline"
            onClick={onRemove}
          >
            <Trash2 aria-hidden className="size-3" />
            <span>Entfernen</span>
          </ShadcnButton>
        </div>
      </div>
      {children}
    </section>
  );
}

function CompactTextInput({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <Input
        className="h-8 min-w-0 rounded-md px-2 text-xs text-foreground"
        title={value}
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
    </label>
  );
}

function CompactSelectInput({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 min-w-0 rounded-md px-2 text-xs text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function CompactAddSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="group rounded-md border border-border/60 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/45">
        <span>{title}</span>
        <Plus
          aria-hidden
          className="size-3.5 transition-transform group-open:rotate-45"
        />
      </summary>
      <div className="grid gap-2 border-t border-border/60 bg-card p-2.5">
        {children}
      </div>
    </details>
  );
}

function CompactCreateButton({
  label,
  onClick,
}: {
  label: string;
  onClick(): void;
}) {
  return (
    <ShadcnButton
      className="h-8 w-full gap-1.5 text-xs"
      size="sm"
      type="button"
      variant="outline"
      onClick={onClick}
    >
      <Plus aria-hidden className="size-3.5" />
      <span>{label}</span>
    </ShadcnButton>
  );
}

function EditableApprovalResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, resource } = association;
  const [identifier, setIdentifier] = useState(
    readOptionalStepString(resource.args[0]),
  );
  const [name, setName] = useState(readOptionalStepString(resource.args[1]));
  const [status, setStatus] = useState(
    readOptionalStepString(resource.args[4]),
  );

  useEffect(() => {
    setIdentifier(readOptionalStepString(resource.args[0]));
    setName(readOptionalStepString(resource.args[1]));
    setStatus(readOptionalStepString(resource.args[4]));
  }, [resource.args, resource.id]);

  return (
    <CompactResourceCard
      title={`Approval #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() =>
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(identifier),
                1: writeOptionalStepString(name),
                4: writeOptionalStepString(status),
              }),
              entityId: resource.id,
            },
          ],
          `Update approval #${resource.id}`,
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput
          label="Identifier"
          value={identifier}
          onChangeText={setIdentifier}
        />
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactTextInput
          label="Status"
          value={status}
          onChangeText={setStatus}
        />
      </div>
    </CompactResourceCard>
  );
}

function EditableConstraintResource({
  association,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  association: ResourceAssociation;
} & ResourceEditCallbacks) {
  const { relationship, relationshipEntity, resource } = association;
  const [name, setName] = useState(readOptionalStepString(resource.args[0]));
  const [grade, setGrade] = useState(readStepEnum(resource.args[2]));
  const [source, setSource] = useState(
    readOptionalStepString(resource.args[3]),
  );
  const [qualifier, setQualifier] = useState(readStepEnum(resource.args[9]));
  const [intent, setIntent] = useState(
    readOptionalStepString(relationshipEntity.args[5]),
  );

  useEffect(() => {
    setName(readOptionalStepString(resource.args[0]));
    setGrade(readStepEnum(resource.args[2]));
    setSource(readOptionalStepString(resource.args[3]));
    setQualifier(readStepEnum(resource.args[9]));
    setIntent(readOptionalStepString(relationshipEntity.args[5]));
  }, [
    relationshipEntity.args,
    relationshipEntity.id,
    resource.args,
    resource.id,
  ]);

  return (
    <CompactResourceCard
      title={`Constraint #${resource.id}`}
      relation={`#${relationship.id} ${relationship.type}`}
      onRemove={() => onRemoveAssociation(relationship.id)}
      onSave={() => {
        const cleanGrade = grade || "NOTDEFINED";
        onUpdateEntityArgs(
          [
            {
              args: setStepArgs(resource.args, {
                0: writeOptionalStepString(name),
                2: writeStepEnum(cleanGrade),
                3: writeOptionalStepString(source),
                6:
                  cleanGrade.toUpperCase() === "USERDEFINED"
                    ? writeOptionalStepString("User defined")
                    : "$",
                9: writeStepEnum(qualifier || "REQUIREMENT"),
              }),
              entityId: resource.id,
            },
            {
              args: setStepArgs(relationshipEntity.args, {
                5: writeOptionalStepString(intent),
              }),
              entityId: relationship.id,
            },
          ],
          `Update constraint #${resource.id}`,
        );
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactSelectInput
          label="Grade"
          options={CONSTRAINT_GRADES}
          value={grade || "NOTDEFINED"}
          onChange={setGrade}
        />
        <CompactSelectInput
          label="Qualifier"
          options={OBJECTIVE_QUALIFIERS}
          value={qualifier || "REQUIREMENT"}
          onChange={setQualifier}
        />
        <CompactTextInput
          label="Source"
          value={source}
          onChangeText={setSource}
        />
        <CompactTextInput
          label="Intent"
          value={intent}
          onChangeText={setIntent}
        />
      </div>
    </CompactResourceCard>
  );
}

export function ResourceReferencesPanel({
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddLibraryReference,
  onRemoveAssociation,
  onUpdateEntityArgs,
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
  onAddLibraryReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
}) {
  const referenceAssociations = getResourceAssociations(document, selectedId, [
    "IFCRELASSOCIATESCLASSIFICATION",
    "IFCRELASSOCIATESDOCUMENT",
    "IFCRELASSOCIATESLIBRARY",
  ]);
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

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Klassifikation & Dokumente"
        description={`${referenceAssociations.length.toLocaleString()} verknuepfte Referenzen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <div className="grid gap-2">
        {referenceAssociations.length ? (
          referenceAssociations.map((association) => (
            <EditableReferenceResource
              key={`${association.relationship.id}-${association.resource.id}`}
              association={association}
              onRemoveAssociation={onRemoveAssociation}
              onUpdateEntityArgs={onUpdateEntityArgs}
            />
          ))
        ) : (
          <EmptyBlock>
            Keine Klassifikation, kein Dokument und keine Library zugewiesen.
          </EmptyBlock>
        )}
      </div>
      <CompactAddSection title="Add Classification">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Identification"
            value={classificationId}
            onChangeText={setClassificationId}
          />
          <CompactTextInput
            label="Name"
            value={classificationName}
            onChangeText={setClassificationName}
          />
          <CompactTextInput
            label="Location / URI"
            value={classificationUri}
            onChangeText={setClassificationUri}
          />
        </div>
        <CompactCreateButton
          label="Add Classification"
          onClick={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Add Document">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Identification"
            value={documentId}
            onChangeText={setDocumentId}
          />
          <CompactTextInput
            label="Name"
            value={documentName}
            onChangeText={setDocumentName}
          />
          <CompactTextInput
            label="Location / URI"
            value={documentUri}
            onChangeText={setDocumentUri}
          />
        </div>
        <CompactCreateButton
          label="Add Document"
          onClick={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Add Library">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Identification"
            value={libraryId}
            onChangeText={setLibraryId}
          />
          <CompactTextInput
            label="Name"
            value={libraryName}
            onChangeText={setLibraryName}
          />
          <CompactTextInput
            label="Location / URI"
            value={libraryUri}
            onChangeText={setLibraryUri}
          />
        </div>
        <CompactCreateButton
          label="Add Library"
          onClick={() =>
            onAddLibraryReference(libraryId, libraryName, libraryUri)
          }
        />
      </CompactAddSection>
    </PanelShell>
  );
}

export function ResourceControlsPanel({
  document,
  selectedId,
  onAddApproval,
  onAddConstraint,
  onRemoveAssociation,
  onUpdateEntityArgs,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddApproval(identifier: string, name: string, status: string): void;
  onAddConstraint(
    name: string,
    grade: string,
    source: string,
    qualifier: string,
    intent: string,
  ): void;
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
}) {
  const controlAssociations = getResourceAssociations(document, selectedId, [
    "IFCRELASSOCIATESAPPROVAL",
    "IFCRELASSOCIATESCONSTRAINT",
  ]);
  const [approvalId, setApprovalId] = useState("APP-INSPECTION");
  const [approvalName, setApprovalName] = useState("Pruefung freigegeben");
  const [approvalStatus, setApprovalStatus] = useState("Approved");
  const [constraintName, setConstraintName] = useState(
    "Objektanforderung erfuellen",
  );
  const [constraintGrade, setConstraintGrade] = useState("HARD");
  const [constraintSource, setConstraintSource] = useState("IFCnative");
  const [constraintQualifier, setConstraintQualifier] = useState("REQUIREMENT");
  const [constraintIntent, setConstraintIntent] = useState(
    "EXPECTED PERFORMANCE",
  );

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Freigaben & Constraints"
        description={`${controlAssociations.length.toLocaleString()} verknuepfte Kontrollressourcen`}
        meta={<Badge tone="neutral">IFC</Badge>}
      />
      <div className="grid gap-2">
        {controlAssociations.length ? (
          controlAssociations.map((association) =>
            association.resource.type === "IFCAPPROVAL" ? (
              <EditableApprovalResource
                key={`${association.relationship.id}-${association.resource.id}`}
                association={association}
                onRemoveAssociation={onRemoveAssociation}
                onUpdateEntityArgs={onUpdateEntityArgs}
              />
            ) : (
              <EditableConstraintResource
                key={`${association.relationship.id}-${association.resource.id}`}
                association={association}
                onRemoveAssociation={onRemoveAssociation}
                onUpdateEntityArgs={onUpdateEntityArgs}
              />
            ),
          )
        ) : (
          <EmptyBlock>
            Keine Freigabe und kein Constraint zugewiesen.
          </EmptyBlock>
        )}
      </div>
      <CompactAddSection title="Add Approval">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Identifier"
            value={approvalId}
            onChangeText={setApprovalId}
          />
          <CompactTextInput
            label="Name"
            value={approvalName}
            onChangeText={setApprovalName}
          />
          <CompactTextInput
            label="Status"
            value={approvalStatus}
            onChangeText={setApprovalStatus}
          />
        </div>
        <CompactCreateButton
          label="Add Approval"
          onClick={() =>
            onAddApproval(approvalId, approvalName, approvalStatus)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Add Constraint">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Name"
            value={constraintName}
            onChangeText={setConstraintName}
          />
          <CompactSelectInput
            label="Grade"
            options={CONSTRAINT_GRADES}
            value={constraintGrade}
            onChange={setConstraintGrade}
          />
          <CompactSelectInput
            label="Qualifier"
            options={OBJECTIVE_QUALIFIERS}
            value={constraintQualifier}
            onChange={setConstraintQualifier}
          />
          <CompactTextInput
            label="Source"
            value={constraintSource}
            onChangeText={setConstraintSource}
          />
          <CompactTextInput
            label="Intent"
            value={constraintIntent}
            onChangeText={setConstraintIntent}
          />
        </div>
        <CompactCreateButton
          label="Add Constraint"
          onClick={() =>
            onAddConstraint(
              constraintName,
              constraintGrade,
              constraintSource,
              constraintQualifier,
              constraintIntent,
            )
          }
        />
      </CompactAddSection>
    </PanelShell>
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
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Referenzen"
        description={`${outgoing.length.toLocaleString()} ausgehend / ${incoming.length.toLocaleString()} eingehend`}
        meta={<Badge tone="neutral">STEP</Badge>}
      />
      <InfoSection title="Outgoing">
        {outgoing.length ? (
          outgoing.map((id) => (
            <TextLine key={id}>
              -&gt; #{id} {document.entityById.get(id)?.type ?? ""}
            </TextLine>
          ))
        ) : (
          <TextLine>None.</TextLine>
        )}
      </InfoSection>
      <InfoSection title="Incoming">
        {incoming.length ? (
          incoming.map((entity) => (
            <TextLine key={entity.id}>
              &lt;- #{entity.id} {entity.type}
            </TextLine>
          ))
        ) : (
          <TextLine>None.</TextLine>
        )}
      </InfoSection>
    </PanelShell>
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
    <PanelShell scroll>
      <PanelHeader
        title="Einheiten"
        description={`${document.units.length.toLocaleString()} Einheiten im Modell`}
        meta={<Badge tone="neutral">Units</Badge>}
      />
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
        <TextLine key={unit}>{unit}</TextLine>
      ))}
    </PanelShell>
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
  if (entity.type === "IFCPROPERTYLISTVALUE") {
    return parseStepValueList(entity.args[2])
      .map((value) => parseIfcValue(value).value)
      .join("; ");
  }
  if (entity.type === "IFCPROPERTYENUMERATEDVALUE") {
    return parseStepValueList(entity.args[2])
      .map((value) => parseIfcValue(value).value)
      .join("; ");
  }
  if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
    const upper = parseOptionalIfcValue(entity.args[2]);
    const lower = parseOptionalIfcValue(entity.args[3]);
    const setPoint = parseOptionalIfcValue(entity.args[5]);
    return `${lower}..${upper}${setPoint ? `; ${setPoint}` : ""}`;
  }
  if (entity.type === "IFCPROPERTYTABLEVALUE") {
    const defining = parseStepValueList(entity.args[2]).map(
      (value) => parseIfcValue(value).value,
    );
    const defined = parseStepValueList(entity.args[3]).map(
      (value) => parseIfcValue(value).value,
    );
    return defining
      .map((value, index) => `${value}=>${defined[index] ?? ""}`)
      .join("; ");
  }
  return entity.args[2] ?? fallback;
}

function parseTypedPropertyValue(rawValue: string, entity?: NativeIfcEntity) {
  if (entity?.type === "IFCPROPERTYLISTVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYLISTVALUE:${readStepListValueType(entity.args[2])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYENUMERATEDVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYENUMERATEDVALUE:${readStepListValueType(entity.args[2])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYBOUNDEDVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYBOUNDEDVALUE:${readFirstStepValueType([
        entity.args[2],
        entity.args[3],
        entity.args[5],
      ])}`,
    };
  }
  if (entity?.type === "IFCPROPERTYTABLEVALUE") {
    return {
      value: rawValue,
      valueType: `IFCPROPERTYTABLEVALUE:${readStepListValueType(entity.args[2])}:${readStepListValueType(entity.args[3])}`,
    };
  }
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
    return { value: unquote(inner) ?? unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function parseStepValueList(rawValue = "") {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "$") {
    return [];
  }
  return splitTopLevel(trimmed.replace(/^\(/, "").replace(/\)$/, ""));
}

function parseOptionalIfcValue(rawValue = "") {
  return rawValue && rawValue !== "$" ? parseIfcValue(rawValue).value : "";
}

function readOptionalStepString(rawValue = "") {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "$" || trimmed === "*") {
    return "";
  }
  return unquote(trimmed) ?? readStepEnum(trimmed);
}

function writeOptionalStepString(value: string) {
  const trimmed = value.trim();
  return trimmed ? quote(trimmed) : "$";
}

function readStepEnum(rawValue = "") {
  return rawValue.trim().replace(/^\./, "").replace(/\.$/, "");
}

function writeStepEnum(value: string) {
  const normalized = value.trim().replace(/^\./, "").replace(/\.$/, "");
  return normalized ? `.${normalized.toUpperCase()}.` : "$";
}

function setStepArgs(args: string[], updates: Record<number, string>) {
  const next = [...args];
  for (const [index, value] of Object.entries(updates)) {
    next[Number(index)] = value;
  }
  return next;
}

function parseIfcValue(rawValue = "") {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (!match) {
    return { value: trimmed, valueType: "IFCLABEL" };
  }
  const valueType = normalizePropertyValueType(match[1]);
  const inner = match[2].trim();
  if (valueType === "IFCBOOLEAN") {
    const flag = inner.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
    return { value: flag === "F" ? "False" : "True", valueType };
  }
  const unquoted = inner.match(/^'([\s\S]*)'$/)?.[1];
  if (unquoted != null) {
    return { value: unquote(inner) ?? unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function readStepListValueType(rawValue = "") {
  const first = parseStepValueList(rawValue)[0];
  return first ? parseIfcValue(first).valueType : "IFCLABEL";
}

function readFirstStepValueType(values: Array<string | undefined>) {
  const rawValue = values.find((value) => value && value !== "$");
  return rawValue ? parseIfcValue(rawValue).valueType : "IFCLABEL";
}

function filterPropertySets(
  sets: NativeIfcPropertySet[],
  document: NativeIfcDocument,
  query: string,
) {
  if (!query) {
    return sets.map((set) => ({ set, values: set.values }));
  }

  return sets.flatMap((set) => {
    if (matchesPsetQuery(set, query)) {
      return [{ set, values: set.values }];
    }
    const values = set.values.filter((value) =>
      matchesPropertyValueQuery(
        value,
        document.entityById.get(value.id),
        query,
      ),
    );
    return values.length ? [{ set, values }] : [];
  });
}

function matchesPsetQuery(set: NativeIfcPropertySet, query: string) {
  return matchesQuery([set.id, `#${set.id}`, set.kind, set.name], query);
}

function matchesPropertyValueQuery(
  value: NativeIfcPropertySet["values"][number],
  entity: NativeIfcEntity | undefined,
  query: string,
) {
  const rawValue = editableSetValue(entity, value.value);
  const parsed = parseTypedPropertyValue(rawValue, entity);
  return matchesQuery(
    [
      value.id,
      `#${value.id}`,
      value.name,
      value.type,
      value.value,
      rawValue,
      parsed.value,
      parsed.valueType,
    ],
    query,
  );
}

function matchesQuery(
  values: Array<string | number | null | undefined>,
  query: string,
) {
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query),
  );
}

function normalizePropertyValueType(type: string) {
  const normalized = type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : "IFCLABEL";
}

function propertyValueTypeLabel(valueType: string) {
  const [kind, firstType, secondType] = valueType.split(":");
  const shortKind = shortIfcName(kind);
  if (kind === "IFCPROPERTYLISTVALUE") {
    return `List ${shortIfcName(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYENUMERATEDVALUE") {
    return `Enum ${shortIfcName(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYBOUNDEDVALUE") {
    return `Bounded ${shortIfcName(firstType ?? "IFCREAL")}`;
  }
  if (kind === "IFCPROPERTYTABLEVALUE") {
    return `Table ${shortIfcName(firstType ?? "IFCREAL")} -> ${shortIfcName(secondType ?? "IFCREAL")}`;
  }
  return shortKind;
}

function shortIfcName(value: string) {
  return value.replace(/^IFCPROPERTY/i, "").replace(/^IFC/i, "");
}

function formatEditableNumber(value: number | undefined, fallback: string) {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : String(value);
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
