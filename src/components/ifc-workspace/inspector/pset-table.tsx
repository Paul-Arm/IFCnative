import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps } from "react";

import { type NativeIfcDocument, type NativeIfcEntity, type NativeIfcPropertySet } from "@/ifc";
import { cn } from "@/lib/utils";

import { PROPERTY_VALUE_TYPES, QUANTITY_TYPES } from "../constants";
import { Badge, DataTable, DataTableCell, type DataTableColumn } from "../ui";
import { IconButton, uniqueStrings } from "./shared";
import {
  editableSetValue,
  parseTypedPropertyValue,
  propertyValueTypeLabel,
} from "./step-values";

/* ------------------------------------------------------------------ */
/* Pset-Tabelle (Tab "Eigenschaften")                                  */
/* ------------------------------------------------------------------ */

const PSET_TABLE_COLUMNS: DataTableColumn[] = [
  { flex: 1.1, header: "Name", key: "name", minWidth: 130 },
  { flex: 0.7, header: "Typ", key: "type", minWidth: 100 },
  { flex: 1.4, header: "Wert", key: "value", minWidth: 130 },
  { header: "", key: "actions", width: 32 },
];

export function PsetTableSection({
  document,
  set,
  visibleValues,
  searchActive,
  onAddPropertyToSet,
  onDuplicatePropertySet,
  onRemovePropertyFromSet,
  onRemovePropertySet,
  onRenamePropertySet,
  onUpdateProperty,
}: {
  document: NativeIfcDocument;
  set: NativeIfcPropertySet;
  visibleValues: NativeIfcPropertySet["values"];
  searchActive: boolean;
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
  const typeOptions =
    set.kind === "Qto" ? QUANTITY_TYPES : PROPERTY_VALUE_TYPES;
  const [newName, setNewName] = useState(
    set.kind === "Qto" ? "NeueMenge" : "NeueEigenschaft",
  );
  const [setName, setSetName] = useState(set.name);
  const [newType, setNewType] = useState(typeOptions[0] ?? "IFCLABEL");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    setNewType(typeOptions[0] ?? "IFCLABEL");
  }, [set.kind, typeOptions]);

  useEffect(() => {
    setSetName(set.name);
  }, [set.id, set.name]);

  const commitSetName = (nextName = setName) => {
    if (nextName.trim() !== set.name) {
      onRenamePropertySet(set.id, nextName);
    }
  };

  const isQto = set.kind === "Qto";
  const accentClasses = isQto
    ? "border-l-warning/60 bg-warning/5"
    : "border-l-success/60 bg-success/5";
  const headerAccent = isQto
    ? "border-warning/25 bg-warning/10"
    : "border-success/25 bg-success/10";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 border-l-[3px] bg-card shadow-sm",
        accentClasses,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-2.5 py-2",
          headerAccent,
        )}
      >
        <Badge tone={isQto ? "warning" : "success"}>{set.kind}</Badge>
        <Input
          className="h-7 min-w-40 flex-1 rounded-md border-transparent bg-transparent px-2 text-sm font-semibold text-foreground shadow-none hover:bg-background/60 focus-visible:border-ring focus-visible:bg-background"
          value={setName}
          onBlur={() => commitSetName()}
          onChange={(event) => setSetName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          #{set.id} ·{" "}
          {searchActive
            ? `${visibleValues.length.toLocaleString("de-DE")}/${set.values.length.toLocaleString("de-DE")}`
            : set.values.length.toLocaleString("de-DE")}{" "}
          Werte
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label="Duplizieren"
            icon={<Copy aria-hidden className="size-3.5" />}
            onClick={() => onDuplicatePropertySet(set.id)}
          />
          <IconButton
            label="Löschen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onClick={() => onRemovePropertySet(set.id)}
          />
        </div>
      </div>
      <div className="p-2">
        <DataTable
          columns={PSET_TABLE_COLUMNS}
          emptyMessage={
            searchActive ? "Keine passenden Werte." : "Noch keine Werte."
          }
          keyExtractor={(value) => String(value.id)}
          rows={visibleValues}
          renderRow={(value) => (
            <EditablePropertyTableCells
              columns={PSET_TABLE_COLUMNS}
              property={value}
              propertyEntity={document.entityById.get(value.id)}
              setId={set.id}
              typeOptions={typeOptions}
              onRemove={onRemovePropertyFromSet}
              onUpdate={onUpdateProperty}
            />
          )}
          footer={
            <PsetAddTableCells
              columns={PSET_TABLE_COLUMNS}
              disabled={!newName.trim()}
              name={newName}
              selectedType={newType}
              typeOptions={typeOptions}
              value={newValue}
              onAdd={() => {
                onAddPropertyToSet(set.id, newName, newValue, newType);
                setNewValue("");
              }}
              onChangeName={setNewName}
              onChangeType={setNewType}
              onChangeValue={setNewValue}
            />
          }
        />
      </div>
    </section>
  );
}

