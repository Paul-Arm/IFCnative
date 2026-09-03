import { FileTree, useFileTree } from "@pierre/trees/react";
import { Boxes, Crosshair, Network, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import {
    listNativeFreeRootedObjects,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type NativeIfcTreeNode,
} from "@/ifc";
import { cn } from "@/lib/utils";

import {
    structureChildGroupsForParent,
    structureFreeObjectGroups,
    type StructureChildGroup,
} from "./constants";
import { IFC_TREE_SPRITE_SHEET, ifcTreeIconFor } from "./structureTreeIcons";
import { Button, shortType } from "./ui";

interface StructureTreeModel {
  paths: string[];
  expandedPaths: string[];
  idByPath: Map<string, number>;
  pathById: Map<number, string>;
  typeById: Map<number, string>;
  nameById: Map<number, string>;
  /** Rooted-Objekte ohne räumliche Zuordnung (Gruppe "Freie Objekte"). */
  freeObjectCount: number;
}

/** Platzhalter-Zeile, wenn keine räumliche Struktur indiziert ist. */
const EMPTY_TREE_PLACEHOLDER = "(Keine Raumstruktur indiziert)";

/**
 * Virtueller Ordner für Rooted-Objekte ohne räumliche Zuordnung. Nach
 * IFC-Schema ist die Zuordnung optional — solche Objekte müssen ohne
 * Struktur-Zwang sichtbar und bearbeitbar bleiben.
 */
const FREE_OBJECTS_FOLDER = "Freie Objekte";

/** Maximale Zeilenzahl der Fallback-Suchliste. */
const FALLBACK_ROW_LIMIT = 250;

/** Anzahl Render-Frames für das Reveal in großen, virtualisierten Bäumen. */
const TREE_REVEAL_MAX_FRAMES = 30;

export function StructurePanel({
  document,
  filteredEntities,
  revealSelectionNonce,
  search,
  selectedId,
  selectedIds,
  onAddChild,
  onAddFree,
  onCenterCamera,
  onCreateStructure,
  onManageGroups,
  onRemove,
  onSelect,
  onSelectMany,
}: {
  document: NativeIfcDocument;
  filteredEntities: NativeIfcEntity[];
  revealSelectionNonce: number;
  search: string;
  selectedId: number;
  /** Vollständige (Mehrfach-)Auswahl des Workspaces, enthält selectedId. */
  selectedIds: number[];
  onAddChild(parentId: number, type: string, name: string): void;
  /** Legt ein freies Objekt ohne Parent-Beziehung an (Ordner "Freie Objekte"). */
  onAddFree?(type: string, name: string): void;
  onCenterCamera(id: number): void;
  /** Öffnet die Eingabemaske "Raumstruktur anlegen" (leere Dokumente). */
  onCreateStructure?(): void;
  onManageGroups(id: number): void;
  onRemove(id: number): void;
  onSelect(id: number, source?: string): void;
  onSelectMany(ids: number[]): void;
}) {
  const treeModel = useMemo(
    () => buildStructureTreeModel(document),
    [document],
  );

  const idByPathRef = useRef(treeModel.idByPath);
  const typeByIdRef = useRef(treeModel.typeById);
  const onAddChildRef = useRef(onAddChild);
  const onAddFreeRef = useRef(onAddFree);
  const onCenterCameraRef = useRef(onCenterCamera);
  const onManageGroupsRef = useRef(onManageGroups);
  const onSelectRef = useRef(onSelect);
  const onSelectManyRef = useRef(onSelectMany);
  const onRemoveRef = useRef(onRemove);
  /** Unterdrückt Selektions-Echos, während der Reveal-Effekt selbst synct. */
  const selectionSyncActiveRef = useRef(false);
  /** Letztes Reveal-Ziel — Fokus/Scroll nur bei echter Zieländerung. */
  const lastRevealRef = useRef<{ nonce: number; selectedId: number } | null>(
    null,
  );
  onAddChildRef.current = onAddChild;
  onAddFreeRef.current = onAddFree;
  onCenterCameraRef.current = onCenterCamera;
  onManageGroupsRef.current = onManageGroups;
  onSelectRef.current = onSelect;
  onSelectManyRef.current = onSelectMany;
  onRemoveRef.current = onRemove;

  const initialPaths = treeModel.paths.length
    ? treeModel.paths
    : [EMPTY_TREE_PLACEHOLDER];

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "expand-matches",
    flattenEmptyDirectories: false,
    id: "ifcnative-structure-tree",
    initialExpandedPaths: treeModel.expandedPaths,
    initialVisibleRowCount: 18,
    // Zwei Zeilen pro Eintrag (Name + Typ) brauchen mehr Höhe als das
    // Compact-Preset; die Virtualisierung rechnet mit diesem Wert.
    itemHeight: 38,
    onSelectionChange: (paths) => {
      // Echos des programmatischen Reveal-Syncs ignorieren: sie tragen keine
      // neue Information und würden Auswahl-Objekte ohne Baum-Pfad (Gruppen/
      // Systeme außerhalb der Raumstruktur) still aus der Workspace-Auswahl
      // entfernen.
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
    paths: initialPaths,
    icons: {
      // Blätter zeigen statt des generischen Datei-Icons einen dezenten
      // Punkt — das Typ-Symbol sitzt in der zweiten Zeile (Decoration).
      remap: { "file-tree-icon-file": "file-tree-icon-dot" },
      spriteSheet: IFC_TREE_SPRITE_SHEET,
    },
    renderRowDecoration: ({ item }) => {
      const id = idByPathRef.current.get(item.path);
      if (typeof id !== "number") return null;
      const typeName = typeByIdRef.current.get(id);
      if (!typeName) return null;
      // Icon-Decoration; der title liefert Tooltip UND die sichtbare
      // Typ-Zeile (per attr()-Content im unsafeCSS unten).
      return {
        icon: {
          name: ifcTreeIconFor(typeName),
          width: 11,
          height: 11,
          viewBox: "0 0 16 16",
        },
        title: `${typeName.replace(/^IFC/i, "")} · #${id}`,
      };
    },
    // Kein baum-eigenes Suchfeld: die Panel-Suche filtert über
    // model.setSearch, das unabhängig vom eingebauten Such-UI arbeitet.
    search: false,
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "both",
        buttonVisibility: "when-needed",
      },
    },
    unsafeCSS: `
      /* Der Baum rendert in einem Shadow DOM und erbt daher keine
         Tailwind-Styles. CSS-Custom-Properties erben jedoch über die
         Shadow-Grenze: hier die Design-Tokens der App auf die
         --trees-theme-*-Variablen der Bibliothek mappen, damit der Baum
         auch im Dark Mode lesbar bleibt. */
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
        /* Rand- und Zeilen-Abstände eindampfen: die Bibliothek reserviert
           links/rechts je 16px Container-Padding plus Zeilen-Margins. */
        --trees-padding-inline-override: 2px;
        --trees-item-margin-x-override: 0px;
        --trees-item-padding-x-override: 6px;
        --trees-item-row-gap-override: 5px;
      }
      /* Zweizeilige Einträge: Name oben, Typ-Icon + IFC-Typ · #ID darunter.
         Die Zeile ist im Original ein Flex-Row mit line-height = Zeilenhöhe;
         hier als Grid mit fester Spaltenstruktur und zwei Inhaltszeilen.
         Die Zeilen sind 1fr/1fr, damit Spalten wie die Einrückungslinien
         (spacing) die volle Zeilenhöhe füllen — sonst reißen die Linien
         zwischen den Einträgen ab. */
      [data-type='item'] {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr) auto;
        grid-template-rows: 1fr 1fr;
        grid-template-areas:
          'spacing icon content action'
          'spacing icon decoration action';
        align-items: stretch;
        column-gap: var(--trees-item-row-gap);
        row-gap: 0;
        line-height: 1.25;
      }
      [data-type='item'] > [data-item-section='spacing'] {
        grid-area: spacing;
        height: 100%;
      }
      [data-type='item'] > [data-item-section='icon'] {
        grid-area: icon;
        align-self: center;
      }
      /* Blatt-Zeilen: der auf den Dot umgemappte Datei-Slot rendert das
         Symbol in voller 16px-Größe — auf einen dezenten Bullet schrumpfen. */
      [data-item-type='file'] > [data-item-section='icon'] svg {
        width: 5px;
        height: 5px;
        opacity: 0.55;
      }
      [data-type='item'] > [data-item-section='content'] {
        grid-area: content;
        align-self: end;
      }
      [data-type='item'] > [data-item-section='decoration'] {
        grid-area: decoration;
        align-self: start;
        justify-content: flex-start;
        text-align: start;
        font-size: 10.5px;
        letter-spacing: 0.01em;
      }
      [data-type='item'] > [data-item-section='decoration'] > span {
        justify-content: flex-start;
        gap: 4px;
      }
      [data-type='item'] > [data-item-section='decoration'] > span > svg {
        flex-shrink: 0;
      }
      /* Sichtbarer Typ-Text aus dem title-Attribut der Icon-Decoration. */
      [data-type='item'] > [data-item-section='decoration'] > span[title]::after {
        content: attr(title);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      [data-type='item'] > [data-item-section='git'],
      [data-type='item'] > [data-item-section='action'] {
        grid-area: action;
        align-self: center;
      }
    `,
  });

  useEffect(() => {
    idByPathRef.current = treeModel.idByPath;
    typeByIdRef.current = treeModel.typeById;
    model.resetPaths(
      treeModel.paths.length ? treeModel.paths : [EMPTY_TREE_PLACEHOLDER],
      { initialExpandedPaths: treeModel.expandedPaths },
    );
  }, [model, treeModel]);

  useEffect(() => {
    const trimmed = (search ?? "").trim();
    // Die ID steht nicht mehr zwingend im Zeilennamen (nur noch in der
    // Decoration-Zeile). Die Baum-Suche matcht aber über den vollständigen
    // Pfad — reine ID-Eingaben ("533" / "#533") deshalb auf den Pfad des
    // Treffers übersetzen, damit die versprochene ID-Suche weiter greift.
    const idMatch = /^#?(\d+)$/.exec(trimmed);
    const idPath = idMatch
      ? treeModel.pathById.get(Number(idMatch[1]))
      : undefined;
    model.setSearch(idPath ?? trimmed);
  }, [model, search, treeModel]);

  useEffect(() => {
    if (selectedId == null) return;
    const path = treeModel.pathById.get(selectedId);
    if (!path) return;

    getAncestorDirectoryPaths(path).forEach((ancestorPath) => {
      const ancestor = model.getItem(ancestorPath);
      if (
        ancestor &&
        "isExpanded" in ancestor &&
        !ancestor.isExpanded()
      ) {
        ancestor.expand();
      }
    });

    const item = model.getItem(path);
    if (!item) return;
    // Baum-Selektion mit der kompletten Workspace-Auswahl abgleichen — nicht
    // nur mit selectedId: sonst reduziert der Reveal nach jedem Viewer-Klick
    // die Baum-Selektion auf eine Zeile, deren onSelectionChange die
    // Mehrfachauswahl (z. B. Strg-Klick im 3D-Viewer) wieder auflöst. Die
    // dabei ausgelösten onSelectionChange-Echos werden per Flag unterdrückt.
    const targetPaths = new Set(
      (selectedIds.length ? selectedIds : [selectedId]).flatMap((id) => {
        const idPath = treeModel.pathById.get(id);
        return idPath ? [idPath] : [];
      }),
    );
    targetPaths.add(path);
    selectionSyncActiveRef.current = true;
    try {
      const currentPaths = model.getSelectedPaths();
      for (const targetPath of targetPaths) {
        if (!currentPaths.includes(targetPath)) {
          model.getItem(targetPath)?.select();
        }
      }
      for (const currentPath of currentPaths) {
        if (!targetPaths.has(currentPath)) {
          model.getItem(currentPath)?.deselect();
        }
      }
    } finally {
      selectionSyncActiveRef.current = false;
    }
    // Fokus und Scroll nur, wenn sich das Reveal-Ziel wirklich geändert hat —
    // sonst springt der Viewport bei jeder additiven Auswahl-Erweiterung
    // zurück zur (unveränderten) Primärzeile.
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
      const scrollElement = shadowRoot?.querySelector<HTMLElement>(
        "[data-file-tree-virtualized-scroll]",
      );
      const focusedIndex = treeModel.paths
        .filter((candidatePath) =>
          getAncestorDirectoryPaths(candidatePath).every((ancestorPath) => {
            const ancestor = model.getItem(ancestorPath);
            return (
              ancestor &&
              "isExpanded" in ancestor &&
              ancestor.isExpanded()
            );
          }),
        )
        .indexOf(path);
      if (!shadowRoot || !scrollElement || focusedIndex < 0) {
        if (revealFrame < TREE_REVEAL_MAX_FRAMES) {
          animationFrame = window.requestAnimationFrame(revealSelectedItem);
        }
        return;
      }

      const itemHeight = model.getItemHeight();
      const itemTop = focusedIndex * itemHeight;
      const stickyOverlayHeight =
        shadowRoot
          ?.querySelector<HTMLElement>("[data-file-tree-sticky-overlay]")
          ?.getBoundingClientRect().height ?? 0;
      const usableHeight = Math.max(
        itemHeight,
        scrollElement.clientHeight - stickyOverlayHeight,
      );
      scrollElement.scrollTop = Math.max(
        0,
        itemTop +
          itemHeight / 2 -
          stickyOverlayHeight -
          usableHeight / 2,
      );

      const renderedRow = Array.from(
        shadowRoot.querySelectorAll<HTMLElement>("[data-item-path]"),
      ).find(
        (row) =>
          row.dataset.itemPath === path && row.dataset.itemParked !== "true",
      );
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
      // Typeguard: nur Directory-Handles besitzen isExpanded/expand/collapse.
      if (!item || !("isExpanded" in item)) return;
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
      const menuItemClass =
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";

      const id = idByPathRef.current.get(item.path);
      if (typeof id !== "number") {
        // Virtueller Ordner "Freie Objekte": neues Objekt ohne
        // Parent-Beziehung anlegen (nach IFC-Schema zulässig).
        const onAddFree = onAddFreeRef.current;
        if (
          !onAddFree ||
          (item.path !== `${FREE_OBJECTS_FOLDER}/` &&
            item.path !== FREE_OBJECTS_FOLDER)
        ) {
          return null;
        }
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
              <AddOptionsSection
                groups={structureFreeObjectGroups()}
                heading="Neues freies Objekt anlegen"
                menuItemClass={menuItemClass}
                onPick={(type, name) => {
                  context.close({ restoreFocus: false });
                  onAddFree(type, name);
                }}
              />
            </div>
          </div>
        );
        return createPortal(menu, globalThis.document.body);
      }
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
          <div className="min-w-[200px] max-w-[280px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                context.close({ restoreFocus: false });
                onSelectRef.current(id, "tree");
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
            {!isProtected ? (
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
            ) : null}
            {childGroups.length ? (
              <>
                <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
                <AddOptionsSection
                  groups={childGroups}
                  heading="Neues Element anlegen"
                  menuItemClass={menuItemClass}
                  onPick={(type, name) => {
                    context.close({ restoreFocus: false });
                    onAddChildRef.current(id, type, name);
                  }}
                />
              </>
            ) : null}
            <div aria-hidden className="-mx-1 my-1 h-px bg-border" />
            {isProtected ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                IFCPROJECT kann nicht gelöscht werden.
              </div>
            ) : (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  context.close({ restoreFocus: false });
                  onRemoveRef.current(id);
                }}
              >
                <Trash2 aria-hidden className="size-3.5 shrink-0" />
                <span>Löschen</span>
              </button>
            )}
          </div>
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
    const visibleEntities = filteredEntities.slice(0, FALLBACK_ROW_LIMIT);
    const hiddenCount = filteredEntities.length - visibleEntities.length;
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
        {visibleEntities.map((entity) => (
          <FallbackRow
            entity={entity}
            key={entity.id}
            selected={entity.id === selectedId}
            onCenterCamera={onCenterCamera}
            onRemove={onRemove}
            onPress={() => onSelect(entity.id, "tree")}
          />
        ))}
        {hiddenCount > 0 ? (
          <div className="px-1.5 py-1.5 text-[11px] text-muted-foreground">
            … {hiddenCount.toLocaleString("de-DE")} weitere ausgeblendet
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {document.spatialRoots.length === 0 && onCreateStructure ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/70 bg-card/50 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Keine Raumstruktur — nach IFC-Schema zulässig.{" "}
            {treeModel.freeObjectCount
              ? `${treeModel.freeObjectCount === 1 ? "Das freie Objekt ist" : `Die ${treeModel.freeObjectCount} freien Objekte sind`} unten aufgeführt und normal bearbeitbar. `
              : ""}
            Optional lässt sich Projekt → Standort → Gebäude → Geschoss
            ergänzen.
          </p>
          <Button onClick={onCreateStructure}>
            <Network aria-hidden className="size-3.5" />
            Raumstruktur anlegen…
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileTree
          className="h-full w-full"
          model={model}
          renderContextMenu={renderContextMenu}
        />
      </div>
    </div>
  );
}

/** Gruppierte Typ-Optionen ("Neues … anlegen") für die Baum-Kontextmenüs. */
function AddOptionsSection({
  groups,
  heading,
  menuItemClass,
  onPick,
}: {
  groups: StructureChildGroup[];
  heading: string;
  menuItemClass: string;
  onPick(type: string, name: string): void;
}) {
  return (
    <>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {groups.map((group, groupIndex) => (
          <div key={group.label}>
            <div
              className={cn(
                "px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80",
                groupIndex > 0 && "mt-1 border-t border-border/50",
              )}
            >
              {group.label}
            </div>
            {group.options.map((option) => (
              <button
                key={`${group.label}-${option.value}`}
                type="button"
                className={menuItemClass}
                onClick={() => onPick(option.value, option.label)}
              >
                <Plus
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
                  {shortType(option.value)}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
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
      className={cn(
        "group flex h-7 items-center gap-1 rounded-sm px-1.5 transition-colors",
        selected ? "bg-primary/10" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        onClick={onPress}
        title={`#${entity.id} · ${entity.type}`}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {entity.name || `#${entity.id}`}
        </span>
        <span className="min-w-0 shrink truncate text-[10px] text-muted-foreground">
          #{entity.id} · {shortType(entity.type)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Kamera zentrieren ${entity.name || entity.type}`}
        title="Kamera zentrieren"
        onClick={() => onCenterCamera(entity.id)}
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Crosshair aria-hidden className="size-3.5" />
      </button>
      {entity.type !== "IFCPROJECT" ? (
        <button
          type="button"
          aria-label={`Löschen ${entity.name || entity.type}`}
          title="Löschen"
          onClick={() => onRemove(entity.id)}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
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
    freeObjectCount: 0,
    idByPath: new Map(),
    nameById: new Map(),
    pathById: new Map(),
    paths: [],
    typeById: new Map(),
  };
  const rootSegments = new Set<string>();
  document.spatialRoots.forEach((root) =>
    addTreeNode(root, "", document, model, rootSegments),
  );

  // Rooted-Objekte ohne räumliche Zuordnung unter einem virtuellen Ordner
  // aufführen — die Datei ist auch ohne Raumstruktur schema-valide und muss
  // ohne Umweg über "Raumstruktur anlegen" bearbeitbar sein. Der Ordner
  // selbst hat bewusst keinen idByPath-Eintrag (keine echte Entität).
  const freeObjects = listNativeFreeRootedObjects(document);
  model.freeObjectCount = freeObjects.length;
  if (freeObjects.length) {
    const folderPath = `${FREE_OBJECTS_FOLDER}/`;
    model.paths.push(folderPath);
    model.expandedPaths.push(folderPath);
    // Freie Objekte sind untereinander Geschwister im virtuellen Ordner und
    // brauchen daher ein eigenes Segment-Set für die Kollisionsprüfung.
    const freeSegments = new Set<string>();
    for (const entity of freeObjects) {
      const basePath = `${FREE_OBJECTS_FOLDER}/${treeSegment(entity, freeSegments)}`;
      model.paths.push(basePath);
      model.idByPath.set(basePath, entity.id);
      model.pathById.set(entity.id, basePath);
      model.typeById.set(entity.id, entity.type);
      model.nameById.set(entity.id, entity.name || `#${entity.id}`);
    }
  }
  return model;
}

function addTreeNode(
  node: NativeIfcTreeNode,
  parentPath: string,
  document: NativeIfcDocument,
  model: StructureTreeModel,
  usedSiblingSegments: Set<string>,
) {
  const entity = document.entityById.get(node.id);
  if (!entity) return;

  const segment = treeSegment(entity, usedSiblingSegments);
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
    const childSegments = new Set<string>();
    node.children.forEach((child) =>
      addTreeNode(child, basePath, document, model, childSegments),
    );
  }
}

/**
 * Pfad-Segment einer Entität, eindeutig unter ihren Geschwistern. "#id" hängt
 * nur bei Namenskollision am Segment — die ID steht sichtbar in der
 * Decoration-Zeile; der Pfad muss aber eindeutig bleiben (Selektion, Reveal
 * und ID-Suche laufen über Pfade). Das übergebene Set sammelt die bereits
 * vergebenen Segmente einer Geschwisterebene und wird dabei ergänzt.
 */
function treeSegment(entity: NativeIfcEntity, usedSiblingSegments: Set<string>) {
  const label = sanitizeSegment(entity.name || entity.type);
  const segment = usedSiblingSegments.has(label)
    ? `${label} #${entity.id}`
    : label;
  usedSiblingSegments.add(segment);
  return segment;
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
  return segments.slice(0, -1).map((_, index) =>
    `${segments.slice(0, index + 1).join("/")}/`,
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
