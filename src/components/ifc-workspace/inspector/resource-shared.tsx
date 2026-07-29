import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";
import { type ReactNode } from "react";

import {
  type NativeIfcDocument,
  type NativeIfcEntity,
  type NativeIfcRelationship,
} from "@/ifc";

import { Button } from "../ui";

/* ------------------------------------------------------------------ */
/* Ressourcen-Zusatzpanels (eigene Mosaic-Fenster)                     */
/* ------------------------------------------------------------------ */

export type ResourceAssociation = {
  relationship: NativeIfcRelationship;
  relationshipEntity: NativeIfcEntity;
  resource: NativeIfcEntity;
};

export type ResourceEditCallbacks = {
  onRemoveAssociation(relationshipId: number): void;
  onUpdateEntityArgs(
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ): void;
};

export function getResourceAssociations(
  document: NativeIfcDocument,
  selectedId: number,
  relationshipTypes: string[],
): ResourceAssociation[] {
  const allowedTypes = new Set(relationshipTypes);
  return (document.relationshipsByEntity.get(selectedId) ?? []).flatMap(
    (relationship) => {
      if (
        !allowedTypes.has(relationship.type) ||
        !relationship.sourceIds.includes(selectedId)
      ) {
        return [];
      }
      const relationshipEntity = document.entityById.get(relationship.id);
      if (!relationshipEntity) {
        return [];
      }
      return relationship.targetIds.flatMap((resourceId) => {
        const resource = document.entityById.get(resourceId);
        return resource ? [{ relationship, relationshipEntity, resource }] : [];
      });
    },
  );
}

export function CompactResourceCard({
  children,
  relation,
  title,
  onRemove,
  onSave,
}: {
  children: ReactNode;
  relation: string;
  title: string;
  onRemove(): void;
  onSave(): void;
}) {
  return (
    <section className="grid gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 shadow-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
            {title}
          </h3>
          <span className="truncate text-[0.65rem] text-muted-foreground">
            {relation}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            className="h-7 gap-1 px-2 text-xs"
            title={`${title} speichern`}
            variant="default"
            onClick={onSave}
          >
            <Save aria-hidden className="size-3" />
            <span>Speichern</span>
          </Button>
          <Button
            className="h-7 gap-1 px-2 text-xs"
            title={`${title} Zuordnung entfernen`}
            variant="outline"
            onClick={onRemove}
          >
            <Trash2 aria-hidden className="size-3" />
            <span>Entfernen</span>
          </Button>
        </div>
      </div>
      {children}
    </section>
  );
}

export function CompactTextInput({
  label,
  placeholder,
  value,
  onChangeText,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChangeText(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <Input
        className="h-8 min-w-0 rounded-md px-2 text-xs text-foreground"
        placeholder={placeholder}
        title={value}
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
      />
    </label>
  );
}

export function CompactSelectInput({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="truncate">{label}</span>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue !== null) {
            onChange(nextValue);
          }
        }}
      >
        <SelectTrigger className="h-8 min-w-0 rounded-md px-2 text-xs text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function CompactAddSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="group rounded-md border border-border/60 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/45">
        <span>{title}</span>
        <Plus
          aria-hidden
          className="size-3.5 transition-transform group-open:rotate-45"
        />
      </summary>
      <div className="grid gap-2 border-t border-border/60 bg-card p-2.5">
        {children}
      </div>
    </details>
  );
}

export function CompactCreateButton({
  disabled,
  label,
  onClick,
  title,
}: {
  disabled?: boolean;
  label: string;
  onClick(): void;
  title?: string;
}) {
  return (
    <Button
      className="h-8 w-full gap-1.5 text-xs"
      disabled={disabled}
      title={title}
      variant="outline"
      onClick={onClick}
    >
      <Plus aria-hidden className="size-3.5" />
      <span>{label}</span>
    </Button>
  );
}
