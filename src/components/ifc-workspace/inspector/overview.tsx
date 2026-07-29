import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  type NativeIfcDocument,
  type NativeIfcEntity,
  type ObjectInfoIndex,
  type ObjectInfoValidationFinding,
} from "@/ifc";

import { UNIT_NAMES, UNIT_TYPES } from "../constants";
import { findTreePath } from "../StructurePanel";
import type { EntityEditDraft } from "../types";
import {
  Badge,
  Button,
  CollapsibleSection,
  CommitInput,
  DropdownField,
  EmptyState,
  InfoRow,
  InfoSection,
  LabeledInput,
  PanelHeader,
  PanelShell,
  shortType,
} from "../ui";
import {
  EntitySpecificIdentityFields,
  IdentityEditRow,
  identityClassOptions,
} from "./identity";
import { ObjectInfoSummary } from "./object-info";
import {
  CappedItems,
  CodeBlock,
  CopyIconButton,
  EntityChip,
  ResponsiveField,
  ResponsiveRow,
  SubHeading,
  TextLine,
} from "./shared";

/* ------------------------------------------------------------------ */
/* Startseite ohne Auswahl: Dokument-Übersicht                         */
/* ------------------------------------------------------------------ */

export function DocumentOverview({
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

export function OverviewPanel({
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
