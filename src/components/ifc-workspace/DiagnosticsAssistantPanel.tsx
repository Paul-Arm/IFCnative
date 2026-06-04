import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    buildDiagnosticObjectInfoDraft,
    buildDiagnosticSelectionContext,
    catalogObjectLabel,
    suggestDiagnosticProcedureCatalogObjects,
    type CatalogObjectType,
    type DiagnosticObjectInfoDraft,
    type DiagnosticObjectRole,
    type IfcObjectCatalog,
    type NativeIfcDocument,
} from "@/ifc";
import { useEffect, useMemo, useState } from "react";

import { PsetTableSection } from "./InspectorPanel";

import {
    Badge,
    Button,
    CollapsibleSection,
    LabeledInput,
    PanelHeader,
    PanelShell,
    SegmentedControl,
} from "./ui";

export function DiagnosticsAssistantPanel({
  catalog,
  document,
  selectedId,
  onApplyObjectInfo,
  onApplyProcedure,
  onAddObjectiveReference,
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
  onAddObjectiveReference(setId: number, objectiveId: string): void;
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
  const visibleProcedureCatalogObjects = useMemo(() => {
    const query = procedureQuery.trim().toLowerCase();
    if (!query) {
      return procedureCatalogObjects.slice(0, 12);
    }
    return procedureCatalogObjects
      .filter((objectType) =>
        [objectType.name, objectType.code, objectType.sheetName]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 20);
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
            {context.detectedRole ?? "neu"}
          </Badge>
        }
      />

      <CollapsibleSection
        defaultOpen
        title="Objekt deklarieren"
        meta="Untersuchungsstelle oder Probe"
      >
        <SegmentedControl
          options={["untersuchungsstelle", "probe"]}
          value={role}
          onChange={(value) => setRole(value as DiagnosticObjectRole)}
        />
        {context.detectedRoleReason ? (
          <div className="rounded-md border border-emerald-200/70 bg-emerald-50/60 px-2.5 py-1.5 text-xs text-emerald-800">
            Erkannt ueber {context.detectedRoleReason}.
          </div>
        ) : null}
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
        <LabeledInput
          label="_Bemerkung"
          multiline
          value={bemerkung}
          onChangeText={setBemerkung}
        />
        <Button
          label="Objektinformation schreiben"
          primary
          onPress={applyObjectInfo}
        />
      </CollapsibleSection>

      <CollapsibleSection
        defaultOpen
        title="Untersuchungsverfahren"
        meta={
          catalog
            ? `${procedureCatalogObjects.length} Katalogtreffer`
            : "Kein Katalog geladen"
        }
      >
        <CollapsibleSection
          title="Vorhandene Verfahren"
          meta={`${context.procedureSets.length.toLocaleString()} Sets`}
        >
          {context.procedureSets.length ? (
            <div className="grid gap-3">
              {context.procedureSets.map((set) => (
                <div key={set.id} className="grid gap-2">
                  <ProcedureObjectivePicker
                    disabled={!context.objectives.length}
                    objectives={context.objectives}
                    onSelectObjective={(objectiveId) =>
                      onAddObjectiveReference(set.id, objectiveId)
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
              Noch keine Verfahrens-Psets am ausgewaehlten Element.
            </p>
          )}
        </CollapsibleSection>

        <div className="grid gap-2">
          <Input
            className="h-8"
            placeholder="Verfahren im Objektkatalog suchen"
            value={procedureQuery}
            onChange={(event) => setProcedureQuery(event.currentTarget.value)}
          />
          {visibleProcedureCatalogObjects.length ? (
            <div className="grid gap-2">
              {visibleProcedureCatalogObjects.map((objectType) => (
                <div
                  key={objectType.id}
                  className="grid gap-2 rounded-md border border-border/60 bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {catalogObjectLabel(objectType)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {objectType.ifcClass} / {objectType.propertyRules.length}{" "}
                      Regeln
                    </div>
                  </div>
                  <Button
                    label="Verfahren hinzufuegen"
                    onPress={() => onApplyProcedure(objectType)}
                  />
                </div>
              ))}
            </div>
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
  onSelectObjective,
}: {
  disabled: boolean;
  objectives: Array<{ label: string; objectInfoId?: string; psetName: string }>;
  onSelectObjective(objectiveId: string): void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
      <div className="min-w-0 text-xs text-muted-foreground">
        _UntersuchungszielIDs hinzufuegen
      </div>
      <Select
        disabled={disabled}
        value=""
        onValueChange={(value) => {
          if (value) {
            onSelectObjective(value);
          }
        }}
      >
        <SelectTrigger className="h-8 min-w-56" size="sm">
          <SelectValue placeholder="Untersuchungsziel waehlen" />
        </SelectTrigger>
        <SelectContent align="end" className="max-h-72">
          {objectives.map((objective) => {
            const value = objective.objectInfoId || objective.psetName;
            return (
              <SelectItem key={`${objective.psetName}-${value}`} value={value}>
                {objective.label} · {value}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
