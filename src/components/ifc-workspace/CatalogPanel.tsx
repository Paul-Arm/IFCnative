import { useMemo, useState } from "react";

import {
    CATALOG_KINDS,
    catalogKindLabel,
    catalogObjectLabel,
    normalizeCatalogToken,
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
    LabeledInput,
    PanelHeader,
    PanelShell,
    SegmentedControl,
} from "./ui";

const CATALOG_KIND_LABELS = CATALOG_KINDS.map(catalogKindLabel);

function catalogKindFromLabel(label: string): CatalogKind {
  return (
    CATALOG_KINDS.find((kind) => catalogKindLabel(kind) === label) ??
    "diagnostik"
  );
}

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
  const visibleObjects = useMemo(() => {
    const token = normalizeCatalogToken(query);
    const objects = catalog?.objectTypes ?? [];
    if (!token) {
      return objects.slice(0, 80);
    }
    return objects
      .filter((objectType) =>
        [
          objectType.name,
          objectType.code,
          objectType.ifcClass,
          objectType.sheetName,
        ]
          .map(normalizeCatalogToken)
          .some((value) => value.includes(token)),
      )
      .slice(0, 120);
  }, [catalog?.objectTypes, query]);

  return (
    <PanelShell>
      <PanelHeader
        title="Objektkatalog"
        description={
          catalog
            ? `${catalogKindLabel(catalog.kind)}: ${catalog.objectTypes.length.toLocaleString()} Klassen / ${countProperties(catalog).toLocaleString()} Property-Regeln`
            : "Kein Katalog geladen."
        }
        meta={
          catalog ? <Badge tone="success">{catalogKindLabel(catalog.kind)}</Badge> : null
        }
        actions={
          <Button
            disabled={importing}
            label={importing ? "Import..." : "Import Catalog"}
            primary={!catalog}
            onPress={() => void onImportCatalog()}
          />
        }
      />

      <div className="grid gap-1 px-1 pb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Katalogtyp
        </span>
        <SegmentedControl
          options={CATALOG_KIND_LABELS}
          value={catalogKindLabel(catalogKind)}
          onChange={(label) => onChangeCatalogKind(catalogKindFromLabel(label))}
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
              selectedEntity ? `#${selectedId} ${selectedEntity.type}` : "-"
            }
          >
            <LabeledInput
              label="Katalogfilter"
              value={query}
              onChangeText={setQuery}
            />
            <div className="grid max-h-72 gap-2 overflow-auto pr-1">
              {visibleObjects.map((objectType) => {
                const selected = objectType.id === selectedCatalogObjectId;
                return (
                  <button
                    type="button"
                    key={objectType.id}
                    onClick={() => onSelectCatalogObject(objectType.id)}
                    className={cn(
                      "grid gap-1 rounded-lg border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50",
                      selected && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <span className="truncate font-medium text-foreground">
                      {catalogObjectLabel(objectType)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {objectType.ifcClass} /{" "}
                      {objectType.propertyRules.length.toLocaleString()} Regeln
                    </span>
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Importdiagnose" meta={catalog.fileName}>
            {catalog.diagnostics.map((diagnostic) => (
              <code
                key={diagnostic}
                className="block rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground"
              >
                {diagnostic}
              </code>
            ))}
          </CollapsibleSection>
        </PanelShell>
      ) : (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed bg-muted/20 p-6 text-center">
          <h3 className="text-sm font-medium text-foreground">
            Kein Katalog geladen
          </h3>
          <p className="text-sm text-muted-foreground">
            Excel-Datei importieren, danach erscheint die Katalogpruefung.
          </p>
        </div>
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
        title="Objektkatalog: Pruefung"
        description={
          selectedObject
            ? `${catalogObjectLabel(selectedObject)} / ${findings.length.toLocaleString()} Findings`
            : catalog
              ? "Keine Katalogklasse gewaehlt."
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
            <div className="grid gap-1 rounded-xl border bg-card/80 p-3">
              <h3 className="text-sm font-medium text-foreground">
                {catalogObjectLabel(selectedObject)}
              </h3>
              <p className="text-xs text-muted-foreground">
                Sheet {selectedObject.sheetName}, {selectedObject.ifcClass},
                Version {selectedObject.version || "-"}
              </p>
              <p className="text-xs text-muted-foreground">
                {selectedObject.propertyRules
                  .filter((rule) => rule.requirement === "required")
                  .length.toLocaleString()}{" "}
                erforderliche /{" "}
                {selectedObject.propertyRules.length.toLocaleString()} gesamte
                Properties
              </p>
            </div>
          ) : null}

          {findings.length ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted-foreground">
                {findings.length.toLocaleString()} Warnungen,{" "}
                {quickFixCount.toLocaleString()} Quick-Fixes
              </p>
              {findings.map((finding) => (
                <div
                  key={finding.id}
                  className="grid gap-2 rounded-xl border bg-card/80 p-3"
                >
                  <div className="text-sm font-medium text-foreground">
                    {finding.kind}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {finding.message}
                  </p>
                  {finding.quickFix ? (
                    <Button
                      label={finding.quickFix.label}
                      onPress={() => onApplyFinding(finding)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {selectedObject
                ? "Keine Katalogwarnungen fuer die aktuelle Kombination."
                : "Katalogklasse im Objektkatalog-Fenster waehlen."}
            </p>
          )}
        </PanelShell>
      ) : (
        <div className="grid place-items-center gap-2 rounded-xl border border-dashed bg-muted/20 p-6 text-center">
          <h3 className="text-sm font-medium text-foreground">
            Kein Katalog geladen
          </h3>
          <p className="text-sm text-muted-foreground">
            Excel-Datei im Objektkatalog-Fenster importieren.
          </p>
        </div>
      )}
    </PanelShell>
  );
}

function countProperties(catalog: IfcObjectCatalog) {
  return catalog.objectTypes.reduce(
    (total, objectType) => total + objectType.propertyRules.length,
    0,
  );
}