function EditablePropertyTableCells({
  columns,
  property,
  propertyEntity,
  setId,
  typeOptions,
  onRemove,
  onUpdate,
}: {
  columns: DataTableColumn[];
  property: { id: number; name: string; value: string; type: string };
  propertyEntity?: NativeIfcEntity;
  setId: number;
  typeOptions: string[];
  onRemove(setId: number, propertyId: number): void;
  onUpdate(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const rawValue = editableSetValue(propertyEntity, property.value);
  const parsed = parseTypedPropertyValue(rawValue, propertyEntity);
  const [name, setName] = useState(property.name);
  const [valueType, setValueType] = useState(parsed.valueType);
  const [value, setValue] = useState(parsed.value);

  const commitUpdate = (
    next: {
      name?: string;
      value?: string;
      valueType?: string;
    } = {},
  ) => {
    const committedName = next.name ?? name;
    const committedValue = next.value ?? value;
    const committedValueType = next.valueType ?? valueType;
    if (
      committedName === property.name &&
      committedValue === parsed.value &&
      committedValueType === parsed.valueType
    ) {
      return;
    }
    onUpdate(property.id, committedName, committedValue, committedValueType);
  };

  const updateValueType = (nextType: string) => {
    setValueType(nextType);
    commitUpdate({ valueType: nextType });
  };

  useEffect(() => {
    setName(property.name);
    setValueType(parsed.valueType);
    setValue(parsed.value);
  }, [parsed.value, parsed.valueType, property.id, property.name]);

  return (
    <>
      <DataTableCell column={columns[0]}>
        <PsetCellInput
          value={name}
          onBlur={() => commitUpdate()}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataTableCell>
      <DataTableCell column={columns[1]}>
        <PsetTypeSelect
          selectedType={valueType}
          typeOptions={typeOptions}
          onSelectType={updateValueType}
        />
      </DataTableCell>
      <DataTableCell column={columns[2]}>
        <PsetCellInput
          value={value}
          onBlur={() => commitUpdate()}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataTableCell>
      <DataTableCell column={columns[3]}>
        <div className="flex justify-end">
          <IconButton
            label="Eigenschaft löschen"
            tone="danger"
            icon={<Trash2 aria-hidden className="size-3.5" />}
            onClick={() => onRemove(setId, property.id)}
          />
        </div>
      </DataTableCell>
    </>
  );
}

function PsetAddTableCells({
  columns,
  disabled,
  name,
  selectedType,
  typeOptions,
  value,
  onAdd,
  onChangeName,
  onChangeType,
  onChangeValue,
}: {
  columns: DataTableColumn[];
  disabled: boolean;
  name: string;
  selectedType: string;
  typeOptions: string[];
  value: string;
  onAdd(): void;
  onChangeName(value: string): void;
  onChangeType(value: string): void;
  onChangeValue(value: string): void;
}) {
  return (
    <>
      <DataTableCell column={columns[0]}>
        <PsetCellInput
          className="font-medium"
          value={name}
          onChange={(event) => onChangeName(event.currentTarget.value)}
        />
      </DataTableCell>
      <DataTableCell column={columns[1]}>
        <PsetTypeSelect
          selectedType={selectedType}
          typeOptions={typeOptions}
          onSelectType={onChangeType}
        />
      </DataTableCell>
      <DataTableCell column={columns[2]}>
        <PsetCellInput
          value={value}
          onChange={(event) => onChangeValue(event.currentTarget.value)}
        />
      </DataTableCell>
      <DataTableCell column={columns[3]}>
        <div className="flex justify-end">
          <IconButton
            disabled={disabled}
            label="Wert hinzufügen"
            tone="primary"
            icon={<Plus aria-hidden className="size-3.5" />}
            onClick={onAdd}
          />
        </div>
      </DataTableCell>
    </>
  );
}

function PsetCellInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-7 rounded-md border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/45 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-1",
        className,
      )}
      {...props}
    />
  );
}

function PsetTypeSelect({
  selectedType,
  typeOptions,
  onSelectType,
}: {
  selectedType: string;
  typeOptions: string[];
  onSelectType(valueType: string): void;
}) {
  const normalizedTypeOptions = useMemo(
    () => uniqueStrings([selectedType, ...typeOptions]),
    [selectedType, typeOptions],
  );

  return (
    <Select
      value={selectedType}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          onSelectType(nextValue);
        }
      }}
    >
      <SelectTrigger
        className="h-7 w-full rounded-md border-transparent bg-transparent px-2 text-sm shadow-none hover:bg-muted/45 focus-visible:ring-1"
        size="sm"
      >
        <SelectValue className="truncate">
          {propertyValueTypeLabel(selectedType)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="max-h-72">
        {normalizedTypeOptions.map((typeOption) => (
          <SelectItem key={typeOption} value={typeOption}>
            {propertyValueTypeLabel(typeOption)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
