import { FileTree, useFileTree } from "@pierre/trees/react";
import { Crosshair, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import type {
    NativeIfcDocument,
    NativeIfcEntity,
    NativeIfcTreeNode,
} from "@/ifc";

import { structureChildGroupsForParent } from "./constants";

interface StructureTreeModel {
  paths: string[];
  expandedPaths: string[];
  idByPath: Map<string, number>;
  pathById: Map<number, string>;
  typeById: Map<number, string>;
  nameById: Map<number, string>;
}

export function StructurePanel({
  document,
  filteredEntities,
  search,
  selectedId,
  onAddChild,
  onCenterCamera,
  onRemove,
  onSelect,
  onSelectMany,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  filteredEntities: NativeIfcEntity[];
  search: string;
  selectedId: number;
  onAddChild(parentId: number, type: string, name: string): void;
  onCenterCamera(id: number): void;
  onRemove(id: number): void;
  onSelect(id: number, source?: string): void;
  onSelectMany(ids: number[]): void;
  onToggle(id: number): void;
}) {
  const treeModel = useMemo(
    () => buildStructureTreeModel(document),
    [document],
  );

  const idByPathRef = useRef(treeModel.idByPath);
  const typeByIdRef = useRef(treeModel.typeById);
  const onAddChildRef = useRef(onAddChild);
  const onCenterCameraRef = useRef(onCenterCamera);
  const onSelectRef = useRef(onSelect);
  const onSelectManyRef = useRef(onSelectMany);
  const onRemoveRef = useRef(onRemove);
  onAddChildRef.current = onAddChild;
  onCenterCameraRef.current = onCenterCamera;
  onSelectRef.current = onSelect;
  onSelectManyRef.current = onSelectMany;
  onRemoveRef.current = onRemove;

  const initialPaths = treeModel.paths.length
    ? treeModel.paths
    : ["(No spatial roots indexed)"];

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "expand-matches",
    flattenEmptyDirectories: false,
    id: "ifcnative-structure-tree",
    initialExpandedPaths: treeModel.expandedPaths,
    initialVisibleRowCount: 18,
    onSelectionChange: (paths) => {
      const ids: number[] = [];
      for (const path of paths) {
        const id = idByPathRef.current.get(path);
        if (typeof id === "number" && !ids.includes(id)) {
          ids.push(id);
        }
      }
      if (ids.length === 0) return;
      onSelectManyRef.current(ids);
    },
    paths: initialPaths,
    renderRowDecoration: ({ item }) => {
      const id = idByPathRef.current.get(item.path);
      if (typeof id !== "number") return null;
      const typeName = typeByIdRef.current.get(id);
      return typeName
        ? { text: typeName.replace(/^IFC/i, ""), title: `#${id} · ${typeName}` }
        : null;
    },
    search: true,
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "both",
        buttonVisibility: "when-needed",
      },
    },
    unsafeCSS: `
      :host {
        font-family: inherit;
        font-size: 13px;
      }
    `,
  });

  useEffect(() => {
    idByPathRef.current = treeModel.idByPath;
    typeByIdRef.current = treeModel.typeById;
    model.resetPaths(
      treeModel.paths.length ? treeModel.paths : ["(No spatial roots indexed)"],
      { initialExpandedPaths: treeModel.expandedPaths },
    );
  }, [model, treeModel]);

  useEffect(() => {
    model.setSearch(search ?? "");
  }, [model, search]);

  useEffect(() => {
    if (selectedId == null) return;
    const path = treeModel.pathById.get(selectedId);
    if (!path) return;
    if (model.getSelectedPaths().includes(path)) return;
    model.getSelectedPaths().forEach((p) => model.getItem(p)?.deselect());
    const item = model.getItem(path);
    item?.select();
    item?.focus();
  }, [model, selectedId, treeModel]);

  // Override default click behaviour: single click on a row body should only
  // select; only the chevron expands. Double click on a row body toggles
  // expansion (original UX from the legacy tree).
  useEffect(() => {
    let cleanup = () => {};
    let retryTimer: number | undefined;

    const isChevron = (event: Event) =>
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            target.dataset.itemSection === "icon",
        );

    const readPath = (event: Event): string | undefined => {
      for (const target of event.composedPath()) {
        if (!(target instanceof HTMLElement)) continue;
        const stickyPath = target.dataset.fileTreeStickyPath;
        if (stickyPath) return stickyPath;
        const itemPath = target.dataset.itemPath;
        if (itemPath) return itemPath;
      }
      return undefined;
    };

    const handleClick = (event: Event) => {
      if (isChevron(event)) return;
      const path = readPath(event);
      if (!path) return;
      const item = model.getItem(path);
      if (!item || !item.isDirectory()) return;
      // Block the library's built-in single-click expand on directory rows
      // by snapshotting the state and restoring it on the next microtask.
      const wasExpanded = item.isExpanded();
      queueMicrotask(() => {
        if (item.isExpanded() !== wasExpanded) {
          if (wasExpanded) item.expand();
          else item.collapse();
        }
      });
    };

    const handleDoubleClick = (event: Event) => {
      if (isChevron(event)) return;
      const path = readPath(event);
      if (!path) return;
      const item = model.getItem(path);
      if (!item || !item.isDirectory()) return;
      item.toggle();
      event.preventDefault();
      event.stopPropagation();
    };

    const connect = () => {
      const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
      if (!shadowRoot) {
        retryTimer = window.setTimeout(connect, 50);
        return;
      }
      shadowRoot.addEventListener("click", handleClick, true);
      shadowRoot.addEventListener("dblclick", handleDoubleClick, true);
      cleanup = () => {
        shadowRoot.removeEventListener("click", handleClick, true);
        shadowRoot.removeEventListener("dblclick", handleDoubleClick, true);
      };
    };

    connect();

    return () => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      cleanup();
    };
  }, [model]);

  const renderContextMenu = useCallback(
    (
      item: { path: string; name: string },
      context: {
        anchorRect: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        };
        close: (options?: { restoreFocus?: boolean }) => void;
      },
    ) => {
      const id = idByPathRef.current.get(item.path);
      if (typeof id !== "number") return null;
      const typeName = typeByIdRef.current.get(id);
      const isProtected = typeName === "IFCPROJECT";
      const childGroups = structureChildGroupsForParent(typeName ?? "");

      const menu = (
        <div
          data-file-tree-context-menu-root="true"
          style={{
            position: "fixed",
            left: context.anchorRect.left,
            top: context.anchorRect.bottom + 4,
            zIndex: 9999,
          }}
        >
          <div className="mb-1 min-w-[190px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted/70"
              onClick={() => {
                context.close({ restoreFocus: false });
                onSelectRef.current(id, "tree");
                onCenterCameraRef.current(id);
              }}
            >
              <Crosshair aria-hidden className="size-3.5" />
              <span className="min-w-0 flex-1">Kamera zentrieren</span>
              <kbd className="rounded border border-border/70 px-1 text-[10px] leading-4 text-muted-foreground">
                .
              </kbd>
            </button>
          </div>
          {childGroups.length ? (
            <div className="mb-1 max-h-72 min-w-[210px] overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Neues Element anlegen
              </div>
              {childGroups.map((group) => (
                <div key={group.label}>
                  <div className="mt-1 border-t border-border/50 px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                    {group.label}
                  </div>
                  {group.options.map((option) => (
                    <button
                      key={`${group.label}-${option.value}`}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted/70"
                      onClick={() => {
                        context.close({ restoreFocus: false });
                        onAddChildRef.current(id, option.value, option.label);
                      }}
                    >
                      <Plus aria-hidden className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {option.label}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                        {option.value.replace(/^IFC/, "")}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {isProtected ? (
            <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md">
              IFCPROJECT kann nicht gelöscht werden.
            </div>
          ) : (
            <div className="min-w-[160px] rounded-md border border-border bg-popover p-1 text-sm shadow-md">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                onClick={() => {
                  context.close({ restoreFocus: false });
                  onRemoveRef.current(id);
                }}
              >
                <Trash2 aria-hidden className="size-3.5" />
                <span>Löschen</span>
              </button>
            </div>
          )}
        </div>
      );

      return createPortal(menu, globalThis.document.body);
    },
    [],
  );

  // Fallback flat list when search is active and the tree-internal search
  // could not project a match (e.g. unindexed entity hits).
  const showFallbackList =
    search.trim().length > 0 &&
    filteredEntities.length > 0 &&
    treeModel.paths.length === 0;

  if (showFallbackList) {
    return (
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {filteredEntities.map((entity) => (
          <FallbackRow
            entity={entity}
            key={entity.id}
            selected={entity.id === selectedId}
            onCenterCamera={onCenterCamera}
            onRemove={onRemove}
            onPress={() => onSelect(entity.id, "tree")}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <FileTree
        className="h-full w-full"
        model={model}
        renderContextMenu={renderContextMenu}
      />
    </div>
  );
}

function FallbackRow({
  entity,
  selected,
  onCenterCamera,
  onRemove,
  onPress,
}: {
  entity: NativeIfcEntity;
  selected: boolean;
  onCenterCamera(id: number): void;
  onRemove(id: number): void;
  onPress(): void;
}) {
  return (
    <div
      className={
        "group mb-0.5 flex items-center gap-1 rounded-md border px-1.5 py-1 text-sm transition-colors " +
        (selected
          ? "border-primary/30 bg-primary/10"
          : "border-transparent hover:bg-muted/40")
      }
    >
      <button
        type="button"
        onClick={onPress}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-[13px] font-medium leading-tight text-foreground">
          {entity.name || `#${entity.id}`}
        </div>
        <div className="truncate text-[11px] leading-tight text-muted-foreground">
          #{entity.id} · {entity.type}
        </div>
      </button>
      <button
        type="button"
        aria-label={`Kamera zentrieren ${entity.name || entity.type}`}
        onClick={() => onCenterCamera(entity.id)}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/70 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Crosshair aria-hidden className="size-3.5" />
      </button>
      {entity.type !== "IFCPROJECT" ? (
        <button
          type="button"
          aria-label={`L\u00f6schen ${entity.name || entity.type}`}
          onClick={() => onRemove(entity.id)}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function buildStructureTreeModel(
  document: NativeIfcDocument,
): StructureTreeModel {
  const model: StructureTreeModel = {
    expandedPaths: [],
    idByPath: new Map(),
    nameById: new Map(),
    pathById: new Map(),
    paths: [],
    typeById: new Map(),
  };
  document.spatialRoots.forEach((root) =>
    addTreeNode(root, "", document, model),
  );
  return model;
}

function addTreeNode(
  node: NativeIfcTreeNode,
  parentPath: string,
  document: NativeIfcDocument,
  model: StructureTreeModel,
) {
  const entity = document.entityById.get(node.id);
  if (!entity) return;

  const segment = formatTreeSegment(entity);
  const basePath = parentPath ? `${parentPath}/${segment}` : segment;
  const hasChildren = node.children.length > 0;
  const canonicalPath = hasChildren ? `${basePath}/` : basePath;

  model.paths.push(canonicalPath);
  model.idByPath.set(basePath, entity.id);
  model.idByPath.set(canonicalPath, entity.id);
  model.pathById.set(entity.id, canonicalPath);
  model.typeById.set(entity.id, entity.type);
  model.nameById.set(entity.id, entity.name || `#${entity.id}`);

  if (hasChildren) {
    model.expandedPaths.push(canonicalPath);
    node.children.forEach((child) =>
      addTreeNode(child, basePath, document, model),
    );
  }
}

function formatTreeSegment(entity: NativeIfcEntity) {
  const label = sanitizeSegment(entity.name || entity.type);
  return `${label} #${entity.id}`;
}

function sanitizeSegment(value: string) {
  return (
    value.replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 96) ||
    "IFC Entity"
  );
}

export function findTreePath(document: NativeIfcDocument, id: number) {
  const path: NativeIfcEntity[] = [];
  const visit = (node: NativeIfcTreeNode): boolean => {
    const entity = document.entityById.get(node.id);
    if (entity) {
      path.push(entity);
    }
    if (node.id === id) {
      return true;
    }
    if (node.children.some(visit)) {
      return true;
    }
    path.pop();
    return false;
  };
  document.spatialRoots.some(visit);
  return path;
}
