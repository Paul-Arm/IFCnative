import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import {
  FilePlus2,
  FolderOpen,
  HardDriveDownload,
  LayoutGrid,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import {
  BUILT_IN_WORKSPACES,
  MOSAIC_TITLES,
  type WorkspaceDefinition,
} from "./constants";
import type { MosaicViewId } from "./types";

/**
 * Kategorien für das Fenster-Menü. Muss alle MOSAIC_VIEW_IDS abdecken —
 * ein Panel ohne Kategorie wäre über die Menüleiste nicht mehr erreichbar.
 */
const WINDOW_MENU_CATEGORIES: {
  label: string;
  ids: MosaicViewId[];
}[] = [
  { label: "Modell", ids: ["viewer", "structure", "inspector"] },
  {
    label: "Bauen",
    ids: ["attribution", "builder", "catalog", "catalog-review", "pset-batch"],
  },
  {
    label: "Prüfen",
    ids: ["check", "diagnostics", "resource-references", "resource-controls"],
  },
  { label: "Portal", ids: ["portal", "portal-settings"] },
  { label: "Weitere", ids: ["recent", "notes"] },
];

export function WorkspaceMenubar({
  activeFileName,
  activeWorkspaceId,
  canCloseActiveDocument,
  closedViewIds,
  customWorkspaces,
  loading,
  redoSummary,
  undoSummary,
  onAddIfcFiles,
  onCloseActiveDocument,
  onCreateWorkspace,
  onDeleteWorkspace,
  onExportIfc,
  onOpenIfc,
  onRedo,
  onResetLayout,
  onSaveWorkspace,
  onSelectWorkspace,
  onToggleView,
  onUndo,
}: {
  activeFileName: string;
  activeWorkspaceId: string;
  canCloseActiveDocument: boolean;
  closedViewIds: MosaicViewId[];
  customWorkspaces: WorkspaceDefinition[];
  loading: boolean;
  redoSummary?: string;
  undoSummary?: string;
  onAddIfcFiles(): void;
  onCloseActiveDocument(): void;
  onCreateWorkspace(): void;
  onDeleteWorkspace(): void;
  onExportIfc(): void;
  onOpenIfc(): void;
  onRedo(): void;
  onResetLayout(): void;
  onSaveWorkspace(): void;
  onSelectWorkspace(id: string): void;
  onToggleView(id: MosaicViewId, open: boolean): void;
  onUndo(): void;
}) {
  const activeWorkspace =
    BUILT_IN_WORKSPACES.find((workspace) => workspace.id === activeWorkspaceId) ??
    customWorkspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const closedIds = new Set(closedViewIds);

  return (
    <Menubar className="h-7 rounded-none border-0 bg-transparent p-0">
      <MenubarMenu>
        <MenubarTrigger>Datei</MenubarTrigger>
        <MenubarContent className="w-64">
          <MenubarItem disabled={loading} onClick={onOpenIfc}>
            <FolderOpen aria-hidden className="size-3.5" />
            IFC öffnen…
            <MenubarShortcut>Strg+O</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={loading} onClick={onAddIfcFiles}>
            <FilePlus2 aria-hidden className="size-3.5" />
            IFC hinzufügen…
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            disabled={loading}
            title="Aktives Dokument als IFC exportieren"
            onClick={onExportIfc}
          >
            <HardDriveDownload aria-hidden className="size-3.5" />
            Exportieren
            <MenubarShortcut>Strg+S</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem
            disabled={!canCloseActiveDocument}
            title={
              canCloseActiveDocument
                ? `„${activeFileName}“ schließen`
                : "Das letzte Dokument kann nicht geschlossen werden"
            }
            onClick={onCloseActiveDocument}
          >
            <X aria-hidden className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              „{activeFileName}“ schließen
            </span>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Bearbeiten</MenubarTrigger>
        <MenubarContent className="w-64">
          <MenubarItem
            disabled={!undoSummary}
            title={undoSummary ? `Rückgängig: ${undoSummary}` : undefined}
            onClick={onUndo}
          >
            <Undo2 aria-hidden className="size-3.5" />
            Rückgängig
            <MenubarShortcut>Strg+Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            disabled={!redoSummary}
            title={redoSummary ? `Wiederholen: ${redoSummary}` : undefined}
            onClick={onRedo}
          >
            <Redo2 aria-hidden className="size-3.5" />
            Wiederholen
            <MenubarShortcut>Strg+Umschalt+Z</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Ansicht</MenubarTrigger>
        <MenubarContent className="w-72">
          {/* GroupLabel braucht bei Base UI zwingend einen Group-/RadioGroup-
              Kontext, sonst wirft das Menü beim Öffnen. */}
          <MenubarRadioGroup
            value={activeWorkspaceId}
            onValueChange={(nextValue) => {
              if (typeof nextValue === "string" && nextValue) {
                onSelectWorkspace(nextValue);
              }
            }}
          >
            <MenubarLabel>Workspace</MenubarLabel>
            {BUILT_IN_WORKSPACES.map((workspace) => (
              <MenubarRadioItem
                key={workspace.id}
                closeOnClick
                value={workspace.id}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{workspace.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {workspace.description}
                  </span>
                </span>
              </MenubarRadioItem>
            ))}
            {customWorkspaces.length ? (
              <>
                <MenubarSeparator />
                <MenubarLabel>Eigene</MenubarLabel>
                {customWorkspaces.map((workspace) => (
                  <MenubarRadioItem
                    key={workspace.id}
                    closeOnClick
                    value={workspace.id}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{workspace.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {workspace.updatedAt
                          ? new Date(workspace.updatedAt).toLocaleString()
                          : workspace.description}
                      </span>
                    </span>
                  </MenubarRadioItem>
                ))}
              </>
            ) : null}
          </MenubarRadioGroup>
          <MenubarSeparator />
          <MenubarItem
            disabled={Boolean(activeWorkspace?.builtIn)}
            title={
              activeWorkspace?.builtIn
                ? "Standard-Workspaces sind fix"
                : "Aktuelles Layout im Workspace speichern"
            }
            onClick={onSaveWorkspace}
          >
            <Save aria-hidden className="size-3.5" />
            Workspace speichern
          </MenubarItem>
          <MenubarItem
            title="Aktuelles Layout als neuen Workspace anlegen"
            onClick={onCreateWorkspace}
          >
            <Plus aria-hidden className="size-3.5" />
            Als neuen Workspace anlegen
          </MenubarItem>
          {!activeWorkspace?.builtIn ? (
            <MenubarItem variant="destructive" onClick={onDeleteWorkspace}>
              <Trash2 aria-hidden className="size-3.5" />
              Workspace löschen
            </MenubarItem>
          ) : null}
          <MenubarSeparator />
          <MenubarItem
            title="Fensteranordnung auf den Workspace-Stand zurücksetzen"
            onClick={onResetLayout}
          >
            <LayoutGrid aria-hidden className="size-3.5" />
            Layout zurücksetzen
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Fenster</MenubarTrigger>
        <MenubarContent className="w-64">
          {WINDOW_MENU_CATEGORIES.map((category, index) => (
            <MenubarMenuCategory
              key={category.label}
              category={category}
              closedIds={closedIds}
              withSeparator={index > 0}
              onToggleView={onToggleView}
            />
          ))}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

function MenubarMenuCategory({
  category,
  closedIds,
  withSeparator,
  onToggleView,
}: {
  category: { label: string; ids: MosaicViewId[] };
  closedIds: Set<MosaicViewId>;
  withSeparator: boolean;
  onToggleView(id: MosaicViewId, open: boolean): void;
}) {
  return (
    <>
      {withSeparator ? <MenubarSeparator /> : null}
      <MenubarGroup>
        <MenubarLabel className="text-xs text-muted-foreground">
          {category.label}
        </MenubarLabel>
        {category.ids.map((id) => (
          <MenubarCheckboxItem
            key={id}
            checked={!closedIds.has(id)}
            onCheckedChange={(checked) => onToggleView(id, checked)}
          >
            {MOSAIC_TITLES[id]}
          </MenubarCheckboxItem>
        ))}
      </MenubarGroup>
    </>
  );
}
