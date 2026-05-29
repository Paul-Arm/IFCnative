import { Button as ShadcnButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Copy, Plus, Trash2 } from "lucide-react";
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
    getNativePlacement,
    unquote,
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
import { cn } from "@/lib/utils";

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
import type { EntityEditDraft, InspectorMode } from "./types";
import {
    Badge,
    Button,
    CollapsibleSection,
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
      <EmptyBlock title="No editable local placement">
        Select a product with IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D →
        IFCCARTESIANPOINT to edit a numeric XYZ move.
      </EmptyBlock>
    );
  }

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Placement"
        description={`Point #${placement.pointId}: ${placement.x}, ${placement.y}, ${placement.z}`}
        meta={<Badge tone="neutral">XYZ</Badge>}
      />
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
        <TextLine>
          Edits update the placement cartesian point directly in the active IFC.
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
              label="Y"
              keyboardType="numeric"
              value={y}
              onChangeText={setY}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={z}
              onChangeText={setZ}
            />
          </ResponsiveField>
        </ResponsiveRow>
        <Button
          label="Stage Placement Move"
          primary
          onPress={() => onMove(x, y, z)}
        />
      </InfoSection>
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

function PsetTableSection({
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

  const renameSet = (nextName: string) => {
    setSetName(nextName);
    onRenamePropertySet(set.id, nextName);
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
          onChange={(event) => renameSet(event.currentTarget.value)}
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
              rawValue={editableSetValue(
                document.entityById.get(value.id),
                value.value,
              )}
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
  rawValue,
  setId,
  typeOptions,
  onRemove,
  onUpdate,
}: {
  columns: DataTableColumn[];
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
    <>
      <DataTableCell column={columns[0]}>
        <PsetCellInput
          value={name}
          onChange={(event) => updateName(event.currentTarget.value)}
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
          onChange={(event) => updateValue(event.currentTarget.value)}
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
        <SelectValue className="truncate">{selectedType}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-72">
        {normalizedTypeOptions.map((typeOption) => (
          <SelectItem key={typeOption} value={typeOption}>
            {typeOption}
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

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

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
      </EditBlock>
      <EditBlock title="Add Classification">
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
      </EditBlock>
      <EditBlock title="Add Document">
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
      </EditBlock>
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
    return { value: unquote(inner) ?? unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
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
        editableSetValue(document.entityById.get(value.id), value.value),
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
  rawValue: string,
  query: string,
) {
  const parsed = parseTypedPropertyValue(rawValue);
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
