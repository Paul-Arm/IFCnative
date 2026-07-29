import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  catalogObjectLabel,
  type CatalogObjectType,
  type CatalogPropertyRule,
  type CatalogValidationFinding,
  type IfcObjectCatalog,
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcPropertySet,
} from "@/ifc";

import { QUANTITY_TYPES } from "../constants";
import {
  Badge,
  Button,
  CollapsibleSection,
  DropdownField,
  LabeledInput,
  PanelHeader,
  PanelShell,
  SegmentedControl,
} from "../ui";
import { PsetTableSection } from "./pset-table";
import { EmptyBlock, ResponsiveField, ResponsiveRow } from "./shared";
import { editableSetValue, parseTypedPropertyValue } from "./step-values";

/* ------------------------------------------------------------------ */
/* Tab "Eigenschaften" (Psets & Mengen)                                */
/* ------------------------------------------------------------------ */

export function PsetPanel({
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
