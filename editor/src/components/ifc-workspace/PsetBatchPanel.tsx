import { Import, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { NativeIfcDocument } from "@/ifc";
import { cn } from "@/lib/utils";

import { PROPERTY_VALUE_TYPES, QUANTITY_TYPES } from "./constants";
import {
  Badge,
  CommitInput,
  EmptyState,
  PanelHeader,
  PanelShell,
  shortType,
} from "./ui";

interface PsetColumn {
  id: number;
  label: string;
  title: string;
  setId: number;
}

interface PsetCell {
  entityId: number;
  setId: number;
  propertyId?: number;
  value: string;
  valueType: string;
}

interface PsetProperty {
  name: string;
  cells: PsetCell[];
  distinct: boolean;
  /** Gemeinsamer Werttyp aller Objekte — "" wenn gemischt/unbekannt. */
  valueType: string;
  /** Werttyp per Select änderbar (einfache Werte, keine List/Enum/…-Komposite). */
  typeEditable: boolean;
}

interface PsetBlock {
  name: string;
  kind: string;
  columns: PsetColumn[];
  properties: PsetProperty[];
}

export function PsetBatchPanel({
  document,
  selectedIds,
  catalogObjectLabel,
  onAddEmptyPset,
  onAddCatalogObject,
  onAddProperty,
  onEditValue,
  onSetPropertyType,
}: {
  document: NativeIfcDocument;
  selectedIds: number[];
  catalogObjectLabel: string | null;
  onAddEmptyPset(psetName: string): void;
  onAddCatalogObject(): void;
  onAddProperty(
    psetName: string,
    propertyName: string,
    valueType: string,
    value: string,
  ): void;
  onEditValue(
    entityId: number,
    setId: number,
    propertyId: number | undefined,
    propertyName: string,
    value: string,
  ): void;
  onSetPropertyType(
    psetName: string,
    propertyName: string,
    valueType: string,
  ): void;
}) {
  const [newPsetName, setNewPsetName] = useState("");

  const count = selectedIds.length;

  const blocks = useMemo<PsetBlock[]>(() => {
    const map = new Map<
      string,
      {
        name: string;
        kind: string;
        columns: { id: number; setId: number }[];
        properties: Map<
          string,
          Map<number, { propertyId: number; value: string; valueType: string }>
        >;
      }
    >();
    for (const id of selectedIds) {
      const sets = document.propertySetsByEntity.get(id) ?? [];
      for (const set of sets) {
        const key = set.name.trim().toLowerCase();
        if (!key) {
          continue;
        }
        let block = map.get(key);
        if (!block) {
          block = {
            name: set.name,
            kind: set.kind,
            columns: [],
            properties: new Map(),
          };
          map.set(key, block);
        }
        if (!block.columns.some((column) => column.id === id)) {
          block.columns.push({ id, setId: set.id });
        }
        for (const value of set.values) {
          if (!value.name) {
            continue;
          }
          let byObject = block.properties.get(value.name);
          if (!byObject) {
            byObject = new Map();
            block.properties.set(value.name, byObject);
          }
          byObject.set(id, {
            propertyId: value.id,
            value: readableValue(value.value),
            valueType: derivePropertyValueType(document, value.id),
          });
        }
      }
    }
    return [...map.values()]
      .map((block) => ({
        name: block.name,
        kind: block.kind,
        columns: block.columns.map((column) => {
          const entity = document.entityById.get(column.id);
          const typeLabel = entity?.type ? shortType(entity.type) : "";
          return {
            id: column.id,
            setId: column.setId,
            label: entity?.name || `#${column.id}`,
            title: typeLabel
              ? `#${column.id} · ${typeLabel}`
              : `#${column.id}`,
          };
        }),
        properties: [...block.properties.entries()]
          .map(([name, byObject]) => {
            const cells = block.columns.map<PsetCell>((column) => {
              const entry = byObject.get(column.id);
              return {
                entityId: column.id,
                setId: column.setId,
                propertyId: entry?.propertyId,
                value: entry?.value ?? "",
                valueType: entry?.valueType ?? "",
              };
            });
            const presentTypes = new Set(
              cells
                .map((cell) => cell.valueType)
                .filter((valueType) => valueType !== ""),
            );
            const commonType =
              presentTypes.size === 1 ? [...presentTypes][0] : "";
            return {
              name,
              cells,
              distinct: new Set(cells.map((cell) => cell.value)).size > 1,
              valueType: commonType,
              typeEditable:
                presentTypes.size <= 1 &&
                (commonType === "" || !commonType.includes(":")),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [document, selectedIds]);

  const addEmpty = () => {
    const name = newPsetName.trim();
    if (!name) {
      return;
    }
    onAddEmptyPset(name);
    setNewPsetName("");
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Psets"
        description={
          count === 0
            ? "Objekt(e) im Baum auswählen."
            : `${count.toLocaleString("de-DE")} ${count === 1 ? "Objekt" : "Objekte"} · ${blocks.length.toLocaleString("de-DE")} ${blocks.length === 1 ? "Pset" : "Psets"}`
        }
        meta={
          count ? (
            <Badge tone="success">{count.toLocaleString("de-DE")}</Badge>
          ) : null
        }
      />

      <div className="grid shrink-0 gap-2">
        <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
          Neues Pset
          <div className="flex items-center gap-1.5">
            <Input
              className="h-8 min-w-0 flex-1 text-sm"
              placeholder="Pset_Name"
              value={newPsetName}
              onChange={(event) => setNewPsetName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addEmpty();
                }
              }}
            />
            <Button
              aria-label="Leeres Pset hinzufügen"
              disabled={count === 0 || !newPsetName.trim()}
              size="icon"
              title="Leeres Pset zu allen ausgewählten Objekten hinzufügen"
              onClick={addEmpty}
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
        </label>

        <div className="grid gap-1">
          <Button
            className="w-full justify-start"
            disabled={count === 0 || !catalogObjectLabel}
            variant="outline"
            onClick={onAddCatalogObject}
          >
            <Import aria-hidden className="size-3.5" />
            <span className="min-w-0 truncate">
              {catalogObjectLabel
                ? `Pset aus Katalog: ${catalogObjectLabel}`
                : "Pset aus Objektkatalog"}
            </span>
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {catalogObjectLabel
              ? "Fügt die im Objektkatalog-Fenster gewählte Klasse als Pset(s) zu allen ausgewählten Objekten hinzu."
              : "Im Objektkatalog-Fenster einen Katalog importieren und eine Klasse auswählen."}
          </p>
        </div>
      </div>

      {count === 0 ? (
        <EmptyState
          title="Keine Objekte ausgewählt"
          description="Wähle im Strukturbaum ein oder mehrere Objekte aus (Strg/Shift-Klick)."
        />
      ) : (
        <PanelShell scroll>
          {blocks.length ? (
            blocks.map((block) => (
              <section
                key={block.name}
                className="shrink-0 overflow-hidden rounded-lg border border-border/60 bg-card"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 px-2.5 py-1.5">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {block.name}
                  </span>
                  <span
                    className="shrink-0"
                    title={`In ${block.columns.length.toLocaleString("de-DE")} von ${count.toLocaleString("de-DE")} ausgewählten Objekten vorhanden`}
                  >
                    <Badge
                      tone={block.columns.length < count ? "warning" : "neutral"}
                    >
                      {block.columns.length.toLocaleString("de-DE")}/
                      {count.toLocaleString("de-DE")}
                    </Badge>
                  </span>
                </div>
                {block.properties.length ? (
                  <Table className="w-full text-xs">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="sticky left-0 z-10 h-9 border-r border-border/60 bg-card px-2.5 text-xs font-medium text-muted-foreground">
                          Property
                        </TableHead>
                        {block.columns.map((column) => (
                          <TableHead
                            key={column.id}
                            className="h-9 px-2.5 py-1 align-middle"
                            title={column.title}
                          >
                            <div className="flex min-w-28 max-w-44 flex-col">
                              <span className="truncate text-xs font-medium text-foreground">
                                {column.label}
                              </span>
                              <span className="truncate text-[10px] font-normal text-muted-foreground">
                                {column.title}
                              </span>
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {block.properties.map((property) => (
                        <TableRow
                          key={property.name}
                          className="h-8 hover:bg-transparent"
                        >
                          <TableCell className="sticky left-0 z-10 border-r border-border/60 bg-card px-2.5 py-1 align-middle text-muted-foreground">
                            <div className="grid max-w-44 gap-0.5">
                              <span
                                className="block truncate"
                                title={property.name}
                              >
                                {property.name}
                              </span>
                              <PropertyTypeControl
                                kind={block.kind}
                                property={property}
                                onSetType={(valueType) =>
                                  onSetPropertyType(
                                    block.name,
                                    property.name,
                                    valueType,
                                  )
                                }
                              />
                            </div>
                          </TableCell>
                          {property.cells.map((cell) => (
                            <TableCell
                              key={cell.entityId}
                              className="min-w-28 px-1 py-0.5 align-middle"
                            >
                              <CommitInput
                                className={cn(
                                  "h-7 w-full min-w-28 rounded-md border-transparent bg-transparent dark:bg-transparent hover:border-input focus-visible:bg-background",
                                  property.distinct &&
                                    "bg-warning/10 dark:bg-warning/10 text-warning-foreground dark:text-warning",
                                )}
                                placeholder="—"
                                value={cell.value}
                                onCommit={(next) =>
                                  onEditValue(
                                    cell.entityId,
                                    cell.setId,
                                    cell.propertyId,
                                    property.name,
                                    next,
                                  )
                                }
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                    Keine Properties.
                  </p>
                )}
                <AddPropertyRow
                  kind={block.kind}
                  onAdd={(name, valueType, value) =>
                    onAddProperty(block.name, name, valueType, value)
                  }
                />
              </section>
            ))
          ) : (
            <EmptyState
              title="Keine Psets vorhanden"
              description="Die Auswahl hat keine Psets. Oben ein neues Pset anlegen oder eine Katalogklasse anwenden."
            />
          )}
        </PanelShell>
      )}
    </PanelShell>
  );
}

/** Zentraler Werttyp einer Property-Zeile (gilt für alle ausgewählten Objekte). */
function PropertyTypeControl({
  kind,
  property,
  onSetType,
}: {
  kind: string;
  property: PsetProperty;
  onSetType(valueType: string): void;
}) {
  if (!property.typeEditable) {
    return (
      <span
        className="truncate text-[10px] text-muted-foreground/80"
        title={`Typ: ${property.valueType || "gemischt"} — zentral nicht änderbar`}
      >
        {property.valueType ? shortType(property.valueType) : "Typ gemischt"}
      </span>
    );
  }
  const options = typeOptionsForKind(kind, property.valueType);
  return (
    <Select
      value={property.valueType || undefined}
      onValueChange={(next) => {
        if (next && next !== property.valueType) {
          onSetType(next);
        }
      }}
    >
      <SelectTrigger
        aria-label={`Datentyp für ${property.name}`}
        className="h-5 w-fit min-w-0 gap-1 rounded border-transparent bg-transparent px-1 py-0 text-[10px] text-muted-foreground shadow-none hover:border-input hover:text-foreground [&_svg]:size-3"
        title="Datentyp zentral für alle ausgewählten Objekte ändern"
      >
        <SelectValue className="truncate">
          {property.valueType ? shortType(property.valueType) : "Typ wählen"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-64 w-auto min-w-40">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {shortType(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Fußzeile eines Pset-Blocks: neue Property auf allen Objekten anlegen. */
function AddPropertyRow({
  kind,
  onAdd,
}: {
  kind: string;
  onAdd(name: string, valueType: string, value: string): void;
}) {
  const options = typeOptionsForKind(kind, "");
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState(options[0] ?? "IFCLABEL");
  const [value, setValue] = useState("");

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onAdd(trimmed, valueType, value.trim());
    setName("");
    setValue("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-2 py-1.5">
      <Input
        aria-label="Name der neuen Property"
        className="h-7 min-w-28 flex-1 text-xs"
        placeholder="Neue Property …"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            add();
          }
        }}
      />
      <Select
        value={valueType}
        onValueChange={(next) => {
          if (next) {
            setValueType(next);
          }
        }}
      >
        <SelectTrigger
          aria-label="Datentyp der neuen Property"
          className="h-7 w-32 min-w-0 text-xs"
          title="Datentyp"
        >
          <SelectValue className="truncate">{shortType(valueType)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="max-h-64 w-auto min-w-40">
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {shortType(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Wert der neuen Property"
        className="h-7 min-w-20 flex-1 text-xs"
        placeholder="Wert (optional)"
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            add();
          }
        }}
      />
      <Button
        aria-label="Property zu allen ausgewählten Objekten hinzufügen"
        disabled={!name.trim()}
        size="icon-sm"
        title="Property zu allen ausgewählten Objekten hinzufügen"
        onClick={add}
      >
        <Plus aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

function typeOptionsForKind(kind: string, currentType: string) {
  const base = kind === "Qto" ? QUANTITY_TYPES : PROPERTY_VALUE_TYPES;
  return currentType && !base.includes(currentType)
    ? [currentType, ...base]
    : [...base];
}

/**
 * Werttyp (IFCLABEL, IFCREAL, …) einer Property ableiten. Für Komposite
 * (List/Enum/Bounded/Table) wird ein ":"-markierter Typ geliefert, den die
 * zentrale Typänderung nicht anbietet.
 */
function derivePropertyValueType(
  document: NativeIfcDocument,
  propertyId: number,
): string {
  const entity = document.entityById.get(propertyId);
  if (!entity) {
    return "";
  }
  if (entity.type === "IFCPROPERTYSINGLEVALUE") {
    const raw = (entity.args[2] ?? "").trim();
    const match = raw.match(/^([A-Za-z0-9_]+)\(/);
    return match ? match[1].toUpperCase() : "IFCLABEL";
  }
  if (QUANTITY_TYPES.includes(entity.type)) {
    return entity.type;
  }
  // Komposite Wertarten: zentral nicht per Simple-Select änderbar.
  return `${entity.type}:`;
}

function readableValue(raw: string) {
  const text = String(raw ?? "").trim();
  if (!text || text === "$") {
    return "";
  }
  // Unwrap IFC typed values like IFCLABEL('Foo') / IFCREAL(1.5).
  const match = text.match(/^[A-Z0-9_]+\((.*)\)$/i);
  const inner = match ? match[1] : text;
  return inner.replace(/^'(.*)'$/s, "$1").trim();
}
