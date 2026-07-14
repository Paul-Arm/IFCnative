import { FileUp, Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import {
    CATALOG_KINDS,
    catalogKindLabel,
    catalogObjectLabel,
    normalizeCatalogToken,
    type CatalogFindingKind,
    type CatalogFindingSeverity,
    type CatalogKind,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
    type NativeIfcDocument,
} from "@/ifc";
import { cn } from "@/lib/utils";

import {
    Badge,
    Button,
    CollapsibleSection,
    EmptyState,
    LabeledInput,
    PanelHeader,
    PanelShell,
    SegmentedControl,
    shortType,
    type BadgeTone,
} from "./ui";

const CATALOG_KIND_OPTIONS = CATALOG_KINDS.map((kind) => ({
  label: catalogKindLabel(kind),
  value: kind,
}));

export function CatalogPanel({
  catalog,
  catalogKind,
  document,
  importing,
  selectedCatalogObjectId,
  selectedId,
  onChangeCatalogKind,
  onImportCatalog,
  onSelectCatalogObject,
}: {
  catalog: IfcObjectCatalog | null;
  catalogKind: CatalogKind;
  document: NativeIfcDocument;
  importing: boolean;
  selectedCatalogObjectId: string;
  selectedId: number;
  onChangeCatalogKind(kind: CatalogKind): void;
  onImportCatalog(): Promise<void>;
  onSelectCatalogObject(id: string): void;
}) {
  const [query, setQuery] = useState("");
  const selectedEntity = document.entityById.get(selectedId);
  const { hiddenCount, visibleObjects } = useMemo(() => {
    const token = normalizeCatalogToken(query);
    const objects = catalog?.objectTypes ?? [];
    const matches = token
      ? objects.filter((objectType) =>
          [
            objectType.name,
            objectType.code,
            objectType.ifcClass,
            objectType.sheetName,
          ]
            .map(normalizeCatalogToken)
            .some((value) => value.includes(token)),
        )
      : objects;
    const cap = token ? 120 : 80;
    return {
      hiddenCount: Math.max(0, matches.length - cap),
      visibleObjects: matches.slice(0, cap),
    };
  }, [catalog?.objectTypes, query]);

  return (
    <PanelShell>
      <PanelHeader
        title="Objektkatalog"
        description={
          catalog
            ? `${catalogKindLabel(catalog.kind)}: ${catalog.objectTypes.length.toLocaleString("de-DE")} Klassen / ${countProperties(catalog).toLocaleString("de-DE")} Property-Regeln`
            : "Kein Katalog geladen."
        }
        meta={
          catalog ? (
            <Badge tone="success">{catalogKindLabel(catalog.kind)}</Badge>
          ) : null
        }
        actions={
          <Button
            disabled={importing}
            title="Objektkatalog aus einer Excel-Datei importieren"
            variant={catalog ? "outline" : "default"}
            onClick={() => void onImportCatalog()}
          >
            <FileUp className="size-3.5" />
            {importing ? "Importiere …" : "Katalog importieren"}
          </Button>
        }
      />

      <div className="grid shrink-0 gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Katalogtyp
        </span>
        <SegmentedControl
          options={CATALOG_KIND_OPTIONS}
          value={catalogKind}
          onChange={(value) => onChangeCatalogKind(value as CatalogKind)}
        />
        <span className="text-[11px] text-muted-foreground">
          Wird beim nächsten Import verwendet (Diagnostik = openSIM BWD,
          Monitoring = openSIM MON).
        </span>
      </div>

      {catalog ? (
        <PanelShell scroll>
          <CollapsibleSection
            defaultOpen
            title="Auswahl"
            meta={
              selectedEntity
                ? `#${selectedId} ${shortType(selectedEntity.type)}`
                : "–"
            }
          >
            <LabeledInput
              label="Katalogfilter"
              value={query}
              onChangeText={setQuery}
            />
            <div className="overflow-hidden rounded-md border border-border/60 bg-card">
              <div className="max-h-72 divide-y divide-border/50 overflow-y-auto">
                {visibleObjects.length ? (
                  visibleObjects.map((objectType) => {
                    const selected =
                      objectType.id === selectedCatalogObjectId;
                    return (
                      <button
                        type="button"
                        key={objectType.id}
                        onClick={() => onSelectCatalogObject(objectType.id)}
                        className={cn(
                          "flex w-full items-center gap-2 border-l-2 border-l-transparent px-2 py-1 text-left transition-colors hover:bg-muted/50",
                          selected && "border-l-primary bg-accent",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {catalogObjectLabel(objectType)}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {shortType(objectType.ifcClass)} ·{" "}
                            {objectType.propertyRules.length.toLocaleString(
                              "de-DE",
                            )}{" "}
                            Regeln
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-2.5 py-3 text-xs text-muted-foreground">
                    Keine Klassen für den aktuellen Filter gefunden.
                  </p>
                )}
              </div>
              {hiddenCount ? (
                <div className="border-t border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                  … {hiddenCount.toLocaleString("de-DE")} weitere ausgeblendet
                </div>
              ) : null}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Importdiagnose" meta={catalog.fileName}>
            {catalog.diagnostics.length ? (
              catalog.diagnostics.map((diagnostic, index) => (
                <code
                  key={`${index}-${diagnostic}`}
                  className="block rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] break-words text-foreground"
                >
                  {diagnostic}
                </code>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Keine Auffälligkeiten beim Import.
              </p>
            )}
          </CollapsibleSection>
        </PanelShell>
      ) : (
        <EmptyState
          title="Kein Katalog geladen"
          description="Excel-Datei importieren, danach erscheint die Katalogprüfung."
        />
      )}
    </PanelShell>
  );
}

export function CatalogReviewPanel({
  catalog,
  findings,
  selectedCatalogObjectId,
  onApplyFinding,
}: {
  catalog: IfcObjectCatalog | null;
  findings: CatalogValidationFinding[];
  selectedCatalogObjectId: string;
  onApplyFinding(finding: CatalogValidationFinding): void;
}) {
  const selectedObject = catalog?.objectTypes.find(
    (objectType) => objectType.id === selectedCatalogObjectId,
  );
  const quickFixCount = findings.filter((finding) => finding.quickFix).length;

  return (
    <PanelShell>
      <PanelHeader
        title="Objektkatalog: Prüfung"
        description={
          selectedObject
            ? `${catalogObjectLabel(selectedObject)} / ${findings.length.toLocaleString("de-DE")} Findings`
            : catalog
              ? "Keine Katalogklasse gewählt."
              : "Kein Katalog geladen."
        }
        meta={
          quickFixCount ? (
            <Badge tone="warning">{quickFixCount} Fixes</Badge>
          ) : null
        }
      />

      {catalog ? (
        <PanelShell scroll>
          {selectedObject ? (
            <section className="grid shrink-0 gap-1.5 rounded-lg border border-border/60 bg-card p-2.5">
              <h3 className="min-w-0 truncate text-sm font-medium text-foreground">
                {catalogObjectLabel(selectedObject)}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="info">{shortType(selectedObject.ifcClass)}</Badge>
                <Badge tone="neutral">Sheet {selectedObject.sheetName}</Badge>
                <Badge tone="neutral">
                  Version {selectedObject.version || "–"}
                </Badge>
                <Badge tone="neutral">
                  {selectedObject.propertyRules
                    .filter((rule) => rule.requirement === "required")
                    .length.toLocaleString("de-DE")}{" "}
                  Pflicht /{" "}
                  {selectedObject.propertyRules.length.toLocaleString("de-DE")}{" "}
                  Properties
                </Badge>
              </div>
            </section>
          ) : null}

          {findings.length ? (
            <div className="grid content-start gap-1.5">
              <p className="text-xs text-muted-foreground">
                {findings.length.toLocaleString("de-DE")} Warnungen,{" "}
                {quickFixCount.toLocaleString("de-DE")} Quick-Fixes
              </p>
              <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">
                {findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="flex items-start gap-2 px-2 py-1.5"
                  >
                    <Badge tone={severityTone(finding.severity)}>
                      {severityLabel(finding.severity)}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-foreground">
                        {findingKindLabel(finding.kind)}
                      </div>
                      <p className="text-xs leading-snug break-words text-muted-foreground">
                        {finding.message}
                      </p>
                    </div>
                    {finding.quickFix ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title={finding.quickFix.label}
                        onClick={() => onApplyFinding(finding)}
                      >
                        <Wrench className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : selectedObject ? (
            <EmptyState
              title="Keine Warnungen"
              description="Keine Katalogwarnungen für die aktuelle Kombination."
            />
          ) : (
            <EmptyState
              title="Keine Klasse gewählt"
              description="Im Objektkatalog-Panel muss eine Katalogklasse gewählt werden, um die Prüfung anzuzeigen."
            />
          )}
        </PanelShell>
      ) : (
        <EmptyState
          title="Kein Katalog geladen"
          description="Excel-Datei im Objektkatalog-Panel importieren."
        />
      )}
    </PanelShell>
  );
}

const FINDING_KIND_LABELS: Record<CatalogFindingKind, string> = {
  "class-mismatch": "Klassenabweichung",
  "missing-classification": "Fehlende Klassifikation",
  "missing-pset": "Fehlendes Property-Set",
  "missing-property": "Fehlende Property",
  "property-type-mismatch": "Typabweichung",
  "empty-required-value": "Leerer Pflichtwert",
};

function findingKindLabel(kind: CatalogFindingKind) {
  return FINDING_KIND_LABELS[kind] ?? kind;
}

function severityTone(severity: CatalogFindingSeverity): BadgeTone {
  return severity === "error"
    ? "danger"
    : severity === "warning"
      ? "warning"
      : "info";
}

function severityLabel(severity: CatalogFindingSeverity) {
  return severity === "error"
    ? "Fehler"
    : severity === "warning"
      ? "Warnung"
      : "Info";
}

function countProperties(catalog: IfcObjectCatalog) {
  return catalog.objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
}
