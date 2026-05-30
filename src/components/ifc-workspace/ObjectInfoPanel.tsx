import { useMemo, useState } from "react";

import {
    OBJECT_INFO_PSET_NAME,
    type NativeIfcDocument,
    type ObjectInfoIdDefinition,
    type ObjectInfoIdReference,
    type ObjectInfoIndex,
    type ObjectInfoValidationFinding,
} from "@/ifc";
import { cn } from "@/lib/utils";

import {
    Badge,
    Button,
    CollapsibleSection,
    LabeledInput,
    PanelHeader,
    PanelShell,
} from "./ui";

export function ObjectInfoPanel({
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
  onSelectEntity(id: number): void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearch(query);
  const visibleFindings = useMemo(
    () =>
      findings
        .filter((finding) => matchesFinding(finding, normalizedQuery))
        .slice(0, 200),
    [findings, normalizedQuery],
  );
  const visibleDefinitions = useMemo(
    () =>
      index.definitions
        .filter((definition) => matchesDefinition(definition, normalizedQuery))
        .slice(0, 240),
    [index.definitions, normalizedQuery],
  );
  const visibleReferences = useMemo(
    () =>
      index.references
        .filter((reference) => matchesReference(reference, normalizedQuery))
        .slice(0, 240),
    [index.references, normalizedQuery],
  );
  const errorCount = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warningCount = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  const infoCount = findings.filter(
    (finding) => finding.severity === "info",
  ).length;

  return (
    <PanelShell>
      <PanelHeader
        title="Objektinfo: IDs"
        description={`${index.definitions.length.toLocaleString()} Objektinfo-IDs / ${index.references.length.toLocaleString()} ID-Referenzen / ${findings.length.toLocaleString()} Findings`}
        meta={
          <Badge tone={errorCount ? "danger" : "success"}>
            {errorCount} Fehler
          </Badge>
        }
      />

      <PanelShell scroll>
        <div className="grid gap-3 rounded-xl border bg-card/80 p-3">
          <p className="text-sm text-muted-foreground">
            Registry: {OBJECT_INFO_PSET_NAME}._ID. Referenzen: Properties mit
            Suffix ID, ohne _ID.
          </p>
          <LabeledInput label="Filter" value={query} onChangeText={setQuery} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Fehler" value={errorCount} />
          <SummaryCard label="Warnungen" value={warningCount} />
          <SummaryCard label="Info" value={infoCount} />
          <SummaryCard
            label="Externe _ID"
            value={index.externalDefinitions.length}
          />
        </div>

        <CollapsibleSection
          defaultOpen
          title="Findings"
          meta={`${visibleFindings.length.toLocaleString()} sichtbar`}
        >
          {visibleFindings.length ? (
            <div className="grid gap-2">
              {visibleFindings.map((finding) => (
                <FindingRow
                  document={document}
                  finding={finding}
                  key={finding.id}
                  selectedId={selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine Findings fuer diesen Filter.
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          defaultOpen
          title="Objektinfo-Registry"
          meta={`${visibleDefinitions.length.toLocaleString()} sichtbar`}
        >
          {visibleDefinitions.length ? (
            <div className="grid gap-2">
              {visibleDefinitions.map((definition) => (
                <DefinitionRow
                  definition={definition}
                  key={`${definition.entityId}:${definition.propertyId}`}
                  selected={definition.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine Objektinfo-IDs gefunden.
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="ID-Referenzen"
          meta={`${visibleReferences.length.toLocaleString()} sichtbar`}
        >
          {visibleReferences.length ? (
            <div className="grid gap-2">
              {visibleReferences.map((reference) => (
                <ReferenceRow
                  key={`${reference.entityId}:${reference.propertyId}`}
                  reference={reference}
                  selected={reference.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Keine ID-Referenzen gefunden.
            </p>
          )}
        </CollapsibleSection>
      </PanelShell>
    </PanelShell>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card/80 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function FindingRow({
  document,
  finding,
  selectedId,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  finding: ObjectInfoValidationFinding;
  selectedId: number;
  onSelectEntity(id: number): void;
}) {
  const targetEntityId =
    finding.definitions?.[0]?.entityId ??
    finding.externalDefinitions?.[0]?.entityId;
  const selected = finding.entityId === selectedId;
  return (
    <div
      className={cn(
        "grid gap-2 rounded-xl border bg-card/80 p-3",
        selected && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="text-sm font-medium text-foreground">
        {finding.severity.toUpperCase()} / {finding.kind}
      </div>
      <p className="text-sm text-muted-foreground">{finding.message}</p>
      <div className="truncate text-xs text-muted-foreground">
        {finding.value ? `${finding.value} / ` : ""}
        {finding.entityId
          ? entityLabel(document, finding.entityId)
          : "Dokument"}
      </div>
      <div className="flex flex-wrap gap-2">
        {finding.entityId ? (
          <Button
            label="Objekt oeffnen"
            onPress={() => onSelectEntity(finding.entityId as number)}
          />
        ) : null}
        {targetEntityId ? (
          <Button
            label="Ziel oeffnen"
            onPress={() => onSelectEntity(targetEntityId)}
          />
        ) : null}
      </div>
    </div>
  );
}

function DefinitionRow({
  definition,
  selected,
  onSelectEntity,
}: {
  definition: ObjectInfoIdDefinition;
  selected: boolean;
  onSelectEntity(id: number): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectEntity(definition.entityId)}
      className={cn(
        "grid gap-1 rounded-xl border bg-card/80 p-3 text-left hover:bg-muted/50",
        selected && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="text-sm font-medium text-foreground">
        {definition.value || "-"}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        #{definition.entityId} {definition.entityType}{" "}
        {definition.entityName || ""}
      </div>
      <div className="text-sm text-muted-foreground">
        #{definition.psetId} {definition.psetName} / #{definition.propertyId}{" "}
        {definition.propertyName}
      </div>
    </button>
  );
}

function ReferenceRow({
  reference,
  selected,
  onSelectEntity,
}: {
  reference: ObjectInfoIdReference;
  selected: boolean;
  onSelectEntity(id: number): void;
}) {
  const resolved = reference.targetDefinitions[0]?.entityId;
  const external = reference.externalDefinitions[0]?.entityId;
  return (
    <div
      className={cn(
        "grid gap-2 rounded-xl border bg-card/80 p-3",
        selected && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="text-sm font-medium text-foreground">
        {reference.value || "-"}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        #{reference.entityId} {reference.entityType}{" "}
        {reference.entityName || ""}
      </div>
      <div className="text-sm text-muted-foreground">
        {reference.psetName}.{reference.propertyName}
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {resolved
          ? `Objektinfo-Ziel #${resolved}`
          : external
            ? `Externe _ID-Familie #${external}`
            : "Kein Ziel gefunden"}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          label="Objekt oeffnen"
          onPress={() => onSelectEntity(reference.entityId)}
        />
        {resolved ? (
          <Button
            label="Ziel oeffnen"
            onPress={() => onSelectEntity(resolved)}
          />
        ) : external ? (
          <Button
            label="Extern oeffnen"
            onPress={() => onSelectEntity(external)}
          />
        ) : null}
      </div>
    </div>
  );
}

function matchesFinding(
  finding: ObjectInfoValidationFinding,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    finding.kind,
    finding.message,
    finding.propertyName,
    finding.psetName,
    finding.value,
    finding.entityId ? `#${finding.entityId}` : "",
  ].some((value) => normalizeSearch(value ?? "").includes(normalizedQuery));
}

function matchesDefinition(
  definition: ObjectInfoIdDefinition,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    definition.value,
    definition.entityName,
    definition.entityType,
    definition.propertyName,
    definition.psetName,
    `#${definition.entityId}`,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function matchesReference(
  reference: ObjectInfoIdReference,
  normalizedQuery: string,
) {
  if (!normalizedQuery) {
    return true;
  }
  return [
    reference.value,
    reference.entityName,
    reference.entityType,
    reference.propertyName,
    reference.psetName,
    `#${reference.entityId}`,
  ].some((value) => normalizeSearch(value).includes(normalizedQuery));
}

function entityLabel(document: NativeIfcDocument, entityId: number) {
  const entity = document.entityById.get(entityId);
  return entity
    ? `#${entityId} ${entity.type} ${entity.name || ""}`
    : `#${entityId}`;
}

function normalizeSearch(value = "") {
  return value.trim().toLowerCase();
}
