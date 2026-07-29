import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";
import { UI_SCALE_OPTIONS, type UiScale } from "@/hooks/use-ui-scale";

export interface WorkspaceStatusBarProps {
  document: NativeIfcDocument;
  documentTextDirty: boolean;
  loadingIfcName: string;
  selectedEntity: NativeIfcEntity | undefined;
  selectedIds: Set<number>;
  uiScale: UiScale;
  onUiScaleChange: (scale: UiScale) => void;
}

/** Fußzeile: Schema, Entity-Zähler, Auswahl-, Lade- und Speicherstatus. */
export function WorkspaceStatusBar({
  document,
  documentTextDirty,
  loadingIfcName,
  selectedEntity,
  selectedIds,
  uiScale,
  onUiScaleChange,
}: WorkspaceStatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border/70 bg-card px-3 text-[11px] text-muted-foreground">
      <span className="shrink-0 font-medium text-foreground/80">
        {document.schema}
      </span>
      <span className="shrink-0">
        {document.entities.length.toLocaleString("de-DE")} Entitäten
      </span>
      {selectedIds.size > 1 ? (
        <span className="shrink-0 text-primary">
          {selectedIds.size.toLocaleString("de-DE")} ausgewählt
        </span>
      ) : selectedEntity ? (
        <span className="min-w-0 truncate">
          #{selectedEntity.id} {selectedEntity.type}
          {selectedEntity.name ? ` · ${selectedEntity.name}` : ""}
        </span>
      ) : null}
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {loadingIfcName ? (
          <span className="text-primary">Lädt {loadingIfcName}…</span>
        ) : null}
        {documentTextDirty ? (
          <span className="flex items-center gap-1 text-warning-foreground dark:text-warning">
            <span className="size-1.5 rounded-full bg-warning" />
            Ungespeichert
          </span>
        ) : (
          <span>Gespeichert</span>
        )}
        <Select
          value={String(uiScale)}
          onValueChange={(next) => {
            if (next) {
              onUiScaleChange(Number(next) as UiScale);
            }
          }}
        >
          <SelectTrigger
            aria-label="Schriftgröße"
            title="Globale Schriftgröße"
            className="h-5 min-w-0 gap-1 rounded border-transparent bg-transparent px-1 py-0 text-[11px] text-muted-foreground shadow-none hover:border-input hover:text-foreground [&_svg]:size-3"
          >
            <SelectValue>{uiScale} %</SelectValue>
          </SelectTrigger>
          <SelectContent align="end" className="w-auto min-w-24">
            {UI_SCALE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} %
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </span>
    </footer>
  );
}
