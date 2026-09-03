import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Badge } from "./ui";

/** Kurzstatus des Panels für Kopfzeile und Chip: Importart, blockierende Befunde, Vollständigkeit. */
export interface AttributionStatus {
  /** Kurzbeschreibung: Importart und Objektzahlen. */
  importart: string;
  importErrors: number;
  complete: number | null;
}

export type AttributionMode = "closed" | "open" | "collapsed";

export function AttributionStatusBadges({ status }: { status: AttributionStatus }) {
  return (
    <span className="flex items-center gap-1">
      {status.importErrors ? <Badge tone="danger">Import: {status.importErrors.toLocaleString("de-DE")}</Badge> : <Badge tone="success">Importfähig</Badge>}
      {status.complete != null ? <Badge tone={status.complete === 100 ? "success" : "neutral"}>Vollständig {status.complete} %</Badge> : null}
    </span>
  );
}

/**
 * Großes Fenster über dem Workspace. Eingeklappt bleibt es gemountet (Zustand,
 * Fokus, Tabellenposition bleiben erhalten) und ist über den Chip in der
 * Kopfzeile wieder ausklappbar.
 */
export function AttributionOverlay({
  children,
  collapsed,
  onClose,
  onCollapse,
  status,
}: {
  children: ReactNode;
  collapsed: boolean;
  onClose(): void;
  onCollapse(): void;
  status: AttributionStatus | null;
}) {
  return (
    <div
      aria-label="IFC-Attribuierung"
      aria-modal="false"
      className={cn("fixed inset-x-4 bottom-3 top-[5.25rem] z-30 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl", collapsed && "hidden")}
      role="dialog"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/70 bg-muted/60 px-2 text-xs">
        <span className="font-medium text-foreground">IFC-Attribuierung</span>
        {status ? <AttributionStatusBadges status={status} /> : null}
        <span className="text-muted-foreground">{status?.importart}</span>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" title="Einklappen — bleibt in der Kopfzeile erreichbar, Zustand bleibt erhalten" onClick={onCollapse}>
            <ChevronUp className="size-3.5" />
            Einklappen
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" aria-label="Schließen" title="Schließen" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">{children}</div>
    </div>
  );
}

/** Chip in der Kopfzeile: zeigt Status und klappt das Fenster aus oder ein. */
export function AttributionHeaderChip({ mode, onToggle, status }: { mode: AttributionMode; onToggle(): void; status: AttributionStatus | null }) {
  if (mode === "closed") return null;
  const open = mode === "open";
  return (
    <button
      type="button"
      className={cn("ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors", open ? "border-primary bg-accent text-accent-foreground" : "border-border bg-card text-foreground hover:bg-muted")}
      title={open ? "IFC-Attribuierung einklappen (Zustand bleibt erhalten)" : "IFC-Attribuierung ausklappen"}
      onClick={onToggle}
    >
      {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      <span className="font-medium">IFC-Attribuierung</span>
      {status ? <AttributionStatusBadges status={status} /> : null}
    </button>
  );
}
