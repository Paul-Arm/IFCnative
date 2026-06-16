import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { NativeIfcDocument } from "@/ifc";

import { Badge, Button, PanelHeader, PanelShell } from "./ui";

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
}

interface PsetProperty {
  name: string;
  cells: PsetCell[];
  distinct: boolean;
}

interface PsetBlock {
  name: string;
  columns: PsetColumn[];
  properties: PsetProperty[];
}

export function PsetBatchPanel({
  document,
  selectedIds,
  catalogObjectLabel,
  onAddEmptyPset,
  onAddCatalogObject,
  onEditValue,
}: {
  document: NativeIfcDocument;
  selectedIds: number[];
  catalogObjectLabel: string | null;
  onAddEmptyPset(psetName: string): void;
  onAddCatalogObject(): void;
  onEditValue(
    entityId: number,
    setId: number,
    propertyId: number | undefined,
    propertyName: string,
    value: string,
  ): void;
}) {
  const [newPsetName, setNewPsetName] = useState("");

  const count = selectedIds.length;

  const blocks = useMemo<PsetBlock[]>(() => {
    const map = new Map<
      string,
      {
        name: string;
        columns: { id: number; setId: number }[];
        properties: Map<
          string,
          Map<number, { propertyId: number; value: string }>
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
          block = { name: set.name, columns: [], properties: new Map() };
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
          });
        }
      }
    }
    return [...map.values()]
      .map((block) => ({
        name: block.name,
        columns: block.columns.map((column) => {
          const entity = document.entityById.get(column.id);
          return {
            id: column.id,
            setId: column.setId,
            label: entity?.name || `#${column.id}`,
            title: `#${column.id} · ${entity?.type ?? ""}`,
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
              };
            });
            return {
              name,
              cells,
              distinct: new Set(cells.map((cell) => cell.value)).size > 1,
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
            : `${count.toLocaleString()} ${count === 1 ? "Objekt" : "Objekte"} · ${blocks.length.toLocaleString()} Psets`
        }
        meta={count ? <Badge tone="success">{count.toLocaleString()}</Badge> : null}
      />

      <div className="flex shrink-0 flex-wrap items-end gap-2 px-1 pb-1">
        <label className="grid min-w-0 flex-1 gap-1.5 text-xs text-muted-foreground">
          Neues Pset
          <div className="flex items-center gap-1">
            <input
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm text-foreground"
              placeholder="Pset_Name"
              value={newPsetName}
              onChange={(event) => setNewPsetName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  addEmpty();
                }
              }}
            />
            <button
              type="button"
              aria-label="Leeres Pset hinzufügen"
              title="Leeres Pset zu allen ausgewählten Objekten hinzufügen"
              disabled={count === 0 || !newPsetName.trim()}
              onClick={addEmpty}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>
        </label>
      </div>

      <div className="grid shrink-0 gap-1 px-1 pb-1">
        <Button
          disabled={count === 0 || !catalogObjectLabel}
          label={
            catalogObjectLabel
              ? `Pset aus Katalog: ${catalogObjectLabel}`
              : "Pset aus Objektkatalog"
          }
          onPress={onAddCatalogObject}
        />
        <p className="text-[11px] text-muted-foreground">
          {catalogObjectLabel
            ? "Fügt die im Objektkatalog-Fenster gewählte Klasse als Pset(s) zu allen ausgewählten Objekten hinzu."
            : "Im Objektkatalog-Fenster einen Katalog importieren und eine Klasse auswählen."}
        </p>
      </div>

      {count === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          Wähle im Strukturbaum ein oder mehrere Objekte aus (Strg/Shift-Klick).
        </div>
      ) : (
        <PanelShell scroll>
          {blocks.length ? (
            blocks.map((block) => (
              <div
                key={block.name}
                className="shrink-0 overflow-hidden rounded-lg border bg-card"
              >
                <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {block.name}
                  </span>
                  <span
                    className={
                      block.columns.length < count
                        ? "shrink-0 text-xs text-amber-600 dark:text-amber-400"
                        : "shrink-0 text-xs text-muted-foreground"
                    }
                  >
                    {block.columns.length}/{count}
                  </span>
                </div>
                {block.properties.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b bg-muted/20">
                          <th className="sticky left-0 z-10 bg-muted/20 px-3 py-1 text-left font-medium text-muted-foreground">
                            Property
                          </th>
                          {block.columns.map((column) => (
                            <th
                              key={column.id}
                              title={column.title}
                              className="min-w-[8rem] px-3 py-1 text-left font-medium text-foreground"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.properties.map((property) => (
                          <tr
                            key={property.name}
                            className="border-b last:border-0"
                          >
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-3 py-1 text-muted-foreground">
                              {property.name}
                            </td>
                            {property.cells.map((cell) => (
                              <td
                                key={cell.entityId}
                                className="px-1 py-0.5"
                              >
                                <CellInput
                                  value={cell.value}
                                  distinct={property.distinct}
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
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">
                    Keine Properties.
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
              Die Auswahl hat keine Psets. Oben eines hinzufügen.
            </div>
          )}
        </PanelShell>
      )}
    </PanelShell>
  );
}

function CellInput({
  value,
  distinct,
  onCommit,
}: {
  value: string;
  distinct: boolean;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <input
      value={draft}
      placeholder="—"
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={
        "w-full min-w-[7rem] rounded border border-transparent bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground hover:border-border focus:border-primary focus:bg-background " +
        (distinct ? "text-amber-600 dark:text-amber-400" : "text-foreground")
      }
    />
  );
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
