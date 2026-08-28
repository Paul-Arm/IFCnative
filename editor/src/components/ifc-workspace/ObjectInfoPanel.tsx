import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import {
    OBJECT_INFO_PSET_NAME,
    type NativeIfcDocument,
    type ObjectInfoIdDefinition,
    type ObjectInfoIdReference,
    type ObjectInfoIndex,
    type ObjectInfoValidationFinding,
    type ObjectInfoValidationFindingKind,
    type ObjectInfoValidationSeverity,
} from "@/ifc";
import { cn } from "@/lib/utils";

import { IdChip, RowList } from "./IdCheckSection";
import {
    Badge,
    CollapsibleSection,
    PanelHeader,
    PanelShell,
    shortType,
    type BadgeTone,
} from "./ui";

const FINDINGS_CAP = 200;
const DEFINITIONS_CAP = 240;
const REFERENCES_CAP = 240;

const SEVERITY_TONES: Record<ObjectInfoValidationSeverity, BadgeTone> = {
  error: "danger",
  info: "info",
  warning: "warning",
};

const SEVERITY_LABELS: Record<ObjectInfoValidationSeverity, string> = {
  error: "Fehler",
  info: "Hinweis",
  warning: "Warnung",
};

const KIND_LABELS: Record<ObjectInfoValidationFindingKind, string> = {
  "ambiguous-object-info-reference": "Mehrdeutige ID-Referenz",
  "duplicate-object-info-id": "Doppelte Objektinfo-ID",
  "empty-id-reference": "Leere ID-Referenz",
  "empty-object-info-id": "Leere Objektinfo-ID",
  "external-id-reference": "Externe ID-Referenz",
  "missing-object-info-id": "Fehlende Objektinfo-ID",
  "missing-object-info-reference": "ID-Referenz ohne Ziel",
  "unreferenced-object-info-id": "Nicht referenzierte Objektinfo-ID",
};

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
  const matchedFindings = useMemo(
    () => findings.filter((finding) => matchesFinding(finding, normalizedQuery)),
    [findings, normalizedQuery],
  );
  const matchedDefinitions = useMemo(
    () =>
      index.definitions.filter((definition) =>
        matchesDefinition(definition, normalizedQuery),
      ),
    [index.definitions, normalizedQuery],
  );
  const matchedReferences = useMemo(
    () =>
      index.references.filter((reference) =>
        matchesReference(reference, normalizedQuery),
      ),
    [index.references, normalizedQuery],
  );
  const visibleFindings = matchedFindings.slice(0, FINDINGS_CAP);
  const visibleDefinitions = matchedDefinitions.slice(0, DEFINITIONS_CAP);
  const visibleReferences = matchedReferences.slice(0, REFERENCES_CAP);
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
        description={`${index.definitions.length.toLocaleString("de-DE")} Objektinfo-IDs · ${index.references.length.toLocaleString("de-DE")} ID-Referenzen · ${findings.length.toLocaleString("de-DE")} Prüfmeldungen`}
        eyebrow="Validierung"
        meta={
          <Badge tone={errorCount ? "danger" : "success"}>
            {errorCount.toLocaleString("de-DE")} Fehler
          </Badge>
        }
        title="Objektinfo: IDs"
      />

      <PanelShell scroll>
        <div className="grid shrink-0 gap-1.5">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Filter"
              className="h-8 pl-7 text-xs"
              placeholder="Filtern nach Wert, Objekt, Property oder #ID …"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Registry: {OBJECT_INFO_PSET_NAME}._ID · Referenzen: Properties mit
            Suffix „ID“, ohne _ID.
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
          <SummaryStat label="Fehler" tone="danger" value={errorCount} />
          <SummaryStat label="Warnungen" tone="warning" value={warningCount} />
          <SummaryStat label="Hinweise" tone="info" value={infoCount} />
          <SummaryStat
            label="Externe _ID"
            tone="neutral"
            value={index.externalDefinitions.length}
          />
        </div>

        <CollapsibleSection
          defaultOpen
          meta={sectionMeta(visibleFindings.length, findings.length)}
          title="Prüfmeldungen"
        >
          {visibleFindings.length ? (
            <RowList>
              {visibleFindings.map((finding) => (
                <FindingRow
                  document={document}
                  finding={finding}
                  key={finding.id}
                  selectedId={selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
              <HiddenHint
                count={matchedFindings.length - visibleFindings.length}
              />
            </RowList>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine Prüfmeldungen für diesen Filter.
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          defaultOpen
          meta={sectionMeta(visibleDefinitions.length, index.definitions.length)}
          title="Objektinfo-Registry"
        >
          {visibleDefinitions.length ? (
            <RowList>
              {visibleDefinitions.map((definition) => (
                <DefinitionRow
                  definition={definition}
                  key={`${definition.entityId}:${definition.propertyId}`}
                  selected={definition.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
              <HiddenHint
                count={matchedDefinitions.length - visibleDefinitions.length}
              />
            </RowList>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine Objektinfo-IDs gefunden.
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          meta={sectionMeta(visibleReferences.length, index.references.length)}
          title="ID-Referenzen"
        >
          {visibleReferences.length ? (
            <RowList>
              {visibleReferences.map((reference) => (
                <ReferenceRow
                  key={`${reference.entityId}:${reference.propertyId}`}
                  reference={reference}
                  selected={reference.entityId === selectedId}
                  onSelectEntity={onSelectEntity}
                />
              ))}
              <HiddenHint
                count={matchedReferences.length - visibleReferences.length}
              />
            </RowList>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine ID-Referenzen gefunden.
            </p>
          )}
        </CollapsibleSection>
      </PanelShell>
    </PanelShell>
  );
}

type StatTone = "danger" | "warning" | "info" | "neutral";

const STAT_TONE_STYLES: Record<StatTone, { surface: string; number: string }> =
  {
    danger: {
      number: "text-destructive",
      surface: "border-destructive/30 bg-destructive/10",
    },
    info: {
      number: "text-info",
      surface: "border-info/30 bg-info/10",
    },
    neutral: {
      number: "text-foreground",
      surface: "border-border/60 bg-card",
    },
    warning: {
      number: "text-warning-foreground dark:text-warning",
      surface: "border-warning/30 bg-warning/10",
    },
  };

function SummaryStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: StatTone;
  value: number;
}) {
  const active = value > 0;
  const styles = STAT_TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2.5 py-2",
        active ? styles.surface : "border-border/60 bg-card",
      )}
    >
      <div
        className={cn(
          "text-lg font-semibold leading-tight tabular-nums",
          active ? styles.number : "text-muted-foreground",
        )}
      >
        {value.toLocaleString("de-DE")}
      </div>
      <div className="truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}


function HiddenHint({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
      … {count.toLocaleString("de-DE")} weitere ausgeblendet
    </div>
  );
}

function SelectableRow({
  children,
  onSelect,
  selected,
  title,
}: {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-0.5 px-2.5 py-1.5 transition-colors",
        onSelect &&
          "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
        selected && "bg-primary/10",
      )}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      title={title}
      onClick={onSelect}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      {children}
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
  const primaryTargetId = finding.entityId ?? targetEntityId;
  const selected = finding.entityId === selectedId;
  return (
    <SelectableRow
      selected={selected}
      title={primaryTargetId ? "Objekt öffnen" : undefined}
      onSelect={
        primaryTargetId ? () => onSelectEntity(primaryTargetId) : undefined
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={SEVERITY_TONES[finding.severity]}>
          {SEVERITY_LABELS[finding.severity]}
        </Badge>
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={finding.kind}
        >
          {KIND_LABELS[finding.kind] ?? finding.kind}
        </span>
        {finding.entityId && targetEntityId ? (
          <IdChip
            label={`→ #${targetEntityId}`}
            title="Ziel öffnen"
            onSelect={() => onSelectEntity(targetEntityId)}
          />
        ) : null}
      </div>
      <p
        className="truncate text-xs text-muted-foreground"
        title={finding.message}
      >
        {finding.message}
      </p>
      <div className="truncate text-[11px] text-muted-foreground">
        {finding.value ? `${finding.value} · ` : ""}
        {finding.entityId
          ? entityLabel(document, finding.entityId)
          : "Dokument"}
      </div>
    </SelectableRow>
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
  const detail = `${shortType(definition.entityType)}${
    definition.entityName ? ` ${definition.entityName}` : ""
  } · ${definition.psetName}.${definition.propertyName}`;
  return (
    <SelectableRow
      selected={selected}
      title="Objekt öffnen"
      onSelect={() => onSelectEntity(definition.entityId)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {definition.value || "–"}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          #{definition.entityId}
        </span>
      </div>
      <div
        className="truncate text-[11px] text-muted-foreground"
        title={`#${definition.entityId} ${definition.entityType} ${definition.entityName} · #${definition.psetId} ${definition.psetName} · #${definition.propertyId} ${definition.propertyName}`}
      >
        {detail}
      </div>
    </SelectableRow>
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
  const detail = `#${reference.entityId} ${shortType(reference.entityType)}${
    reference.entityName ? ` ${reference.entityName}` : ""
  } · ${reference.psetName}.${reference.propertyName}`;
  return (
    <SelectableRow
      selected={selected}
      title="Objekt öffnen"
      onSelect={() => onSelectEntity(reference.entityId)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">
          {reference.value || "–"}
        </span>
        {resolved ? (
          <IdChip
            label={`→ #${resolved}`}
            title={`Ziel öffnen: Objektinfo-Ziel #${resolved}`}
            onSelect={() => onSelectEntity(resolved)}
          />
        ) : external ? (
          <IdChip
            label={`extern #${external}`}
            title={`Extern öffnen: Externe _ID-Familie #${external}`}
            onSelect={() => onSelectEntity(external)}
          />
        ) : (
          <span className="shrink-0 text-[10px] font-medium text-destructive">
            Kein Ziel gefunden
          </span>
        )}
      </div>
      <div
        className="truncate text-[11px] text-muted-foreground"
        title={`${detail} · #${reference.psetId} ${reference.psetName} · #${reference.propertyId} ${reference.propertyName}`}
      >
        {detail}
      </div>
    </SelectableRow>
  );
}

function sectionMeta(shown: number, total: number) {
  return `${shown.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")} sichtbar`;
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
