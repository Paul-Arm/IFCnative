import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    buildDiagnosticObjectInfoDraft,
    buildDiagnosticSelectionContext,
    catalogObjectLabel,
    readDiagnosticObjectiveReferences,
    suggestDiagnosticProcedureCatalogObjects,
    type CatalogObjectType,
    type DiagnosticObjectInfoDraft,
    type DiagnosticObjectRole,
    type DiagnosticObjectiveSummary,
    type IfcObjectCatalog,
    type NativeIfcDocument,
} from "@/ifc";
import { ChevronDown, PenLine, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PsetTableSection } from "./InspectorPanel";

import {
    Badge,
    Button,
    CollapsibleSection,
    InlineAlert,
    LabeledInput,
    PanelHeader,
    PanelShell,
    SegmentedControl,
} from "./ui";

const ROLE_LABELS: Record<DiagnosticObjectRole, string> = {
  probe: "Probe",
  untersuchungsstelle: "Untersuchungsstelle",
};

export function DiagnosticsAssistantPanel({
  catalog,
  document,
  selectedId,
  onApplyObjectInfo,
  onApplyProcedure,
  onSetObjectiveReferences,
  onAddPropertyToSet,
  onDuplicatePropertySet,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onUpdateProperty,
}: {
  catalog: IfcObjectCatalog | null;
  document: NativeIfcDocument;
  selectedId: number;
  onApplyObjectInfo(draft: DiagnosticObjectInfoDraft): void;
  onApplyProcedure(objectType: CatalogObjectType): void;
  onSetObjectiveReferences(setId: number, objectiveIds: string[]): void;
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
  const [role, setRole] = useState<DiagnosticObjectRole>("probe");
  const [id, setId] = useState("");
  const [untersuchungsstelleId, setUntersuchungsstelleId] = useState("");
  const [bezeichnung, setBezeichnung] = useState("");
  const [bemerkung, setBemerkung] = useState("");
  const [procedureQuery, setProcedureQuery] = useState("");
  const context = useMemo(
    () => buildDiagnosticSelectionContext(document, selectedId),
    [document, selectedId],
  );
  const suggestedDraft = useMemo(
    () => buildDiagnosticObjectInfoDraft(document, selectedId, role),
    [document, role, selectedId],
  );
  const procedureCatalogObjects = useMemo(
    () => suggestDiagnosticProcedureCatalogObjects(catalog),
    [catalog],
  );
  const { hiddenProcedureCount, visibleProcedureCatalogObjects } =
    useMemo(() => {
      const query = procedureQuery.trim().toLowerCase();
      const matches = query
        ? procedureCatalogObjects.filter((objectType) =>
            [objectType.name, objectType.code, objectType.sheetName]
              .join(" ")
              .toLowerCase()
              .includes(query),
          )
        : procedureCatalogObjects;
      const limit = query ? 20 : 12;
      return {
        hiddenProcedureCount: Math.max(0, matches.length - limit),
        visibleProcedureCatalogObjects: matches.slice(0, limit),
      };
    }, [procedureCatalogObjects, procedureQuery]);

  useEffect(() => {
    setRole(context.detectedRole ?? "probe");
  }, [context.detectedRole, selectedId]);

  useEffect(() => {
    setId(suggestedDraft.id);
    setUntersuchungsstelleId(suggestedDraft.untersuchungsstelleId ?? "");
    setBezeichnung(suggestedDraft.bezeichnung);
    setBemerkung(suggestedDraft.bemerkung);
  }, [suggestedDraft]);

  const applyObjectInfo = () => {
    onApplyObjectInfo({
      bemerkung,
      bezeichnung,
      id,
      role,
      untersuchungsstelleId:
        role === "probe" ? untersuchungsstelleId : undefined,
    });
  };

  return (
    <PanelShell scroll>
      <PanelHeader
        title="Diagnostik-Assistent"
        meta={
          <Badge tone={context.detectedRole ? "success" : "warning"}>
            {context.detectedRole ? ROLE_LABELS[context.detectedRole] : "Neu"}
          </Badge>
        }
      />

      <CollapsibleSection
        defaultOpen
        title="Objekt deklarieren"
        meta="Untersuchungsstelle oder Probe"
      >
        <SegmentedControl
          options={[
            { label: "Untersuchungsstelle", value: "untersuchungsstelle" },
            { label: "Probe", value: "probe" },
          ]}
          value={role}
          onChange={(value) => setRole(value as DiagnosticObjectRole)}
        />
        {context.detectedRoleReason ? (
          <InlineAlert tone="info">
            Erkannt über {context.detectedRoleReason}.
          </InlineAlert>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          <LabeledInput label="_ID" mono value={id} onChangeText={setId} />
          {role === "probe" ? (
            <LabeledInput
              label="_UntersuchungsstelleID"
              mono
              value={untersuchungsstelleId}
              onChangeText={setUntersuchungsstelleId}
            />
          ) : null}
          <LabeledInput
            label="_Bezeichnung"
            value={bezeichnung}
            onChangeText={setBezeichnung}
          />
        </div>
        <LabeledInput
          label="_Bemerkung"
          multiline
          value={bemerkung}
          onChangeText={setBemerkung}
        />
        <div className="flex flex-wrap justify-end">
          <Button variant="default" onClick={applyObjectInfo}>
            <PenLine aria-hidden className="size-3.5" />
            Objektinformation schreiben
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title="Untersuchungsverfahren"
        meta={
          catalog
            ? `${procedureCatalogObjects.length.toLocaleString("de-DE")} Katalogtreffer`
            : "Kein Katalog geladen"
        }
      >
        <CollapsibleSection
          title="Vorhandene Verfahren"
          meta={`${context.procedureSets.length.toLocaleString("de-DE")} Sets`}
        >
          {context.procedureSets.length ? (
            <div className="grid gap-3">
              {context.procedureSets.map((set) => (
                <div key={set.id} className="grid gap-2">
                  <ProcedureObjectivePicker
                    disabled={!context.objectives.length}
                    objectives={context.objectives}
                    selectedObjectiveIds={readDiagnosticObjectiveReferences(
                      set,
                    )}
                    onChangeObjectiveIds={(objectiveIds) =>
                      onSetObjectiveReferences(set.id, objectiveIds)
                    }
                  />
                  <PsetTableSection
                    document={document}
                    searchActive={false}
                    set={set}
                    visibleValues={set.values}
                    onAddPropertyToSet={onAddPropertyToSet}
                    onDuplicatePropertySet={onDuplicatePropertySet}
                    onRemovePropertyFromSet={onRemovePropertyFromSet}
                    onRemovePropertySet={onRemovePropertySet}
                    onRenamePropertySet={onRenamePropertySet}
                    onUpdateProperty={onUpdateProperty}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Noch keine Verfahrens-Psets am ausgewählten Element.
            </p>
          )}
        </CollapsibleSection>

        <div className="grid gap-2">
          <Input
            className="h-8 text-xs"
            placeholder="Verfahren im Objektkatalog suchen"
            value={procedureQuery}
            onChange={(event) => setProcedureQuery(event.currentTarget.value)}
          />
          {visibleProcedureCatalogObjects.length ? (
            <>
              <div className="overflow-hidden rounded-md border border-border/60 bg-card">
                {visibleProcedureCatalogObjects.map((objectType) => (
                  <button
                    key={objectType.id}
                    type="button"
                    className="flex h-auto w-full items-center gap-2 border-b border-border/40 px-2.5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                    title="Verfahren hinzufügen"
                    onClick={() => onApplyProcedure(objectType)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {catalogObjectLabel(objectType)}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {objectType.ifcClass} ·{" "}
                        {objectType.propertyRules.length.toLocaleString(
                          "de-DE",
                        )}{" "}
                        Regeln
                      </span>
                    </span>
                    <Plus
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  </button>
                ))}
              </div>
              {hiddenProcedureCount ? (
                <p className="text-[11px] text-muted-foreground">
                  … {hiddenProcedureCount.toLocaleString("de-DE")} weitere
                  ausgeblendet
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {catalog
                ? "Keine passenden Verfahrensklassen gefunden."
                : "Objektkatalog importieren, um Verfahren aus Vorlagen anzulegen."}
            </p>
          )}
        </div>
      </CollapsibleSection>
    </PanelShell>
  );
}

function ProcedureObjectivePicker({
  disabled,
  objectives,
  selectedObjectiveIds,
  onChangeObjectiveIds,
}: {
  disabled: boolean;
  objectives: DiagnosticObjectiveSummary[];
  selectedObjectiveIds: string[];
  onChangeObjectiveIds(objectiveIds: string[]): void;
}) {
  const selectedObjectiveIdSet = new Set(selectedObjectiveIds);
  const selectedLabels = objectives
    .filter((objective) =>
      selectedObjectiveIdSet.has(objective.objectInfoId || objective.psetName),
    )
    .map((objective) => objective.label);
  const unknownSelectedCount =
    selectedObjectiveIds.length - selectedLabels.length;
  const summary = selectedObjectiveIds.length
    ? [
        ...selectedLabels,
        unknownSelectedCount ? `${unknownSelectedCount} weitere` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "Untersuchungsziele wählen";

  const toggleObjective = (objectiveId: string, checked: boolean) => {
    const nextObjectiveIds = checked
      ? [...selectedObjectiveIds, objectiveId]
      : selectedObjectiveIds.filter((selectedId) => selectedId !== objectiveId);
    onChangeObjectiveIds(nextObjectiveIds);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="min-w-0 text-xs text-muted-foreground">
        _UntersuchungszielIDs
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-8 min-w-56 max-w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-xs text-foreground shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
        >
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-80">
          <DropdownMenuLabel>Untersuchungsziele zuordnen</DropdownMenuLabel>
          {objectives.map((objective) => {
            const value = objective.objectInfoId || objective.psetName;
            return (
              <DropdownMenuCheckboxItem
                key={`${objective.psetName}-${value}`}
                checked={selectedObjectiveIdSet.has(value)}
                className="items-start gap-2 py-1.5 text-xs"
                onCheckedChange={(checked) =>
                  toggleObjective(value, checked === true)
                }
              >
                <span className="grid min-w-0 gap-0.5 pr-1">
                  <span className="truncate font-medium">
                    {objective.label}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {value}
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
