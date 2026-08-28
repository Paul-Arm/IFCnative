import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Plus, Save, Trash2 } from "lucide-react";
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
    getNativeLengthUnitScale,
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
    CommitInput,
    DataTable,
    DataTableCell,
    DropdownField,
    EmptyState,
    EntityDropdown,
    InfoRow,
    InfoSection,
    LabeledInput,
    PanelHeader,
    PanelShell,
    parseDecimalInput,
    SegmentedControl,
    shortType,
    type DataTableColumn,
} from "./ui";

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

/* ------------------------------------------------------------------ */
/* Kleine Layout-Primitive                                             */
/* ------------------------------------------------------------------ */

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

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 flex shrink-0 items-center gap-2">
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {children}
    </div>
  );
}

function IconButton({
  disabled,
  icon,
  label,
  tone = "neutral",
  onClick,
}: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  tone?: "neutral" | "danger" | "primary";
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
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

function CopyIconButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Kopiert" : title}
      icon={
        copied ? (
          <Check aria-hidden className="size-3.5 text-success" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )
      }
      onClick={() => {
        const clipboard = globalThis.navigator?.clipboard;
        if (!clipboard) {
          return;
        }
        void clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            globalThis.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => undefined);
      }}
    />
  );
}

/** Klickbarer Entity-Verweis (#id + Kurzklasse) mit Auswahl per Klick. */
function EntityChip({
  document,
  id,
  showType = true,
  onSelect,
}: {
  document: NativeIfcDocument;
  id: number;
  showType?: boolean;
  onSelect(entityId: number): void;
}) {
  const target = document.entityById.get(id);
  const title = target
    ? `#${id} ${shortType(target.type)}${target.name ? ` – ${target.name}` : ""} auswählen`
    : `#${id} auswählen`;
  return (
    <button
      type="button"
      title={title}
      onClick={() => onSelect(id)}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
    >
      <span className="shrink-0 font-mono">#{id}</span>
      {showType && target ? (
        <span className="truncate text-muted-foreground">
          {shortType(target.type)}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Rendert maximal `limit` Einträge; abgeschnittene Listen zeigen den
 * "… N weitere ausgeblendet"-Hinweis und lassen sich per Klick expandieren.
 */
function CappedItems<T>({
  items,
  limit,
  renderItem,
}: {
  items: T[];
  limit: number;
  renderItem(item: T, index: number): ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;
  return (
    <>
      {visible.map((item, index) => renderItem(item, index))}
      {hidden > 0 ? (
        <button
          type="button"
          className="text-left text-xs text-primary hover:underline"
          onClick={() => setShowAll(true)}
        >
          … {hidden.toLocaleString("de-DE")} weitere ausgeblendet – alle
          anzeigen
        </button>
      ) : null}
    </>
  );
}

/** LabeledInput-Variante mit Placeholder-Unterstützung. */
function TextField({
  keyboardType,
  label,
  mono,
  multiline,
  placeholder,
  value,
  onChangeText,
}: {
  keyboardType?: "default" | "numeric";
  label: string;
  mono?: boolean;
  multiline?: boolean;
  placeholder?: string;
  value: string;
  onChangeText(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <Textarea
          className={cn("min-h-20 text-xs text-foreground", mono && "font-mono")}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      ) : (
        <Input
          className={cn("h-8 text-xs text-foreground", mono && "font-mono")}
          inputMode={keyboardType === "numeric" ? "decimal" : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Startseite ohne Auswahl: Dokument-Übersicht                         */
/* ------------------------------------------------------------------ */

function DocumentOverview({
  document,
  objectInfoFindings,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  objectInfoFindings: ObjectInfoValidationFinding[];
  onSelectEntity(entityId: number): void;
}) {
  const psetCount = document.entitiesByType.get("IFCPROPERTYSET")?.length ?? 0;
  const qtoCount =
    document.entitiesByType.get("IFCELEMENTQUANTITY")?.length ?? 0;
  const severityCounts = { error: 0, info: 0, warning: 0 };
  for (const finding of objectInfoFindings) {
    severityCounts[finding.severity] += 1;
  }
  const projectId = document.spatialRoots[0]?.id;

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow="Dokument"
        title={document.fileName || "IFC-Dokument"}
        description="Kein Objekt ausgewählt – Übersicht über das geladene Modell."
        meta={<Badge tone="info">{document.schema || "IFC"}</Badge>}
      />
      <InfoSection title="Modell">
        <InfoRow
          label="Entitäten"
          value={document.entities.length.toLocaleString("de-DE")}
        />
        <InfoRow
          label="Typen"
          value={document.entitiesByType.size.toLocaleString("de-DE")}
        />
        <InfoRow label="Psets" value={psetCount.toLocaleString("de-DE")} />
        <InfoRow
          label="Mengensätze"
          value={qtoCount.toLocaleString("de-DE")}
        />
        <InfoRow
          label="Einheiten"
          value={document.units.length.toLocaleString("de-DE")}
        />
      </InfoSection>
      <InfoSection title="Objektinfo-Prüfung">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={severityCounts.error ? "danger" : "neutral"}>
            {severityCounts.error.toLocaleString("de-DE")} Fehler
          </Badge>
          <Badge tone={severityCounts.warning ? "warning" : "neutral"}>
            {severityCounts.warning.toLocaleString("de-DE")} Warnungen
          </Badge>
          <Badge tone={severityCounts.info ? "info" : "neutral"}>
            {severityCounts.info.toLocaleString("de-DE")} Hinweise
          </Badge>
        </div>
        {objectInfoFindings.length === 0 ? (
          <TextLine>Keine Objektinfo-Findings im Modell.</TextLine>
        ) : null}
      </InfoSection>
      <EmptyState
        title="Kein Objekt ausgewählt"
        description="Ein Objekt in der Struktur oder im 3D-Fenster wählen, um Details, Eigenschaften und Beziehungen zu sehen."
        action={
          projectId ? (
            <Button variant="default" onClick={() => onSelectEntity(projectId)}>
              Projekt auswählen
            </Button>
          ) : undefined
        }
      />
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ */
/* Tab "Übersicht"                                                     */
/* ------------------------------------------------------------------ */

function OverviewPanel({
  document,
  entity,
  objectInfoFindings,
  objectInfoIndex,
  onAddUnit,
  onSaveEdit,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
  objectInfoFindings: ObjectInfoValidationFinding[];
  objectInfoIndex: ObjectInfoIndex;
  onAddUnit(unitType: string, unitName: string): void;
  onSaveEdit(draft: EntityEditDraft): void;
  onSelectEntity(entityId: number): void;
}) {
  const path = findTreePath(document, entity.id);
  const sets = document.propertySetsByEntity.get(entity.id) ?? [];
  const relationships = document.relationshipsByEntity.get(entity.id) ?? [];

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`#${entity.id}`}
        title={entity.name || shortType(entity.type)}
        description={`${sets.length.toLocaleString("de-DE")} Psets · ${relationships.length.toLocaleString("de-DE")} Beziehungen`}
        meta={<Badge tone="info">{shortType(entity.type)}</Badge>}
      />

      <InfoSection title="Identität">
        <div className="grid gap-1">
          <IdentityEditRow label="Klasse">
            <Select
              value={entity.type}
              onValueChange={(nextType) => {
                if (nextType && nextType !== entity.type) {
                  onSaveEdit({
                    description: entity.description,
                    name: entity.name,
                    rawArgs: entity.args.join(","),
                    type: nextType,
                  });
                }
              }}
            >
              <SelectTrigger className="h-6 w-full min-w-0 text-xs">
                <SelectValue className="truncate">
                  {shortType(entity.type)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                align="start"
                className="max-h-72 w-auto max-w-96 min-w-(--anchor-width)"
              >
                {identityClassOptions(entity.type).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </IdentityEditRow>
          <div className="grid gap-1 rounded-md bg-muted/30 px-2 py-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-2">
            <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
              GlobalId
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {entity.globalId || "–"}
              </span>
              {entity.globalId ? (
                <CopyIconButton
                  text={entity.globalId}
                  title="GlobalId kopieren"
                />
              ) : null}
            </span>
          </div>
          <IdentityEditRow label="Name">
            <CommitInput
              className="h-6 w-full"
              placeholder="–"
              value={entity.name}
              onCommit={(next) =>
                onSaveEdit({
                  description: entity.description,
                  name: next,
                  rawArgs: entity.args.join(","),
                  type: entity.type,
                })
              }
            />
          </IdentityEditRow>
          <IdentityEditRow label="Beschreibung">
            <CommitInput
              className="h-6 w-full"
              placeholder="–"
              value={entity.description}
              onCommit={(next) =>
                onSaveEdit({
                  description: next,
                  name: entity.name,
                  rawArgs: entity.args.join(","),
                  type: entity.type,
                })
              }
            />
          </IdentityEditRow>
          <EntitySpecificIdentityFields
            entity={entity}
            schema={document.schema}
            onSave={onSaveEdit}
          />
        </div>
      </InfoSection>

      <InfoSection title="Räumlicher Pfad">
        {path.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {path.map((item, index) => (
              <span
                key={item.id}
                className="flex min-w-0 max-w-full items-center gap-1"
              >
                {index > 0 ? (
                  <span className="text-xs text-muted-foreground">/</span>
                ) : null}
                <button
                  type="button"
                  title={`#${item.id} ${item.type} auswählen`}
                  onClick={() => onSelectEntity(item.id)}
                  className="min-w-0 max-w-full truncate rounded border border-border/60 bg-background px-1.5 py-0.5 text-[11px] leading-4 text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                >
                  {item.name || shortType(item.type)}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <TextLine>Kein räumlicher Pfad.</TextLine>
        )}
      </InfoSection>

      <InfoSection title="Eigenschaften & Mengen">
        {sets.length ? (
          <CappedItems
            items={sets}
            limit={12}
            renderItem={(set) => (
              <div
                key={set.id}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/30 px-2 py-1.5"
              >
                <Badge tone={set.kind === "Qto" ? "warning" : "success"}>
                  {set.kind}
                </Badge>
                <EntityChip
                  document={document}
                  id={set.id}
                  showType={false}
                  onSelect={onSelectEntity}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {set.name}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {set.values.length.toLocaleString("de-DE")} Werte
                </span>
              </div>
            )}
          />
        ) : (
          <TextLine>Keine Psets oder QTOs verknüpft.</TextLine>
        )}
      </InfoSection>

      <InfoSection title="Beziehungen">
        {relationships.length ? (
          <CappedItems
            items={relationships}
            limit={20}
            renderItem={(relationship) => (
              <div
                key={relationship.id}
                className="grid gap-1 rounded-md bg-muted/30 px-2 py-1.5"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <EntityChip
                    document={document}
                    id={relationship.id}
                    showType={false}
                    onSelect={onSelectEntity}
                  />
                  <span className="min-w-0 truncate text-xs font-medium text-foreground">
                    {shortType(relationship.type)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <RelationshipIdChips
                    document={document}
                    ids={relationship.sourceIds}
                    onSelect={onSelectEntity}
                  />
                  <span aria-hidden>→</span>
                  <RelationshipIdChips
                    document={document}
                    ids={relationship.targetIds}
                    onSelect={onSelectEntity}
                  />
                </div>
              </div>
            )}
          />
        ) : (
          <TextLine>Keine Beziehungen indexiert.</TextLine>
        )}
      </InfoSection>

      <ObjectInfoSummary
        document={document}
        findings={objectInfoFindings}
        index={objectInfoIndex}
        selectedId={entity.id}
        onSelectEntity={onSelectEntity}
      />

      <ReferencesSection
        document={document}
        selectedId={entity.id}
        onSelectEntity={onSelectEntity}
      />

      <UnitsSection document={document} onAddUnit={onAddUnit} />

      <AdvancedEditSection entity={entity} onSave={onSaveEdit} />
    </PanelShell>
  );
}

/** Label/Control-Zeile im InfoRow-Layout für die editierbare Identität. */
function IdentityEditRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid gap-1 rounded-md bg-muted/30 px-2 py-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-2">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

type IdentityAttributeKind = "angle" | "enum" | "number" | "text";

interface IdentityAttributeDefinition {
  argIndex: number;
  kind: IdentityAttributeKind;
  label: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

const COMPOSITION_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Element", value: ".ELEMENT." },
  { label: "Teilweise", value: ".PARTIAL." },
  { label: "Komplex", value: ".COMPLEX." },
];

const SPACE_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Innenraum", value: ".INTERNAL." },
  { label: "Außenraum", value: ".EXTERNAL." },
  { label: "GFA", value: ".GFA." },
  { label: "Parken", value: ".PARKING." },
  { label: "USERDEFINED", value: ".USERDEFINED." },
  { label: "NOTDEFINED", value: ".NOTDEFINED." },
];

const PROXY_TYPE_OPTIONS = [
  { label: "Nicht gesetzt", value: "$" },
  { label: "Komplex", value: ".COMPLEX." },
  { label: "Element", value: ".ELEMENT." },
  { label: "Teil", value: ".PARTIAL." },
  { label: "Platzhalter für Raum", value: ".PROVISIONFORSPACE." },
  { label: "Platzhalter für Öffnung", value: ".PROVISIONFORVOID." },
  { label: "Benutzerdefiniert", value: ".USERDEFINED." },
  { label: "Nicht definiert", value: ".NOTDEFINED." },
];

const IDENTITY_ATTRIBUTES_BY_TYPE: Record<
  string,
  IdentityAttributeDefinition[]
> = {
  IFCBUILDING: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "number",
      label: "Referenzhöhe",
      placeholder: "z. B. 125.40",
    },
    {
      argIndex: 10,
      kind: "number",
      label: "Geländehöhe",
      placeholder: "z. B. 123.80",
    },
  ],
  IFCBUILDINGSTOREY: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "number",
      label: "Höhenlage",
      placeholder: "z. B. 3.20",
    },
  ],
  IFCPROJECT: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 5, kind: "text", label: "Langname" },
    { argIndex: 6, kind: "text", label: "Projektphase" },
  ],
  IFCSITE: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "angle",
      label: "Breitengrad",
      placeholder: "z. B. 52, 31, 12",
    },
    {
      argIndex: 10,
      kind: "angle",
      label: "Längengrad",
      placeholder: "z. B. 13, 24, 18",
    },
    {
      argIndex: 11,
      kind: "number",
      label: "Referenzhöhe",
      placeholder: "z. B. 34.50",
    },
    { argIndex: 12, kind: "text", label: "Grundbuchnummer" },
  ],
  IFCSPACE: [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Langname" },
    {
      argIndex: 8,
      kind: "enum",
      label: "Gliederung",
      options: COMPOSITION_TYPE_OPTIONS,
    },
    {
      argIndex: 9,
      kind: "enum",
      label: "Raumtyp",
      options: SPACE_TYPE_OPTIONS,
    },
    {
      argIndex: 10,
      kind: "number",
      label: "Fertigfußboden",
      placeholder: "z. B. 0.15",
    },
  ],
};

function EntitySpecificIdentityFields({
  entity,
  schema,
  onSave,
}: {
  entity: NativeIfcEntity;
  schema: string;
  onSave(draft: EntityEditDraft): void;
}) {
  const definitions = identityAttributeDefinitions(entity.type, schema);
  if (!definitions.length) {
    return null;
  }

  const saveAttribute = (
    definition: IdentityAttributeDefinition,
    nextValue: string,
  ) => {
    const nextArgs = [...entity.args];
    while (nextArgs.length <= definition.argIndex) {
      nextArgs.push("$");
    }
    nextArgs[definition.argIndex] = encodeIdentityAttribute(
      nextValue,
      definition.kind,
    );
    onSave({
      description: entity.description,
      name: entity.name,
      rawArgs: nextArgs.join(","),
      type: entity.type,
    });
  };

  return definitions.map((definition) => {
    const rawValue = entity.args[definition.argIndex] ?? "$";
    return (
      <IdentityEditRow key={definition.argIndex} label={definition.label}>
        {definition.kind === "enum" ? (
          <Select
            value={rawValue}
            onValueChange={(nextValue) => {
              if (nextValue && nextValue !== rawValue) {
                saveAttribute(definition, nextValue);
              }
            }}
          >
            <SelectTrigger className="h-6 w-full min-w-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="w-auto min-w-(--anchor-width)"
            >
              {definition.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <CommitInput
            className="h-6 w-full"
            placeholder={definition.placeholder ?? "–"}
            value={decodeIdentityAttribute(rawValue, definition.kind)}
            onCommit={(nextValue) => saveAttribute(definition, nextValue)}
          />
        )}
      </IdentityEditRow>
    );
  });
}

function identityAttributeDefinitions(
  entityType: string,
  schema: string,
): IdentityAttributeDefinition[] {
  if (entityType !== "IFCBUILDINGELEMENTPROXY") {
    return IDENTITY_ATTRIBUTES_BY_TYPE[entityType] ?? [];
  }

  const legacyIfc2x3 = /^IFC2X3/i.test(schema);
  return [
    { argIndex: 4, kind: "text", label: "Objekttyp" },
    { argIndex: 7, kind: "text", label: "Kennzeichen / Tag" },
    {
      argIndex: 8,
      kind: "enum",
      label: legacyIfc2x3 ? "Gliederung" : "Vordefinierter Typ",
      options: legacyIfc2x3
        ? COMPOSITION_TYPE_OPTIONS
        : PROXY_TYPE_OPTIONS,
    },
  ];
}

function decodeIdentityAttribute(rawValue: string, kind: IdentityAttributeKind) {
  if (!rawValue || rawValue === "$" || rawValue === "*") {
    return "";
  }
  if (kind === "text") {
    return unquote(rawValue) ?? rawValue;
  }
  if (kind === "angle") {
    return rawValue.replace(/^\(|\)$/g, "");
  }
  return rawValue;
}

function encodeIdentityAttribute(value: string, kind: IdentityAttributeKind) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "$") {
    return "$";
  }
  if (kind === "text") {
    return quote(trimmed);
  }
  if (kind === "angle") {
    const components = trimmed
      .replace(/^\(|\)$/g, "")
      .split(/[;,\s]+/)
      .filter(Boolean)
      .join(",");
    return components ? `(${components})` : "$";
  }
  if (kind === "number") {
    return trimmed.replace(",", ".");
  }
  return trimmed;
}

function identityClassOptions(currentType: string) {
  const seen = new Set<string>();
  const options: { label: string; value: string }[] = [];
  for (const value of [currentType, ...ENTITY_TYPES]) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push({ label: shortType(value), value });
  }
  return options;
}

function RelationshipIdChips({
  document,
  ids,
  onSelect,
}: {
  document: NativeIfcDocument;
  ids: number[];
  onSelect(entityId: number): void;
}) {
  const visible = ids.slice(0, 4);
  const hidden = ids.length - visible.length;
  if (!ids.length) {
    return <span>–</span>;
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((id) => (
        <EntityChip
          key={id}
          document={document}
          id={id}
          onSelect={onSelect}
        />
      ))}
      {hidden > 0 ? (
        <span
          className="text-[11px] text-muted-foreground"
          title={`${hidden.toLocaleString("de-DE")} weitere ausgeblendet`}
        >
          +{hidden.toLocaleString("de-DE")} weitere
        </span>
      ) : null}
    </span>
  );
}

function ObjectInfoSummary({
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
    <InfoSection title="Objektinfo">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={localFindings.length ? "warning" : "success"}>
          {localFindings.length.toLocaleString("de-DE")} Findings
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {definitions.length.toLocaleString("de-DE")} IDs ·{" "}
          {outgoing.length.toLocaleString("de-DE")} ausgehend ·{" "}
          {incoming.length.toLocaleString("de-DE")} eingehend
        </span>
      </div>

      <SubHeading>Objektinfo-IDs</SubHeading>
      {definitions.length ? (
        <CappedItems
          items={definitions}
          limit={10}
          renderItem={(definition) => (
            <div
              key={definition.propertyId}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="font-mono font-medium text-foreground">
                {definition.value || "–"}
              </span>
              <span className="min-w-0 truncate text-muted-foreground">
                #{definition.psetId} {definition.psetName} · #
                {definition.propertyId} {definition.propertyName}
              </span>
            </div>
          )}
        />
      ) : (
        <TextLine>
          Kein ePset_Objektinformationen._ID am ausgewählten Objekt.
        </TextLine>
      )}

      <SubHeading>Ausgehende ID-Referenzen</SubHeading>
      {outgoing.length ? (
        <CappedItems
          items={outgoing}
          limit={15}
          renderItem={(reference) => {
            const target =
              reference.targetDefinitions[0]?.entityId ??
              reference.externalDefinitions[0]?.entityId;
            return (
              <div
                key={reference.propertyId}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
              >
                <span className="font-mono font-medium text-foreground">
                  {reference.value || "–"}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {reference.psetName}.{reference.propertyName}
                </span>
                {target ? (
                  <EntityChip
                    document={document}
                    id={target}
                    onSelect={onSelectEntity}
                  />
                ) : (
                  <span className="text-muted-foreground">
                    Kein Ziel gefunden
                  </span>
                )}
              </div>
            );
          }}
        />
      ) : (
        <TextLine>Keine ausgehenden ID-Referenzen.</TextLine>
      )}

      <SubHeading>Eingehende ID-Referenzen</SubHeading>
      {incoming.length ? (
        <CappedItems
          items={incoming}
          limit={15}
          renderItem={(reference) => (
            <div
              key={reference.propertyId}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <span className="font-mono font-medium text-foreground">
                {reference.value || "–"}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {reference.psetName}.{reference.propertyName}
              </span>
              <EntityChip
                document={document}
                id={reference.entityId}
                onSelect={onSelectEntity}
              />
            </div>
          )}
        />
      ) : (
        <TextLine>Keine eingehenden ID-Referenzen.</TextLine>
      )}

      <SubHeading>Lokale Findings</SubHeading>
      {localFindings.length ? (
        <CappedItems
          items={localFindings}
          limit={10}
          renderItem={(finding) => (
            <div
              key={finding.id}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/30 px-2 py-1 text-xs"
            >
              <Badge
                tone={
                  finding.severity === "error"
                    ? "danger"
                    : finding.severity === "warning"
                      ? "warning"
                      : "info"
                }
              >
                {finding.kind}
              </Badge>
              <span className="min-w-0 flex-1 break-words text-foreground">
                {finding.message}
              </span>
            </div>
          )}
        />
      ) : (
        <TextLine>Keine lokalen Objektinfo-Findings.</TextLine>
      )}
    </InfoSection>
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

function ReferencesSection({
  document,
  selectedId,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onSelectEntity(entityId: number): void;
}) {
  const outgoing = document.outgoingRefs.get(selectedId) ?? [];
  const incoming = document.incomingRefs.get(selectedId) ?? [];
  return (
    <CollapsibleSection
      title="Referenzen"
      meta={`${outgoing.length.toLocaleString("de-DE")} ausgehend · ${incoming.length.toLocaleString("de-DE")} eingehend`}
    >
      <SubHeading>Ausgehend</SubHeading>
      {outgoing.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <CappedItems
            items={outgoing}
            limit={60}
            renderItem={(id) => (
              <EntityChip
                key={id}
                document={document}
                id={id}
                onSelect={onSelectEntity}
              />
            )}
          />
        </div>
      ) : (
        <TextLine>Keine ausgehenden Referenzen.</TextLine>
      )}
      <SubHeading>Eingehend</SubHeading>
      {incoming.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <CappedItems
            items={incoming}
            limit={60}
            renderItem={(referencing) => (
              <EntityChip
                key={referencing.id}
                document={document}
                id={referencing.id}
                onSelect={onSelectEntity}
              />
            )}
          />
        </div>
      ) : (
        <TextLine>Keine eingehenden Referenzen.</TextLine>
      )}
    </CollapsibleSection>
  );
}

function UnitsSection({
  document,
  onAddUnit,
}: {
  document: NativeIfcDocument;
  onAddUnit(unitType: string, unitName: string): void;
}) {
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
  return (
    <CollapsibleSection
      title="Einheiten"
      meta={`${document.units.length.toLocaleString("de-DE")} Einheiten im Modell`}
    >
      {document.units.length ? (
        <div className="grid gap-1">
          <CappedItems
            items={document.units}
            limit={20}
            renderItem={(unit, index) => (
              <div
                key={`${unit}-${index}`}
                className="truncate rounded-md bg-muted/30 px-2 py-1 font-mono text-[11px] text-foreground"
                title={unit}
              >
                {unit}
              </div>
            )}
          />
        </div>
      ) : (
        <TextLine>Keine Einheiten definiert.</TextLine>
      )}
      <ResponsiveRow>
        <ResponsiveField>
          <DropdownField
            label="Einheitentyp"
            options={UNIT_TYPES}
            value={unitType}
            onChange={setUnitType}
          />
        </ResponsiveField>
        <ResponsiveField>
          <DropdownField
            label="Einheit"
            options={UNIT_NAMES}
            value={unitName}
            onChange={setUnitName}
          />
        </ResponsiveField>
      </ResponsiveRow>
      <Button variant="default" onClick={() => onAddUnit(unitType, unitName)}>
        <Plus aria-hidden className="size-3.5" /> Einheit hinzufügen
      </Button>
    </CollapsibleSection>
  );
}

function AdvancedEditSection({
  entity,
  onSave,
}: {
  entity: NativeIfcEntity;
  onSave(draft: EntityEditDraft): void;
}) {
  const rawArgsValue = entity.args.join(",");
  const [rawArgs, setRawArgs] = useState(rawArgsValue);

  useEffect(() => {
    setRawArgs(rawArgsValue);
  }, [entity.id, rawArgsValue]);

  return (
    <CollapsibleSection title="Erweitert" meta="STEP-Argumente (roh) bearbeiten">
      <CodeBlock>
        #{entity.id}= {entity.type}({entity.args.join(",")});
      </CodeBlock>
      <LabeledInput
        label="STEP-Argumente (roh)"
        value={rawArgs}
        onChangeText={setRawArgs}
        multiline
        mono
      />
      <Button
        variant="default"
        onClick={() =>
          onSave({
            description: entity.description,
            name: entity.name,
            rawArgs,
            type: entity.type,
          })
        }
      >
        <Save aria-hidden className="size-3.5" /> Speichern
      </Button>
    </CollapsibleSection>
  );
}

/* ------------------------------------------------------------------ */
/* Tab "Platzierung"                                                   */
/* ------------------------------------------------------------------ */

type PlacementCoordinateSpace = "welt" | "viewer";

function formatPlacementCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function readPlacementCoordinate(value: string) {
  return parseDecimalInput(value);
}

function PlacementGeometryPanel({
  document,
  entity,
  selectedId,
  onAssignBodyToSelected,
  onMove,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
  selectedId: number;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onMove(x: string, y: string, z: string): void;
  onSelectEntity(entityId: number): void;
}) {
  const placement = getNativePlacementWorld(document, selectedId);
  const body = getNativeBodyRepresentation(document, selectedId);
  const [space, setSpace] = useState<PlacementCoordinateSpace>("welt");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");
  // Viewer-Raum ist Meter, IFC-Raum ist Modelleinheit (mm-Modelle!).
  const metersPerUnit = getNativeLengthUnitScale(document);
  // Abmessungen werden — wie im Builder — in METERN angezeigt und editiert;
  // die IFC-Rohwerte (Modelleinheiten) werden für die Anzeige umgerechnet.
  const bodyMeters = (value: number | undefined) =>
    value === undefined ? undefined : value * metersPerUnit;
  const [profile, setProfile] = useState<NativeBodyProfile>(
    body.profile ?? "rectangle",
  );
  const [width, setWidth] = useState(
    formatEditableNumber(bodyMeters(body.width), "1"),
  );
  const [depth, setDepth] = useState(
    formatEditableNumber(bodyMeters(body.depth), "1"),
  );
  const [height, setHeight] = useState(
    formatEditableNumber(bodyMeters(body.height), "1"),
  );

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
      ? ifcPlacementPointToViewerWorldPoint(world, metersPerUnit)
      : world;
  }, [
    metersPerUnit,
    placement?.worldX,
    placement?.worldY,
    placement?.worldZ,
    space,
  ]);

  useEffect(() => {
    setX(formatPlacementCoordinate(displayPoint.x));
    setY(formatPlacementCoordinate(displayPoint.y));
    setZ(formatPlacementCoordinate(displayPoint.z));
  }, [placement?.pointId, displayPoint.x, displayPoint.y, displayPoint.z]);

  useEffect(() => {
    setProfile(body.profile ?? "rectangle");
    setWidth(formatEditableNumber(bodyMeters(body.width), "1"));
    setDepth(formatEditableNumber(bodyMeters(body.depth ?? body.width), "1"));
    setHeight(formatEditableNumber(bodyMeters(body.height), "1"));
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
      space === "viewer"
        ? viewerWorldPointToIfcPlacementPoint(input, metersPerUnit)
        : input;
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
        title="Platzierung & Geometrie"
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
              ? "Bearbeitbar"
              : body.canAssign
                ? "Zuweisbar"
                : "Schreibgeschützt"}
          </Badge>
        }
      />

      {placement ? (
        <InfoSection title="Position">
          <SegmentedControl
            options={[
              { label: "Welt (IFC)", value: "welt" },
              { label: "Viewer", value: "viewer" },
            ]}
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
          <Button variant="default" onClick={applyMove}>
            Position übernehmen
          </Button>
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
              label={
                profile === "cylinder" ? "Durchmesser X (m)" : "Breite X (m)"
              }
              keyboardType="numeric"
              value={width}
              onChangeText={setWidth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label={
                profile === "cylinder" ? "Durchmesser Y (m)" : "Tiefe Y (m)"
              }
              keyboardType="numeric"
              value={depth}
              onChangeText={setDepth}
            />
          </ResponsiveField>
          <ResponsiveField>
            <LabeledInput
              label="Höhe Z (m)"
              keyboardType="numeric"
              value={height}
              onChangeText={setHeight}
            />
          </ResponsiveField>
        </ResponsiveRow>
        {body.message ? <TextLine>{body.message}</TextLine> : null}
        <Button
          disabled={!body.canAssign}
          variant="default"
          onClick={() => onAssignBodyToSelected(bodyDraft)}
        >
          {body.hasRepresentation
            ? "Geometrie aktualisieren"
            : "Geometrie zuweisen"}
        </Button>
      </InfoSection>

      <CollapsibleSection
        title="IFC-Referenzen"
        meta={`Produkt #${selectedId} ${entity.type}`}
      >
        {placement ? (
          <>
            <ReferenceIdRow
              document={document}
              id={placement.placementId}
              label="Placement"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.axisPlacementId}
              label="Axis"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.pointId}
              label="Point"
              onSelectEntity={onSelectEntity}
            />
            <ReferenceIdRow
              document={document}
              id={placement.relativeTo}
              label="Relativ zu"
              onSelectEntity={onSelectEntity}
            />
          </>
        ) : (
          <ReferenceIdRow
            document={document}
            label="Placement"
            onSelectEntity={onSelectEntity}
          />
        )}
        <ReferenceIdRow
          document={document}
          id={body.shapeId}
          label="Shape"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          id={body.bodyRepresentationId}
          label="Body"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          id={body.solidId}
          label="Solid"
          onSelectEntity={onSelectEntity}
        />
        <ReferenceIdRow
          document={document}
          detail={body.profileType ?? undefined}
          id={body.profileId}
          label="Profil"
          onSelectEntity={onSelectEntity}
        />
      </CollapsibleSection>
    </PanelShell>
  );
}

