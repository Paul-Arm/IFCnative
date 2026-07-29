import { Button as IconButton } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FilePlus2,
  FolderOpen,
  HardDriveDownload,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { Button, MosaicWindowMenu } from "../ui";
import {
  BUILT_IN_WORKSPACES,
  DEFAULT_WORKSPACE_ID,
  type WorkspaceDefinition,
} from "../constants";
import type {
  WorkspaceDocumentSession,
  WorkspaceHistoryEntry,
} from "../session/documentSession";
import { ThemeToggle } from "../ThemeToggle";
import type { MosaicViewId } from "../types";

interface WorkspaceSwitcherProps {
  activeWorkspace: WorkspaceDefinition | undefined;
  customWorkspaces: WorkspaceDefinition[];
  onCreateWorkspace: () => void;
  onDeleteWorkspace: () => void;
  onSaveWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
}

function WorkspaceSwitcher({
  activeWorkspace,
  customWorkspaces,
  onCreateWorkspace,
  onDeleteWorkspace,
  onSaveWorkspace,
  onSelectWorkspace,
}: WorkspaceSwitcherProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={activeWorkspace?.id ?? DEFAULT_WORKSPACE_ID}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onSelectWorkspace(nextValue);
          }
        }}
      >
        <SelectTrigger
          aria-label="Workspace"
          className="w-52 bg-background"
          size="sm"
        >
          <SelectValue>{activeWorkspace?.name ?? "Workspace"}</SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          className="!w-[30rem] max-w-[calc(100vw-2rem)]"
        >
          <SelectGroup>
            <SelectLabel>Standard</SelectLabel>
            {BUILT_IN_WORKSPACES.map((workspace) => (
              <SelectItem key={workspace.id} value={workspace.id}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{workspace.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspace.description}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          {customWorkspaces.length ? (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Eigene</SelectLabel>
                {customWorkspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={workspace.id}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{workspace.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {workspace.updatedAt
                          ? new Date(workspace.updatedAt).toLocaleString()
                          : workspace.description}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          ) : null}
        </SelectContent>
      </Select>
      <IconButton
        aria-label="Neuen Workspace hinzufügen"
        size="icon-sm"
        title="Neuen Workspace hinzufügen"
        variant="outline"
        onClick={onCreateWorkspace}
      >
        <Plus aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton
        aria-label="Workspace speichern"
        disabled={Boolean(activeWorkspace?.builtIn)}
        size="icon-sm"
        title={
          activeWorkspace?.builtIn
            ? "Standard-Workspaces sind fix"
            : "Workspace speichern"
        }
        variant="outline"
        onClick={onSaveWorkspace}
      >
        <Save aria-hidden className="size-3.5" />
      </IconButton>
      {!activeWorkspace?.builtIn ? (
        <IconButton
          aria-label="Workspace löschen"
          size="icon-sm"
          title="Workspace löschen"
          variant="outline"
          onClick={onDeleteWorkspace}
        >
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

interface DocumentTabsProps {
  activeSessionId: string;
  documentSessions: WorkspaceDocumentSession[];
  onCloseSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

function DocumentTabs({
  activeSessionId,
  documentSessions,
  onCloseSession,
  onSelectSession,
}: DocumentTabsProps) {
  return (
    <Tabs
      value={activeSessionId}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onSelectSession(nextValue);
        }
      }}
      className="min-w-0 overflow-hidden"
    >
      <div className="-mx-1 overflow-x-auto overflow-y-hidden px-1">
        <TabsList
          variant="line"
          className="h-auto min-w-max justify-start gap-1 bg-transparent p-0 pb-px"
        >
          {documentSessions.map((session) => (
            // Wrapper statt Button-im-Button: der Schließen-Button liegt als
            // Geschwister absolut über dem Tab (valides HTML, eigener Fokus).
            <span key={session.id} className="group/tab relative inline-flex">
              <TabsTrigger
                value={session.id}
                className="group relative h-auto min-w-36 max-w-56 flex-col items-start gap-0.5 rounded-t-md border-x border-t border-transparent bg-transparent py-1.5 pr-7 pl-2.5 text-left transition-colors hover:bg-muted/40 data-active:border-border data-active:bg-card data-active:shadow-[0_1px_0_0_var(--color-card)]"
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40 group-data-active:bg-primary" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {session.document.fileName}
                  </span>
                  {session.documentTextDirty ? (
                    <span
                      aria-label="Ungespeicherte Änderungen"
                      className="size-1.5 shrink-0 rounded-full bg-warning"
                      title="Ungespeicherte Änderungen"
                    />
                  ) : null}
                </span>
                <span className="w-full truncate pl-3 text-[0.65rem] font-normal text-muted-foreground">
                  {session.document.schema} ·{" "}
                  {session.document.entities.length.toLocaleString("de-DE")}{" "}
                  Entitäten
                </span>
              </TabsTrigger>
              {documentSessions.length > 1 ? (
                <button
                  aria-label={`${session.document.fileName} schließen`}
                  className="absolute top-1.5 right-1.5 grid size-4 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  title="Schließen"
                  type="button"
                  onClick={() => onCloseSession(session.id)}
                >
                  <X aria-hidden className="size-3" />
                </button>
              ) : null}
            </span>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}

export interface WorkspaceHeaderProps
  extends WorkspaceSwitcherProps,
    Omit<DocumentTabsProps, "activeSessionId"> {
  activeSessionId: string;
  closedMosaicIds: MosaicViewId[];
  loadingIfcName: string;
  redoStack: WorkspaceHistoryEntry[];
  undoStack: WorkspaceHistoryEntry[];
  onAddIfcFiles: () => void;
  onExportIfc: () => void;
  onOpenIfc: () => void;
  onRedo: () => void;
  onRestoreView: (id: MosaicViewId) => void;
  onUndo: () => void;
}

/** Kopfzeile des Editors: Workspace-Wahl, Dokument-Tabs und Datei-Toolbar. */
export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const {
    activeSessionId,
    closedMosaicIds,
    documentSessions,
    loadingIfcName,
    onAddIfcFiles,
    onCloseSession,
    onExportIfc,
    onOpenIfc,
    onRedo,
    onRestoreView,
    onSelectSession,
    onUndo,
    redoStack,
    undoStack,
  } = props;
  return (
    <header className="relative z-20 flex shrink-0 flex-col gap-2 border-b border-border/70 bg-card/95 px-3 pt-2 pb-0 shadow-sm backdrop-blur lg:flex-row lg:items-center lg:gap-3">
      <WorkspaceSwitcher
        activeWorkspace={props.activeWorkspace}
        customWorkspaces={props.customWorkspaces}
        onCreateWorkspace={props.onCreateWorkspace}
        onDeleteWorkspace={props.onDeleteWorkspace}
        onSaveWorkspace={props.onSaveWorkspace}
        onSelectWorkspace={props.onSelectWorkspace}
      />
      <div className="min-w-0 flex-1">
        <DocumentTabs
          activeSessionId={activeSessionId}
          documentSessions={documentSessions}
          onCloseSession={onCloseSession}
          onSelectSession={onSelectSession}
        />
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pb-2 lg:pb-0">
        <Button
          disabled={Boolean(loadingIfcName)}
          variant="default"
          onClick={onOpenIfc}
        >
          <FolderOpen aria-hidden className="size-3.5" />
          <span className="hidden xl:inline">
            {loadingIfcName ? "Lädt…" : "IFC öffnen"}
          </span>
        </Button>
        <Button
          disabled={Boolean(loadingIfcName)}
          title="Weitere IFC-Dateien hinzufügen"
          onClick={onAddIfcFiles}
        >
          <FilePlus2 aria-hidden className="size-3.5" />
          <span className="hidden xl:inline">Hinzufügen</span>
        </Button>
        <Button
          disabled={Boolean(loadingIfcName)}
          title="Aktives Dokument als IFC exportieren"
          onClick={onExportIfc}
        >
          <HardDriveDownload aria-hidden className="size-3.5" />
          <span className="hidden xl:inline">Exportieren</span>
        </Button>
        <div className="mx-1 h-5 w-px bg-border/70" />
        <IconButton
          aria-label="Rückgängig"
          disabled={!undoStack.length}
          size="icon-sm"
          title={
            undoStack.length
              ? `Rückgängig: ${undoStack.at(-1)?.summary} · Strg+Z`
              : "Nichts rückgängig zu machen"
          }
          variant="outline"
          onClick={onUndo}
        >
          <Undo2 aria-hidden className="size-3.5" />
        </IconButton>
        <IconButton
          aria-label="Wiederholen"
          disabled={!redoStack.length}
          size="icon-sm"
          title={
            redoStack.length
              ? `Wiederholen: ${redoStack.at(-1)?.summary} · Strg+Umschalt+Z`
              : "Nichts zu wiederholen"
          }
          variant="outline"
          onClick={onRedo}
        >
          <Redo2 aria-hidden className="size-3.5" />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-border/70" />
        <MosaicWindowMenu closedIds={closedMosaicIds} onRestore={onRestoreView} />
        <ThemeToggle />
      </div>
    </header>
  );
}
