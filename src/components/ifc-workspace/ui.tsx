import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton, buttonVariants } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    TableFooter,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";
import { cn } from "@/lib/utils";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { MOSAIC_TITLES } from "./constants";
import type { MosaicViewId } from "./types";

type StyleProp<T> = T | false | null | undefined | StyleProp<T>[];
type ViewStyle = CSSProperties & Record<string, unknown>;

export function Button({
  disabled,
  label,
  onPress,
  primary,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  return (
    <ShadcnButton
      disabled={disabled}
      size="sm"
      variant={primary ? "default" : "outline"}
      onClick={onPress}
    >
      {label}
    </ShadcnButton>
  );
}

export function PanelShell({
  children,
  scroll,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2.5",
        scroll && "overflow-auto pr-0.5",
      )}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  actions,
  description,
  eyebrow,
  meta,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  eyebrow?: string;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {eyebrow ? (
          <div className="text-[0.65rem] font-semibold uppercase tracking-wider text-primary/80">
            {eyebrow}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold leading-tight text-foreground">
            {title}
          </h2>
          {meta}
        </div>
        {description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
      {children}
    </div>
  );
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const variant =
    tone === "danger"
      ? "destructive"
      : tone === "neutral"
        ? "outline"
        : "secondary";

  return (
    <ShadcnBadge
      className={cn(
        "h-5 rounded-md border px-1.5 text-[0.65rem] font-semibold uppercase tracking-wider",
        tone === "neutral" &&
          "border-border/70 bg-background text-muted-foreground",
        tone === "success" &&
          "border-emerald-200/70 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200/70 bg-amber-50 text-amber-800",
        tone === "info" && "border-sky-200/70 bg-sky-50 text-sky-700",
      )}
      variant={variant}
    >
      {children}
    </ShadcnBadge>
  );
}

export interface DataTableColumn {
  key: string;
  header: string;
  flex?: number;
  minWidth?: number;
  width?: number;
}

export function DataTable<Row>({
  columns,
  emptyMessage,
  footer,
  keyExtractor,
  minWidth = 0,
  renderRow,
  rows,
}: {
  columns: DataTableColumn[];
  emptyMessage: string;
  footer?: ReactNode;
  keyExtractor(row: Row): string;
  minWidth?: number;
  renderRow(row: Row, index: number): ReactNode;
  rows: Row[];
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border/60 bg-card">
      <Table style={minWidth ? { minWidth } : undefined}>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className="h-8 px-2 text-xs"
                style={dataTableColumnStyle(column)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, index) => (
              <TableRow key={keyExtractor(row)} className="h-8">
                {renderRow(row, index)}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-12 text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {footer ? (
          <TableFooter>
            <TableRow>{footer}</TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

export function DataTableCell({
  children,
  column,
  style,
}: {
  children: ReactNode;
  column: DataTableColumn;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TableCell
      className="h-8 px-1.5 py-0 align-middle"
      style={mergeTableCellStyle(column, style)}
    >
      {children}
    </TableCell>
  );
}

function dataTableColumnStyle(column: DataTableColumn): CSSProperties {
  return {
    minWidth: column.minWidth ?? 0,
    width: column.width,
  };
}

function mergeTableCellStyle(
  column: DataTableColumn,
  style?: StyleProp<ViewStyle>,
): CSSProperties {
  return {
    ...dataTableColumnStyle(column),
    ...normalizeCssStyle(style),
  };
}

function normalizeCssStyle(style?: StyleProp<ViewStyle>): CSSProperties {
  const merged: CSSProperties = {};
  const stylesToMerge = Array.isArray(style) ? style : [style];

  for (const item of stylesToMerge) {
    if (!item || typeof item !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (key === "paddingHorizontal") {
        merged.paddingLeft = value as CSSProperties["paddingLeft"];
        merged.paddingRight = value as CSSProperties["paddingRight"];
      } else if (key === "paddingVertical") {
        merged.paddingTop = value as CSSProperties["paddingTop"];
        merged.paddingBottom = value as CSSProperties["paddingBottom"];
      } else if (key !== "flex") {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}

export function MosaicWindowMenu({
  closedIds,
  onRestore,
}: {
  closedIds: MosaicViewId[];
  onRestore(id: MosaicViewId): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ size: "sm", variant: "outline" }),
          "gap-1.5",
        )}
      >
        <LayoutGrid aria-hidden className="size-3.5" />
        <span>Fenster</span>
        {closedIds.length ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-[0.65rem] font-semibold text-primary">
            {closedIds.length}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Geschlossene Fenster</DropdownMenuLabel>
          {closedIds.length ? (
            closedIds.map((id) => (
              <DropdownMenuItem
                key={id}
                className="justify-between"
                onClick={() => onRestore(id)}
              >
                <span className="truncate">{MOSAIC_TITLES[id]}</span>
                <span className="text-xs text-muted-foreground">Öffnen</span>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-1.5 py-2 text-sm text-muted-foreground">
              Alle Fenster sind geöffnet
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue);
        }
      }}
      className="min-w-0"
    >
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-0.5 group-data-horizontal/tabs:h-auto">
        {options.map((option) => (
          <TabsTrigger
            key={option}
            value={option}
            className="h-7 min-w-0 flex-none px-2 text-[11px] font-medium whitespace-nowrap capitalize"
            title={option.replace(/-/g, " ")}
          >
            <span className="truncate">{option.replace(/-/g, " ")}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function LabeledInput({
  keyboardType,
  label,
  multiline,
  mono,
  onChangeText,
  value,
}: {
  keyboardType?: "default" | "numeric";
  label: string;
  multiline?: boolean;
  mono?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <Textarea
          className={cn(
            "min-h-24 text-foreground",
            mono && "font-mono text-xs",
          )}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      ) : (
        <Input
          className={cn("text-foreground", mono && "font-mono text-xs")}
          inputMode={keyboardType === "numeric" ? "decimal" : undefined}
          value={value}
          onChange={(event) => onChangeText(event.currentTarget.value)}
        />
      )}
    </label>
  );
}

export function ColorInput({
  label,
  onChangeText,
  value,
}: {
  label: string;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        className="h-9 w-full cursor-pointer rounded-md p-1"
        type="color"
        value={normalizeColorInputValue(value)}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
    </label>
  );
}

export interface DropdownOption {
  value: string;
  label: string;
  detail?: string;
}

export function DropdownField({
  label,
  overlay,
  options,
  value,
  onChange,
}: {
  label: string;
  overlay?: boolean;
  options: (string | DropdownOption)[];
  value: string;
  onChange(value: string): void;
}) {
  const normalized = useMemo(
    () => normalizeDropdownOptions(options),
    [options],
  );
  const selected = normalized.find((option) => option.value === value) ?? {
    detail: "custom value",
    label: value || "Select",
    value,
  };

  return (
    <label className="grid gap-1.5 text-xs text-muted-foreground">
      {label}
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue !== null) {
            onChange(nextValue);
          }
        }}
      >
        <SelectTrigger className={cn("w-full", overlay && "relative z-20")}>
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="max-h-72">
          {normalized.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.detail ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function EntityDropdown({
  document,
  label,
  value,
  onChange,
}: {
  document: NativeIfcDocument;
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const options = useMemo(() => {
    const selected = document.entityById.get(Number(value));
    const priorityTypes = new Set([
      "IFCPROJECT",
      "IFCSITE",
      "IFCBUILDING",
      "IFCBUILDINGSTOREY",
      "IFCSPACE",
      "IFCBUILDINGELEMENTPROXY",
      "IFCBUILTELEMENT",
      "IFCWALL",
      "IFCSLAB",
      "IFCBEAM",
      "IFCCOLUMN",
      "IFCDOOR",
      "IFCWINDOW",
      "IFCPROPERTYSET",
      "IFCELEMENTQUANTITY",
      "IFCMATERIAL",
      "IFCGROUP",
    ]);
    const priority = document.entities
      .filter((entity) => priorityTypes.has(entity.type))
      .slice(0, 260);
    const fallback = document.entities.slice(0, 260);
    return normalizeDropdownOptions([
      ...(selected ? [entityDropdownOption(selected)] : []),
      ...priority.map(entityDropdownOption),
      ...fallback.map(entityDropdownOption),
    ]);
  }, [document, value]);

  return (
    <DropdownField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function normalizeDropdownOptions(options: (string | DropdownOption)[]) {
  const seen = new Set<string>();
  const normalized: DropdownOption[] = [];
  for (const option of options) {
    const item =
      typeof option === "string"
        ? { label: shortType(option), value: option }
        : option;
    if (!item.value || seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);
    normalized.push(item);
  }
  return normalized;
}

function normalizeColorInputValue(value: string) {
  const text = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) {
    return text;
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) {
    return `#${text}`;
  }
  return "#8ea7c2";
}

export function typeOption(value: string): DropdownOption {
  return {
    label: shortType(value),
    value,
  };
}

function entityDropdownOption(entity: NativeIfcEntity): DropdownOption {
  return {
    detail: entity.name || entity.globalId || entity.description || "",
    label: `#${entity.id} ${shortType(entity.type)}`,
    value: String(entity.id),
  };
}

export function InfoSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2 rounded-lg border border-border/60 bg-card p-3">
      <h3 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function CollapsibleSection({
  children,
  defaultOpen = false,
  meta,
  title,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  meta?: string;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/45 data-[state=open]:bg-muted/35 data-[state=open]:border-b data-[state=open]:border-border/60">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">
              {title}
            </span>
            {meta ? (
              <span className="block truncate text-xs text-muted-foreground">
                {meta}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180 text-primary",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-2 p-3">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md bg-muted/30 px-2.5 py-1.5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-baseline sm:gap-3">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words text-foreground">{value}</span>
    </div>
  );
}

function shortType(type: string) {
  const [kind, firstType, secondType] = type.split(":");
  if (kind === "IFCPROPERTYLISTVALUE") {
    return `List ${shortType(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYENUMERATEDVALUE") {
    return `Enum ${shortType(firstType ?? "IFCLABEL")}`;
  }
  if (kind === "IFCPROPERTYBOUNDEDVALUE") {
    return `Bounded ${shortType(firstType ?? "IFCREAL")}`;
  }
  if (kind === "IFCPROPERTYTABLEVALUE") {
    return `Table ${shortType(firstType ?? "IFCREAL")} -> ${shortType(secondType ?? "IFCREAL")}`;
  }
  return type.replace(/^IFC/i, "");
}
