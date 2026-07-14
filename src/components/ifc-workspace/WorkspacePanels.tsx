import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Focus, FileText, Trash2 } from "lucide-react";

import { Badge, EmptyState, PanelHeader, PanelShell } from "./ui";
import type { RecentIfcFileEntry } from "./workspaceStorage";

export function RecentFilesPanel({
  activeDocumentId,
  entries,
  onClear,
  onSelectDocument,
}: {
  activeDocumentId: string;
  entries: RecentIfcFileEntry[];
  onClear(): void;
  onSelectDocument(documentId: string): void;
}) {
  return (
    <PanelShell scroll>
      <PanelHeader
        title="Kürzlich verwendet"
        meta={<Badge tone="info">{entries.length.toLocaleString("de-DE")}</Badge>}
        actions={
          entries.length ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              title="Liste leeren"
              onClick={onClear}
            >
              <Trash2 aria-hidden className="size-3.5" />
              Leeren
            </Button>
          ) : null
        }
      />
      {entries.length ? (
        <div className="divide-y divide-border/50 overflow-hidden rounded-md border border-border/60 bg-card">
          {entries.map((entry) => {
            const isActive =
              Boolean(entry.documentId) &&
              entry.documentId === activeDocumentId;
            const canFocus = Boolean(entry.documentId) && !isActive;
            const meta = [
              entry.schema,
              entry.entityCount
                ? `${entry.entityCount.toLocaleString("de-DE")} Entitäten`
                : null,
              entry.size ? formatByteSize(entry.size) : null,
              formatDateTime(entry.openedAt),
            ].filter((part): part is string => Boolean(part));
            return (
              <div
                key={entry.id}
                className={cn(
                  "group flex min-w-0 items-center gap-2 px-2 py-1.5 transition-colors",
                  canFocus && "cursor-pointer hover:bg-muted/45",
                  isActive && "bg-primary/5",
                )}
                title={entry.path || entry.name}
                onClick={
                  canFocus
                    ? () => onSelectDocument(entry.documentId as string)
                    : undefined
                }
              >
                <FileText
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">
                    {entry.name}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {meta.join(" · ")}
                  </div>
                </div>
                {isActive ? (
                  <Badge tone="success">Aktiv</Badge>
                ) : entry.documentId ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 shrink-0 px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    title="Dokument im Editor fokussieren"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectDocument(entry.documentId as string);
                    }}
                  >
                    <Focus aria-hidden className="size-3.5" />
                    Fokus
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Noch keine IFC-Dateien geladen"
          description="Geöffnete Dateien erscheinen hier mit Schema, Entitäten und Größe."
        />
      )}
    </PanelShell>
  );
}

export function NotesPanel({
  notes,
  onNotesChange,
}: {
  notes: string;
  onNotesChange(notes: string): void;
}) {
  return (
    <PanelShell>
      <PanelHeader title="Notizen" meta={<Badge tone="success">sync</Badge>} />
      <Textarea
        className="min-h-0 flex-1 resize-none text-sm leading-relaxed"
        placeholder="Notizen zum Modell …"
        value={notes}
        onChange={(event) => onNotesChange(event.currentTarget.value)}
      />
      <p className="shrink-0 text-[11px] text-muted-foreground">
        Änderungen werden automatisch lokal gespeichert.
      </p>
    </PanelShell>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatByteSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024).toLocaleString("de-DE")} KB`;
  }
  return `${bytes.toLocaleString("de-DE")} B`;
}
