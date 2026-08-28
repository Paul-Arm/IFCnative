import { FileCheck2, Search, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
    describeCardinality,
    describeFacetBodySegments,
    describeFacetTechnical,
    IDS_FACET_TYPE_LABELS,
    validateIds,
    type IdsTextSegment,
    type IdsDocumentModel,
    type IdsEntityFailure,
    type IdsFacet,
    type IdsSpecificationResult,
    type IdsSpecificationStatus,
    type NativeIfcDocument,
    type ObjectInfoIndex,
} from "@/ifc";
import { cn } from "@/lib/utils";

import { IdCheckSection } from "./IdCheckSection";
import {
    Badge,
    Button,
    CollapsibleSection,
    EmptyState,
    InfoRow,
    InlineAlert,
    PanelHeader,
    PanelShell,
    shortType,
    type BadgeTone,
} from "./ui";

const FAILURES_CAP = 80;
const WARNINGS_CAP = 8;

const STATUS_META: Record<
  IdsSpecificationStatus,
  { label: string; tone: BadgeTone }
> = {
  fail: { label: "Fehlgeschlagen", tone: "danger" },
  "not-applicable": { label: "Nicht anwendbar", tone: "neutral" },
  pass: { label: "Bestanden", tone: "success" },
};

export function IdsPanel({
  document,
  ids,
  importing,
  objectInfoIndex,
  selectedId,
  onImportIds,
  onRemoveIds,
  onSelectEntity,
}: {
  document: NativeIfcDocument;
  ids: IdsDocumentModel | null;
  importing: boolean;
  objectInfoIndex: ObjectInfoIndex;
  selectedId: number;
  onImportIds(): void;
  onRemoveIds(): void;
  onSelectEntity(id: number): void;
}) {
  const [query, setQuery] = useState("");
  const validation = useMemo(
    () => (ids ? validateIds(document, ids) : null),
    [document, ids],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleResults = useMemo(() => {
    if (!validation) {
      return [];
    }
    if (!normalizedQuery) {
      return validation.results;
    }
    return validation.results.filter((result) =>
      [
        result.specification.name,
        result.specification.description ?? "",
        result.specification.identifier ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [validation, normalizedQuery]);

  return (
    <PanelShell>
      <PanelHeader
        actions={
          <>
            {ids ? (
              <Button title="Geladene IDS entfernen" onClick={onRemoveIds}>
                <X aria-hidden className="size-3.5" />
                Entfernen
              </Button>
            ) : null}
            <Button
              disabled={importing}
              variant="default"
              onClick={onImportIds}
            >
              <Upload aria-hidden className="size-3.5" />
              {importing ? "Lädt …" : "IDS laden"}
            </Button>
          </>
        }
        description={
          ids
            ? `${ids.fileName}${ids.info.title ? ` · ${ids.info.title}` : ""} · ${ids.specifications.length.toLocaleString("de-DE")} Spezifikationen`
            : "Information Delivery Specification (buildingSMART) gegen das aktive Modell prüfen."
        }
        eyebrow="Validierung"
        meta={
          validation ? (
            <Badge tone={validation.failCount ? "danger" : "success"}>
              {validation.failCount
                ? `${validation.failCount.toLocaleString("de-DE")} fehlgeschlagen`
                : "Bestanden"}
            </Badge>
          ) : undefined
        }
        title="IDS-Prüfung"
      />

      {!ids || !validation ? (
        <PanelShell scroll>
          <EmptyState
            action={
              <Button
                disabled={importing}
                variant="default"
                onClick={onImportIds}
              >
                <Upload aria-hidden className="size-3.5" />
                {importing ? "Lädt …" : "IDS-Datei laden …"}
              </Button>
            }
            description="Eine .ids-Datei laden, um das aktive Modell gegen ihre Spezifikationen zu prüfen. Die Prüfung läuft automatisch bei jeder Modelländerung erneut."
            title="Keine IDS geladen"
          />
          <IdCheckSection
            document={document}
            index={objectInfoIndex}
            selectedId={selectedId}
            onSelectEntity={onSelectEntity}
          />
        </PanelShell>
      ) : (
        <PanelShell scroll>
          {ids.warnings.length ? (
            <InlineAlert tone="warning">
              <div className="grid gap-0.5">
                {ids.warnings.slice(0, WARNINGS_CAP).map((warning, index) => (
                  <span key={index}>{warning}</span>
                ))}
                {ids.warnings.length > WARNINGS_CAP ? (
                  <span>
                    … {ids.warnings.length - WARNINGS_CAP} weitere Hinweise
                  </span>
                ) : null}
              </div>
            </InlineAlert>
          ) : null}

          <div className="grid shrink-0 grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
            <SummaryStat
              label="Bestanden"
              tone="success"
              value={validation.passCount}
            />
            <SummaryStat
              label="Fehlgeschlagen"
              tone="danger"
              value={validation.failCount}
            />
            <SummaryStat
              label="Nicht anwendbar"
              tone="neutral"
              value={validation.notApplicableCount}
            />
            <SummaryStat
              label="Verstöße"
              tone={validation.totalFailures ? "danger" : "neutral"}
              value={validation.totalFailures}
            />
          </div>

          {hasIdsInfo(ids) ? (
            <CollapsibleSection meta={ids.info.title} title="IDS-Info">
              {ids.info.title ? (
                <InfoRow label="Titel" value={ids.info.title} />
              ) : null}
              {ids.info.description ? (
                <InfoRow label="Beschreibung" value={ids.info.description} />
              ) : null}
              {ids.info.purpose ? (
                <InfoRow label="Zweck" value={ids.info.purpose} />
              ) : null}
              {ids.info.milestone ? (
                <InfoRow label="Meilenstein" value={ids.info.milestone} />
              ) : null}
              {ids.info.author ? (
                <InfoRow label="Autor" value={ids.info.author} />
              ) : null}
              {ids.info.date ? (
                <InfoRow label="Datum" value={ids.info.date} />
              ) : null}
              {ids.info.version ? (
                <InfoRow label="Version" value={ids.info.version} />
              ) : null}
              {ids.info.copyright ? (
                <InfoRow label="Copyright" value={ids.info.copyright} />
              ) : null}
            </CollapsibleSection>
          ) : null}

          <div className="relative shrink-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Spezifikationen filtern"
              className="h-8 pl-7 text-xs"
              placeholder="Spezifikationen filtern …"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>

          {visibleResults.length ? (
            visibleResults.map((result) => (
              <SpecificationSection
                key={`${ids.fileName}:${result.specification.id}`}
                result={result}
                onSelectEntity={onSelectEntity}
              />
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine Spezifikationen für diesen Filter.
            </p>
          )}

          {/* Deckt die Lücke, die IDS offen lässt (ID-Eindeutigkeit und
              Referenz-Auflösung) — direkt neben den IDS-Ergebnissen. */}
          <IdCheckSection
            defaultOpen={false}
            document={document}
            index={objectInfoIndex}
            selectedId={selectedId}
            onSelectEntity={onSelectEntity}
          />
        </PanelShell>
      )}
    </PanelShell>
  );
}

function SpecificationSection({
  result,
  onSelectEntity,
}: {
  result: IdsSpecificationResult;
  onSelectEntity(id: number): void;
}) {
  const { specification } = result;
  const meta = STATUS_META[result.status];
  const visibleFailures = result.failures.slice(0, FAILURES_CAP);
  const hiddenFailures = result.failures.length - visibleFailures.length;
  return (
    <CollapsibleSection
      defaultOpen={result.status === "fail"}
      meta={`${meta.label} · ${result.applicableCount.toLocaleString("de-DE")} anwendbar · ${result.failures.length.toLocaleString("de-DE")} Verstöße`}
      title={specification.name}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {specification.identifier ? (
          <Badge tone="neutral">{specification.identifier}</Badge>
        ) : null}
        {specification.ifcVersions.map((version) => (
          <Badge key={version} tone="neutral">
            {version}
          </Badge>
        ))}
        <span className="text-[11px] text-muted-foreground">
          {result.passedCount.toLocaleString("de-DE")} von{" "}
          {result.applicableCount.toLocaleString("de-DE")} Objekten bestanden
        </span>
      </div>

      {specification.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {specification.description}
        </p>
      ) : null}
      {specification.instructions ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {specification.instructions}
        </p>
      ) : null}

      {result.messages.map((message, index) => (
        <InlineAlert
          key={index}
          tone={result.status === "fail" ? "danger" : "info"}
        >
          {message}
        </InlineAlert>
      ))}

      <FacetList facets={specification.applicability} title="Anwendbarkeit" />
      <FacetList
        facets={specification.requirements}
        title="Anforderungen"
        withCardinality
      />

      {visibleFailures.length ? (
        <div className="grid gap-1">
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Verstöße
          </h4>
          <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">
            {visibleFailures.map((failure) => (
              <FailureRow
                failure={failure}
                key={failure.entityId}
                onSelectEntity={onSelectEntity}
              />
            ))}
            {hiddenFailures > 0 ? (
              <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
                … {hiddenFailures.toLocaleString("de-DE")} weitere Verstöße
                ausgeblendet
              </div>
            ) : null}
          </div>
        </div>
      ) : result.status === "pass" && result.applicableCount ? (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <FileCheck2 aria-hidden className="size-3.5" />
          Alle {result.applicableCount.toLocaleString("de-DE")} anwendbaren
          Objekte erfüllen die Anforderungen.
        </p>
      ) : null}
    </CollapsibleSection>
  );
}

function FacetList({
  facets,
  title,
  withCardinality,
}: {
  facets: IdsFacet[];
  title: string;
  withCardinality?: boolean;
}) {
  if (!facets.length) {
    return null;
  }
  return (
    <div className="grid gap-1">
      <h4 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="grid gap-1">
        {facets.map((facet, index) => (
          <FacetChip
            facet={facet}
            key={index}
            withCardinality={withCardinality}
          />
        ))}
      </div>
    </div>
  );
}

function FacetChip({
  facet,
  withCardinality,
}: {
  facet: IdsFacet;
  withCardinality?: boolean;
}) {
  const cardinality =
    withCardinality && facet.type !== "entity" ? facet.cardinality : undefined;
  const instructions = facet.type !== "entity" ? facet.instructions : undefined;
  return (
    <div
      className="grid min-w-0 gap-0.5 rounded border border-border/60 bg-muted/30 px-2 py-1"
      title={describeFacetTechnical(facet)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {IDS_FACET_TYPE_LABELS[facet.type]}
        </span>
        <span className="min-w-0 flex-1 text-[11px] leading-6 text-muted-foreground">
          <FacetSegments segments={describeFacetBodySegments(facet)} />
        </span>
        {cardinality && cardinality !== "required" ? (
          <Badge tone={cardinality === "prohibited" ? "danger" : "info"}>
            {describeCardinality(cardinality)}
          </Badge>
        ) : null}
      </div>
      {instructions ? (
        <p className="text-[10px] italic leading-relaxed text-muted-foreground/90">
          {instructions}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Facetten-Text mit hervorgehobenen Werten: Fachwerte (Pset-/Property-Namen,
 * Sollwerte) als getönte Chips, technische Tokens und Ist-Werte (Regex,
 * Datentyp) in Mono, klickbare Modellverweise (ref) mit Punktlinie,
 * Schlüsselwörter („im Pset“, „oder“, „vorhanden“) als gedämpfter Fließtext.
 */
function FacetSegments({
  segments,
  onSelectEntity,
}: {
  segments: IdsTextSegment[];
  onSelectEntity?(id: number): void;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "value") {
          return (
            <span
              className="mx-px box-decoration-clone rounded bg-primary/10 px-1 py-px font-mono text-[10px] font-medium text-primary"
              key={index}
            >
              {segment.text || "(leer)"}
            </span>
          );
        }
        if (segment.kind === "ref") {
          const entityId = segment.entityId;
          if (onSelectEntity && entityId != null) {
            return (
              <button
                className="mx-px cursor-pointer box-decoration-clone rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:bg-primary/10 hover:text-primary"
                key={index}
                title={`#${entityId} öffnen`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEntity(entityId);
                }}
              >
                {segment.text || `#${entityId}`}
              </button>
            );
          }
          return (
            <span
              className="mx-px box-decoration-clone rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground"
              key={index}
            >
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "code") {
          return (
            <span
              className="mx-px box-decoration-clone rounded bg-muted px-1 py-px font-mono text-[10px] text-foreground"
              key={index}
            >
              {segment.text}
            </span>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </>
  );
}

function FailureRow({
  failure,
  onSelectEntity,
}: {
  failure: IdsEntityFailure;
  onSelectEntity(id: number): void;
}) {
  return (
    <div
      className="grid min-w-0 cursor-pointer gap-0.5 px-2.5 py-1.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      role="button"
      tabIndex={0}
      title="Objekt öffnen"
      onClick={() => onSelectEntity(failure.entityId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectEntity(failure.entityId);
        }
      }}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[10px] text-muted-foreground">
          #{failure.entityId}
        </span>
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {shortType(failure.entityType)}
          {failure.entityName ? ` ${failure.entityName}` : ""}
        </span>
      </div>
      {failure.messages.map((message, index) => (
        <p
          className="text-[11px] leading-6 text-muted-foreground"
          key={index}
          title={message.text}
        >
          <FacetSegments
            segments={message.segments}
            onSelectEntity={onSelectEntity}
          />
        </p>
      ))}
    </div>
  );
}

function hasIdsInfo(ids: IdsDocumentModel) {
  const { info } = ids;
  return Boolean(
    info.title ||
      info.description ||
      info.purpose ||
      info.milestone ||
      info.author ||
      info.date ||
      info.version ||
      info.copyright,
  );
}

type StatTone = "danger" | "success" | "neutral";

const STAT_TONE_STYLES: Record<StatTone, { number: string; surface: string }> =
  {
    danger: {
      number: "text-destructive",
      surface: "border-destructive/30 bg-destructive/10",
    },
    neutral: {
      number: "text-foreground",
      surface: "border-border/60 bg-card",
    },
    success: {
      number: "text-success",
      surface: "border-success/25 bg-success/10",
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
