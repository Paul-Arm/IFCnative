import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Clock3, FileText, Trash2 } from "lucide-react";

import { Badge, PanelHeader, PanelShell } from "./ui";
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
        title="Kuerzlich verwendet"
        meta={<Badge tone="info">{entries.length.toLocaleString()}</Badge>}
        actions={
          entries.length ? (
            <Button
              size="sm"
              variant="outline"
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
        <div className="grid gap-2">
          {entries.map((entry) => {
            const isActive = entry.documentId === activeDocumentId;
            return (
              <article
                key={entry.id}
                className="grid gap-2 rounded-md border border-border/60 bg-card px-3 py-2"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <FileText
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {entry.name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{formatDateTime(entry.openedAt)}</span>
                      {entry.schema ? <span>{entry.schema}</span> : null}
                      {entry.entityCount ? (
                        <span>
                          {entry.entityCount.toLocaleString()} Entities
                        </span>
                      ) : null}
                      {entry.size ? <span>{formatByteSize(entry.size)}</span> : null}
                    </div>
                  </div>
                  {entry.documentId ? (
                    <Button
                      disabled={isActive}
                      size="sm"
                      variant={isActive ? "secondary" : "outline"}
                      onClick={() => onSelectDocument(entry.documentId as string)}
                    >
                      {isActive ? "Aktiv" : "Fokus"}
                    </Button>
                  ) : null}
                </div>
                {entry.path ? (
                  <div className="truncate rounded bg-muted/45 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {entry.path}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/70 bg-muted/30 text-center text-sm text-muted-foreground">
          <Clock3 aria-hidden className="size-5" />
          Noch keine IFC-Dateien geladen.
        </div>
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
      <PanelHeader
        title="Notizen"
        meta={<Badge tone="success">sync</Badge>}
      />
      <Textarea
        className="min-h-0 flex-1 resize-none text-sm leading-relaxed"
        placeholder="Notizen zum Modell..."
        value={notes}
        onChange={(event) => onNotesChange(event.currentTarget.value)}
      />
    </PanelShell>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleString();
}

function formatByteSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024).toLocaleString()} KB`;
  }
  return `${bytes.toLocaleString()} B`;
}