function ReferenceIdRow({
  detail,
  document,
  id,
  label,
  onSelectEntity,
}: {
  detail?: string;
  document: NativeIfcDocument;
  id?: number;
  label: string;
  onSelectEntity(entityId: number): void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-muted/30 px-2.5 py-1.5">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {id ? (
        <span className="flex min-w-0 items-center gap-1.5">
          {detail ? (
            <span className="truncate text-xs text-muted-foreground">
              {detail}
            </span>
          ) : null}
          <EntityChip document={document} id={id} onSelect={onSelectEntity} />
        </span>
      ) : (
        <span className="font-mono text-xs text-muted-foreground">$</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab "Eigenschaften" (Psets & Mengen)                                */
/* ------------------------------------------------------------------ */

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

  const addSelectedPset = () => {
    if (psetSource === "catalog") {
      return;
    }
    onAddEmptyPset(emptyPsetName.trim() || "Pset_IFCnative_Custom");
  };

  // Strg+F fokussiert die Pset-Suche, solange der Eigenschaften-Tab offen ist —
  // auch wenn der Fokus gerade im Baum oder Viewer liegt (wie vor dem Redesign).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        psetSearchInputRef.current?.focus();
        psetSearchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelShell scroll>
        <PanelHeader
          eyebrow={`Auswahl #${selectedId}`}
          title="Eigenschaften & Mengen"
          description={
            normalizedPsetSearch
              ? `${visibleSets.length.toLocaleString("de-DE")} von ${sets.length.toLocaleString("de-DE")} Sets sichtbar`
              : `${sets.length.toLocaleString("de-DE")} Sets verknüpft`
          }
          meta={<Badge tone="info">Psets</Badge>}
        />

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-56 flex-1">
              <Input
                ref={psetSearchInputRef}
                className="h-8"
                placeholder="Psets, Eigenschaften, Werte suchen … (Strg+F)"
                value={psetSearch}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setPsetSearch(event.currentTarget.value)}
              />
            </div>
            <SegmentedControl
              options={[
                { label: "Leeres Set", value: "empty" },
                { label: "Katalog", value: "catalog" },
              ]}
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
                    : "Keine Katalogklasse gewählt"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {catalogObject
                    ? `${catalogPsets.length.toLocaleString("de-DE")} Psets · ${catalogRuleCount.toLocaleString("de-DE")} Regeln`
                    : "Auswahl im Objektkatalog-Panel treffen"}
                </div>
              </div>
              <Button
                disabled={!catalogQuickFixes.length}
                variant="default"
                onClick={() => onApplyCatalogFindings(catalogQuickFixes)}
              >
                {catalogQuickFixes.length ? "Katalog anwenden" : "Katalog OK"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 min-w-56 flex-1"
                placeholder="Pset-Name"
                value={emptyPsetName}
                onChange={(event) =>
                  setEmptyPsetName(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSelectedPset();
                  }
                }}
              />
              <Button variant="default" onClick={addSelectedPset}>
                <Plus aria-hidden className="size-3.5" /> Pset
              </Button>
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
            Der aktuelle Pset-Filter findet keine Sets, Eigenschaften oder
            Werte.
          </EmptyBlock>
        ) : null}
        {!sets.length ? (
          <EmptyBlock title="Keine Psets">
            Über „+ Pset" ein leeres Set oder eine Vorlage aus dem
            Objektkatalog anlegen.
          </EmptyBlock>
        ) : null}

        <CollapsibleSection title="Quantity Set" meta="QTO manuell anlegen">
          <ResponsiveRow>
            <ResponsiveField>
              <LabeledInput
                label="QTO-Name"
                value={qtoName}
                onChangeText={setQtoName}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label="Mengenname"
                value={quantityName}
                onChangeText={setQuantityName}
              />
            </ResponsiveField>
          </ResponsiveRow>
          <ResponsiveRow>
            <ResponsiveField>
              <DropdownField
                label="Mengentyp"
                options={QUANTITY_TYPES}
                value={quantityType}
                onChange={setQuantityType}
              />
            </ResponsiveField>
            <ResponsiveField>
              <LabeledInput
                label="Wert"
                keyboardType="numeric"
                value={quantityValue}
                onChangeText={setQuantityValue}
              />
            </ResponsiveField>
          </ResponsiveRow>
          <Button
            variant="outline"
            onClick={() =>
              onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
            }
          >
            <Plus aria-hidden className="size-3.5" /> Quantity Set hinzufügen
          </Button>
        </CollapsibleSection>
      </PanelShell>
    </div>
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
    ? "border-l-warning/60 bg-warning/5"
    : "border-l-success/60 bg-success/5";
  const headerAccent = isQto
    ? "border-warning/25 bg-warning/10"
    : "border-success/25 bg-success/10";

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
          className="h-7 min-w-40 flex-1 rounded-md border-transparent bg-transparent px-2 text-sm font-semibold text-foreground shadow-none hover:bg-background/60 focus-visible:border-ring focus-visible:bg-background"
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
            ? `${visibleValues.length.toLocaleString("de-DE")}/${set.values.length.toLocaleString("de-DE")}`
            : set.values.length.toLocaleString("de-DE")}{" "}
          Werte
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label="Duplizieren"
            icon={<Copy aria-hidden className="size-3.5" />}
            onClick={() => onDuplicatePropertySet(set.id)}
          />
          <IconButton
            label="Löschen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onClick={() => onRemovePropertySet(set.id)}
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
            label="Eigenschaft löschen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onClick={() => onRemove(setId, property.id)}
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
            label="Wert hinzufügen"
            tone="primary"
            icon={<Plus aria-hidden className="size-3.5" />}
            onClick={onAdd}
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

