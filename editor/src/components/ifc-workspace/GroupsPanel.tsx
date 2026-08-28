import { FileTree, useFileTree } from "@pierre/trees/react";
import { Boxes, Crosshair, Trash2, Ungroup } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import type { NativeIfcDocument, NativeIfcEntity } from "@/ifc";

import { GROUP_ENTITY_TYPES, GROUP_VIEW_CATEGORIES } from "./constants";

/** Anzahl Render-Frames für das Reveal im virtualisierten Baum. */
const TREE_REVEAL_MAX_FRAMES = 30;

interface GroupMembership {
  memberId: number;
  groupId: number;
  groupLabel: string;
}

interface GroupTreeModel {
  paths: string[];
  expandedPaths: string[];
  idByPath: Map<string, number>;
  pathById: Map<number, string>;
  typeById: Map<number, string>;
  /** Zeilen, die eine lösbare Gruppenmitgliedschaft repräsentieren. */
  membershipByPath: Map<string, GroupMembership>;
  groupCount: number;
}

export function GroupsPanel({
  document,
  revealSelectionNonce,
  search,
  selectedId,
  selectedIds,
  onCenterCamera,
  onManageGroups,
  onRemove,
  onRemoveMembership,
  onSelect,
  onSelectMany,
}: {
  document: NativeIfcDocument;
  revealSelectionNonce: number;
  search: string;
  selectedId: number;
  /** Vollständige (Mehrfach-)Auswahl des Workspaces, enthält selectedId. */
  selectedIds: number[];
  onCenterCamera(id: number): void;
  onManageGroups(id: number): void;
  onRemove(id: number): void;
  onRemoveMembership(memberId: number, groupId: number): void;
  onSelect(id: number, source?: string): void;
  onSelectMany(ids: number[]): void;
}) {
  const treeModel = useMemo(() => buildGroupTreeModel(document), [document]);

  const idByPathRef = useRef(treeModel.idByPath);
  const typeByIdRef = useRef(treeModel.typeById);
  const membershipByPathRef = useRef(treeModel.membershipByPath);
  const onCenterCameraRef = useRef(onCenterCamera);
  const onManageGroupsRef = useRef(onManageGroups);
  const onRemoveRef = useRef(onRemove);
  const onRemoveMembershipRef = useRef(onRemoveMembership);
  const onSelectRef = useRef(onSelect);
  const onSelectManyRef = useRef(onSelectMany);
  onCenterCameraRef.current = onCenterCamera;
  onManageGroupsRef.current = onManageGroups;
  onRemoveRef.current = onRemove;
  onRemoveMembershipRef.current = onRemoveMembership;
  onSelectRef.current = onSelect;
  onSelectManyRef.current = onSelectMany;
  /** Unterdrückt Selektions-Echos, während der Reveal-Effekt selbst synct. */
  const selectionSyncActiveRef = useRef(false);
  /** Letztes Reveal-Ziel — Fokus/Scroll nur bei echter Zieländerung. */
  const lastRevealRef = useRef<{ nonce: number; selectedId: number } | null>(
    null,
  );

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "expand-matches",
    flattenEmptyDirectories: false,
    id: "ifcnative-groups-tree",
    initialExpandedPaths: treeModel.expandedPaths,
    initialVisibleRowCount: 18,
    onSelectionChange: (paths) => {
      // Echos des programmatischen Reveal-Syncs ignorieren (wie im
      // Spatial-Baum) — sie tragen keine neue Information.
      if (selectionSyncActiveRef.current) return;
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
    paths: treeModel.paths,
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
      /* Wie im Spatial-Baum: Shadow DOM erbt keine Tailwind-Styles, aber
         CSS-Custom-Properties queren die Shadow-Grenze — Design-Tokens auf
         die --trees-theme-*-Variablen mappen (Dark Mode inklusive). */
      :host {
        font-family: inherit;
        font-size: 13px;
        --trees-theme-sidebar-bg: var(--card);
        --trees-theme-sidebar-fg: var(--foreground);
        --trees-theme-sidebar-header-fg: var(--muted-foreground);
        --trees-theme-sidebar-border: var(--border);
        --trees-theme-list-hover-bg: var(--accent);
        --trees-theme-list-active-selection-bg: color-mix(
          in oklab,
          var(--primary) 14%,
          transparent
        );
        --trees-theme-list-active-selection-fg: var(--foreground);
        --trees-theme-focus-ring: var(--ring);
        --trees-theme-input-bg: var(--card);
        --trees-theme-input-fg: var(--foreground);
        --trees-theme-input-border: var(--input);
        --trees-theme-scrollbar-thumb: color-mix(
          in oklab,
          var(--muted-foreground) 35%,
          transparent
        );
      }
    `,
  });

  useEffect(() => {
    idByPathRef.current = treeModel.idByPath;
    typeByIdRef.current = treeModel.typeById;
    membershipByPathRef.current = treeModel.membershipByPath;
    model.resetPaths(treeModel.paths, {
      initialExpandedPaths: treeModel.expandedPaths,
    });
  }, [model, treeModel]);

  useEffect(() => {
    model.setSearch(search ?? "");
  }, [model, search]);

  // Reveal der Außenselektion: Vorfahren aufklappen, Zeile selektieren und in
  // den sichtbaren Bereich scrollen (erste Fundstelle bei Mehrfach-Pfaden).
  useEffect(() => {
    if (selectedId == null) return;
    const path = treeModel.pathById.get(selectedId);
    if (!path) return;

    getAncestorDirectoryPaths(path).forEach((ancestorPath) => {
      const ancestor = model.getItem(ancestorPath);
      if (ancestor && "isExpanded" in ancestor && !ancestor.isExpanded()) {
        ancestor.expand();
      }
    });

    const item = model.getItem(path);
    if (!item) return;
    // Wie im Spatial-Baum: mit der kompletten Workspace-Auswahl abgleichen,
    // damit der Reveal eine Mehrfachauswahl (z. B. Strg-Klick im 3D-Viewer)
    // nicht über den onSelectionChange-Callback wieder auflöst.
    const targetPaths = new Set(
      (selectedIds.length ? selectedIds : [selectedId]).flatMap((id) => {
        const idPath = treeModel.pathById.get(id);
        return idPath ? [idPath] : [];
      }),
    );
    targetPaths.add(path);
    // Mitglieder erscheinen unter JEDER Gruppe; pathById kennt nur das erste
    // Vorkommen. Andere Vorkommen einer ausgewählten Entität (z. B. die vom
    // Nutzer angeklickte Zeile unter einer zweiten Gruppe) bleiben selektiert.
    const targetIds = new Set(selectedIds.length ? selectedIds : [selectedId]);
    selectionSyncActiveRef.current = true;
    try {
      const currentPaths = model.getSelectedPaths();
      for (const targetPath of targetPaths) {
        if (!currentPaths.includes(targetPath)) {
          model.getItem(targetPath)?.select();
        }
      }
      for (const currentPath of currentPaths) {
        if (targetPaths.has(currentPath)) {
          continue;
        }
        const currentId = idByPathRef.current.get(currentPath);
        if (currentId !== undefined && targetIds.has(currentId)) {
          continue;
        }
        model.getItem(currentPath)?.deselect();
      }
    } finally {
      selectionSyncActiveRef.current = false;
    }
    // Fokus/Scroll nur bei echter Zieländerung — sonst springt der Baum bei
    // jeder additiven Erweiterung zur Primärzeile zurück.
    const revealTargetChanged =
      lastRevealRef.current?.selectedId !== selectedId ||
      lastRevealRef.current?.nonce !== revealSelectionNonce;
    lastRevealRef.current = { nonce: revealSelectionNonce, selectedId };
    if (!revealTargetChanged) {
      return;
    }
    item.focus();

    let animationFrame = 0;
    let revealFrame = 0;
    const revealSelectedItem = () => {
      revealFrame += 1;
      const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
      const renderedRow = shadowRoot
        ? Array.from(
            shadowRoot.querySelectorAll<HTMLElement>("[data-item-path]"),
          ).find(
            (row) =>
              row.dataset.itemPath === path &&
              row.dataset.itemParked !== "true",
          )
        : undefined;
      if (renderedRow) {
        renderedRow.scrollIntoView({ block: "center", inline: "nearest" });
        return;
      }
      if (revealFrame < TREE_REVEAL_MAX_FRAMES) {
        animationFrame = window.requestAnimationFrame(revealSelectedItem);
      }
    };
    animationFrame = window.requestAnimationFrame(revealSelectedItem);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [model, revealSelectionNonce, selectedId, selectedIds, treeModel]);

  // Wie im Spatial-Baum: Einfachklick selektiert nur, Chevron/Doppelklick
  // klappt auf bzw. zu.
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
      if (!item || !("isExpanded" in item)) return;
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
      if (!item || !("toggle" in item)) return;
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
      // Kategorie-Zeilen sind synthetisch (keine IFC-Entität) — kein Menü.
      if (typeof id !== "number") return null;
      const membership = membershipByPathRef.current.get(item.path);

      const menuItemClass =
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";

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
          <div className="min-w-[200px] max-w-[280px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                context.close({ restoreFocus: false });
                onSelectRef.current(id, "groups");
                onCenterCameraRef.current(id);
              }}
            >
              <Crosshair
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">Kamera zentrieren</span>
              <kbd className="ml-auto text-[10px] text-muted-foreground">.</kbd>
            </button>
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                context.close({ restoreFocus: false });
                onManageGroupsRef.current(id);
              }}
            >
              <Boxes
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">
                Gruppen verwalten…
              </span>
            </button>
            {membership ? (
              <button
                type="button"
                className={menuItemClass}
                onClick={() => {
                  context.close({ restoreFocus: false });
                  onRemoveMembershipRef.current(
                    membership.memberId,
                    membership.groupId,
                  );
                }}
              >
                <Ungroup
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">
                  Aus '{membership.groupLabel}' entfernen
                </span>
              </button>
            ) : null}
            <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
              onClick={() => {
                context.close({ restoreFocus: false });
                onRemoveRef.current(id);
              }}
            >
              <Trash2 aria-hidden className="size-3.5 shrink-0" />
              <span>Entität löschen</span>
            </button>
          </div>
        </div>
      );

      return createPortal(menu, globalThis.document.body);
    },
    [],
  );

  if (treeModel.groupCount === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            Keine Gruppen im Modell.
          </p>
          <p className="mt-1.5">
            Gruppen, Systeme und Zonen erscheinen hier, sobald das IFC
            IFCRELASSIGNSTOGROUP-Zuweisungen enthält. Neue Gruppen lassen sich
            im Inspector unter „Beziehungen" für die aktuelle Auswahl anlegen.
          </p>
        </div>
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

/**
 * Baut das pfadbasierte Baummodell der Gruppen-Ansicht:
 * Kategorie → Gruppe → Mitglieder. Die Gruppenstruktur ist ein DAG — ein
 * Objekt kann in mehreren Gruppen stecken und Gruppen können verschachtelt
 * sein. Mitglieder werden deshalb unter jeder Gruppe dupliziert (eigener
 * Pfad je Vorkommen); Zyklen bricht der visited-Guard ab.
 */
function buildGroupTreeModel(document: NativeIfcDocument): GroupTreeModel {
  const model: GroupTreeModel = {
    expandedPaths: [],
    groupCount: 0,
    idByPath: new Map(),
    membershipByPath: new Map(),
    pathById: new Map(),
    paths: [],
    typeById: new Map(),
  };

  const membersByGroup = new Map<number, number[]>();
  for (const relationship of document.relationships) {
    if (!relationship.type.startsWith("IFCRELASSIGNSTOGROUP")) {
      continue;
    }
    for (const groupId of relationship.targetIds) {
      const members = membersByGroup.get(groupId) ?? [];
      for (const memberId of relationship.sourceIds) {
        if (memberId !== groupId && !members.includes(memberId)) {
          members.push(memberId);
        }
      }
      membersByGroup.set(groupId, members);
    }
  }

  for (const category of GROUP_VIEW_CATEGORIES) {
    const typeSet = new Set(category.types);
    const groups = document.entities.filter((entity) =>
      typeSet.has(entity.type),
    );
    if (groups.length === 0) {
      continue;
    }
    model.groupCount += groups.length;
    const categoryPath = `${sanitizeSegment(category.label)}/`;
    model.paths.push(categoryPath);
    model.expandedPaths.push(categoryPath);
    // Jede Gruppe erscheint auf oberster Ebene ihrer Kategorie — auch wenn
    // sie zusätzlich als Mitglied einer anderen Gruppe verschachtelt ist.
    // So bleibt sie auffindbar und Zyklen verschlucken keine Gruppe.
    for (const group of groups) {
      addEntityNode(
        group,
        sanitizeSegment(category.label),
        undefined,
        document,
        membersByGroup,
        model,
        new Set(),
      );
    }
  }

  return model;
}

function addEntityNode(
  entity: NativeIfcEntity,
  parentPath: string,
  membership: GroupMembership | undefined,
  document: NativeIfcDocument,
  membersByGroup: Map<number, number[]>,
  model: GroupTreeModel,
  visitedGroupIds: Set<number>,
) {
  const segment = formatTreeSegment(entity);
  const basePath = parentPath ? `${parentPath}/${segment}` : segment;
  const isGroup = GROUP_ENTITY_TYPES.has(entity.type);
  // Zyklus-Guard: eine bereits auf dem aktuellen Pfad besuchte Gruppe wird
  // als Blatt gerendert statt endlos zu rekursieren.
  const memberIds =
    isGroup && !visitedGroupIds.has(entity.id)
      ? (membersByGroup.get(entity.id) ?? [])
      : [];
  const members = memberIds
    .map((memberId) => document.entityById.get(memberId))
    .filter((member): member is NativeIfcEntity => member !== undefined);
  // Gruppen sind IMMER Directory-Knoten (trailing slash), auch ohne
  // Mitglieder: wechselt derselbe Pfad zwischen Directory und Blatt (letztes
  // Mitglied entfernt), wirft die Baum-Bibliothek beim Fokus-Restore
  // ("Unknown directory child index").
  const isDirectory = isGroup && !visitedGroupIds.has(entity.id);
  const canonicalPath = isDirectory ? `${basePath}/` : basePath;

  model.paths.push(canonicalPath);
  model.idByPath.set(basePath, entity.id);
  model.idByPath.set(canonicalPath, entity.id);
  if (!model.pathById.has(entity.id)) {
    model.pathById.set(entity.id, canonicalPath);
  }
  model.typeById.set(entity.id, entity.type);
  if (membership) {
    model.membershipByPath.set(basePath, membership);
    model.membershipByPath.set(canonicalPath, membership);
  }

  if (!isDirectory) {
    return;
  }
  model.expandedPaths.push(canonicalPath);
  const groupLabel = entity.name || `#${entity.id}`;
  const nextVisited = new Set(visitedGroupIds).add(entity.id);
  for (const member of members) {
    addEntityNode(
      member,
      basePath,
      { groupId: entity.id, groupLabel, memberId: member.id },
      document,
      membersByGroup,
      model,
      nextVisited,
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

function getAncestorDirectoryPaths(path: string) {
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalizedPath.split("/");
  return segments
    .slice(0, -1)
    .map((_, index) => `${segments.slice(0, index + 1).join("/")}/`);
}