/* ------------------------------------------------------------------ */
/* Tab "Beziehungen" (Beziehungen + Ressourcen)                        */
/* ------------------------------------------------------------------ */

function RelationsResourcesPanel({
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

function ResourceSections({
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

/* ------------------------------------------------------------------ */
/* Ressourcen-Zusatzpanels (eigene Mosaic-Fenster)                     */
/* ------------------------------------------------------------------ */

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

  // logLabel bleibt englisch, damit bestehende Log-/History-Zeilen
  // ("Update classification #…") unverändert bleiben.
  const { logLabel, uiLabel } =
    resource.type === "IFCCLASSIFICATIONREFERENCE"
      ? { logLabel: "Classification", uiLabel: "Klassifikation" }
      : resource.type === "IFCDOCUMENTREFERENCE"
        ? { logLabel: "Document", uiLabel: "Dokument" }
        : { logLabel: "Library", uiLabel: "Bibliothek" };

  return (
    <CompactResourceCard
      title={`${uiLabel} #${resource.id}`}
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
          `Update ${logLabel.toLowerCase()} #${resource.id}`,
        )
      }
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        <CompactTextInput
          label="Kennung"
          value={identification}
          onChangeText={setIdentification}
        />
        <CompactTextInput label="Name" value={name} onChangeText={setName} />
        <CompactTextInput
          label="Ort / URI"
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
          <Button
            className="h-7 gap-1 px-2 text-xs"
            title={`${title} speichern`}
            variant="default"
            onClick={onSave}
          >
            <Save aria-hidden className="size-3" />
            <span>Speichern</span>
          </Button>
          <Button
            className="h-7 gap-1 px-2 text-xs"
            title={`${title} Zuordnung entfernen`}
            variant="outline"
            onClick={onRemove}
          >
            <Trash2 aria-hidden className="size-3" />
            <span>Entfernen</span>
          </Button>
        </div>
      </div>
      {children}
    </section>
  );
}

function CompactTextInput({
  label,
  placeholder,
  value,
  onChangeText,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <Input
        className="h-8 min-w-0 rounded-md px-2 text-xs text-foreground"
        placeholder={placeholder}
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
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue !== null) {
            onChange(nextValue);
          }
        }}
      >
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
  disabled,
  label,
  onClick,
  title,
}: {
  disabled?: boolean;
  label: string;
  onClick(): void;
  title?: string;
}) {
  return (
    <Button
      className="h-8 w-full gap-1.5 text-xs"
      disabled={disabled}
      title={title}
      variant="outline"
      onClick={onClick}
    >
      <Plus aria-hidden className="size-3.5" />
      <span>{label}</span>
    </Button>
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
      title={`Freigabe #${resource.id}`}
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
          label="Kennung"
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
          label="Grad"
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
          label="Quelle"
          value={source}
          onChangeText={setSource}
        />
        <CompactTextInput
          label="Zweck"
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
  const [classificationId, setClassificationId] = useState("");
  const [classificationName, setClassificationName] = useState("");
  const [classificationUri, setClassificationUri] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentUri, setDocumentUri] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [libraryName, setLibraryName] = useState("");
  const [libraryUri, setLibraryUri] = useState("");

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Klassifikation & Dokumente"
        description={`${referenceAssociations.length.toLocaleString("de-DE")} verknüpfte Referenzen`}
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
            Keine Klassifikation, kein Dokument und keine Bibliothek
            zugewiesen.
          </EmptyBlock>
        )}
      </div>
      <CompactAddSection title="Klassifikation hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. DIN 276-1"
            value={classificationId}
            onChangeText={setClassificationId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Kostengruppe"
            value={classificationName}
            onChangeText={setClassificationName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={classificationUri}
            onChangeText={setClassificationUri}
          />
        </div>
        <CompactCreateButton
          disabled={!classificationId.trim() && !classificationName.trim()}
          label="Klassifikation hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Dokument hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. DOC-001"
            value={documentId}
            onChangeText={setDocumentId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Prüfbericht"
            value={documentName}
            onChangeText={setDocumentName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={documentUri}
            onChangeText={setDocumentUri}
          />
        </div>
        <CompactCreateButton
          disabled={!documentId.trim() && !documentName.trim()}
          label="Dokument hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Bibliothek hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. LIB-001"
            value={libraryId}
            onChangeText={setLibraryId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Objektbibliothek"
            value={libraryName}
            onChangeText={setLibraryName}
          />
          <CompactTextInput
            label="Ort / URI"
            placeholder="https://…"
            value={libraryUri}
            onChangeText={setLibraryUri}
          />
        </div>
        <CompactCreateButton
          disabled={!libraryId.trim() && !libraryName.trim()}
          label="Bibliothek hinzufügen"
          title="Mindestens Kennung oder Name angeben"
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
  const [approvalId, setApprovalId] = useState("");
  const [approvalName, setApprovalName] = useState("");
  const [approvalStatus, setApprovalStatus] = useState("");
  const [constraintName, setConstraintName] = useState("");
  const [constraintGrade, setConstraintGrade] = useState("HARD");
  const [constraintSource, setConstraintSource] = useState("");
  const [constraintQualifier, setConstraintQualifier] = useState("REQUIREMENT");
  const [constraintIntent, setConstraintIntent] = useState("");

  return (
    <PanelShell scroll>
      <PanelHeader
        eyebrow={`Auswahl #${selectedId}`}
        title="Freigaben & Constraints"
        description={`${controlAssociations.length.toLocaleString("de-DE")} verknüpfte Kontrollressourcen`}
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
      <CompactAddSection title="Freigabe hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Kennung"
            placeholder="z. B. APP-001"
            value={approvalId}
            onChangeText={setApprovalId}
          />
          <CompactTextInput
            label="Name"
            placeholder="z. B. Freigabe Entwurf"
            value={approvalName}
            onChangeText={setApprovalName}
          />
          <CompactTextInput
            label="Status"
            placeholder="z. B. Approved"
            value={approvalStatus}
            onChangeText={setApprovalStatus}
          />
        </div>
        <CompactCreateButton
          disabled={!approvalId.trim() && !approvalName.trim()}
          label="Freigabe hinzufügen"
          title="Mindestens Kennung oder Name angeben"
          onClick={() =>
            onAddApproval(approvalId, approvalName, approvalStatus)
          }
        />
      </CompactAddSection>
      <CompactAddSection title="Constraint hinzufügen">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
          <CompactTextInput
            label="Name"
            placeholder="z. B. Anforderung erfüllen"
            value={constraintName}
            onChangeText={setConstraintName}
          />
          <CompactSelectInput
            label="Grad"
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
            label="Quelle"
            placeholder="z. B. Bauherr"
            value={constraintSource}
            onChangeText={setConstraintSource}
          />
          <CompactTextInput
            label="Zweck"
            placeholder="z. B. EXPECTED PERFORMANCE"
            value={constraintIntent}
            onChangeText={setConstraintIntent}
          />
        </div>
        <CompactCreateButton
          label="Constraint hinzufügen"
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

/* ------------------------------------------------------------------ */
/* STEP-Parsing-Helfer                                                 */
/* ------------------------------------------------------------------ */

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
