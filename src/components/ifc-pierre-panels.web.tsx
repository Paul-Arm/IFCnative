import { FileTree, useFileTree } from "@pierre/trees/react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import type { IfcTreeNode } from "@/ifc";

interface StructureTreeModel {
  paths: string[];
  expandedPaths: string[];
  expressByPath: Map<string, number>;
  pathByExpress: Map<number, string>;
  typeByPath: Map<string, string>;
}

interface IfcPierreTreeProps {
  roots: IfcTreeNode[];
  selectedExpressID?: number;
  onSelect(expressID: number): void;
}

export function IfcPierreTree({
  roots,
  selectedExpressID,
  onSelect,
}: IfcPierreTreeProps) {
  const treeModel = useMemo(() => buildStructureTreeModel(roots), [roots]);
  const expressByPathRef = useRef(treeModel.expressByPath);
  const typeByPathRef = useRef(treeModel.typeByPath);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "expand-matches",
    flattenEmptyDirectories: false,
    id: "ifcnative-spatial-tree",
    initialExpansion: "open",
    initialVisibleRowCount: 18,
    itemHeight: 30,
    onSelectionChange: (paths) => {
      const expressID = expressByPathRef.current.get(
        normalizeSelectedTreePath(paths[0]),
      );
      if (typeof expressID === "number") {
        onSelectRef.current(expressID);
      }
    },
    paths: treeModel.paths.length ? treeModel.paths : ["No model loaded"],
    renderRowDecoration: ({ item }) => {
      const typeName = typeByPathRef.current.get(
        normalizeSelectedTreePath(item.path),
      );
      return typeName ? { text: typeName.replace(/^Ifc/i, "") } : null;
    },
    search: true,
    stickyFolders: true,
    unsafeCSS: `
      :host {
        --trees-bg-override: #ffffff;
        --trees-fg-override: #17202a;
        --trees-border-color-override: #d7dde2;
        --trees-selected-bg-override: #dff4ef;
        --trees-selected-fg-override: #0f3f3a;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      button[data-type='item'] {
        border-radius: 6px;
      }
    `,
  });

  useEffect(() => {
    expressByPathRef.current = treeModel.expressByPath;
    typeByPathRef.current = treeModel.typeByPath;
    model.resetPaths(
      treeModel.paths.length ? treeModel.paths : ["No model loaded"],
      {
        initialExpandedPaths: treeModel.expandedPaths,
      },
    );
  }, [model, treeModel]);

  useEffect(() => {
    if (selectedExpressID == null) {
      return;
    }
    const selectedPath = treeModel.pathByExpress.get(selectedExpressID);
    if (!selectedPath) {
      return;
    }
    model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
    const item = model.getItem(selectedPath);
    item?.select();
    item?.focus();
  }, [model, selectedExpressID, treeModel]);

  const selectTreePath = useCallback(
    (rawPath?: string | null) => {
      const path = normalizeSelectedTreePath(rawPath);
      const expressID = expressByPathRef.current.get(path);
      if (typeof expressID !== "number") {
        return;
      }
      model
        .getSelectedPaths()
        .forEach((selectedPath) => model.getItem(selectedPath)?.deselect());
      const item = model.getItem(path);
      item?.select();
      item?.focus();
      onSelectRef.current(expressID);
    },
    [model],
  );

  const handleTreeActivation = (event: React.SyntheticEvent<HTMLElement>) => {
    selectTreePath(readTreePathFromEvent(event.nativeEvent));
  };

  useEffect(() => {
    let cleanup = () => {};
    let retryTimer: number | undefined;

    const handleNativeTreeClick = (event: Event) => {
      const path = readTreePathFromEvent(event);
      if (!path) {
        return;
      }
      selectTreePath(path);
      if (!isTreeChevronClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    };

    const connect = () => {
      const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
      if (!shadowRoot) {
        retryTimer = window.setTimeout(connect, 50);
        return;
      }
      shadowRoot.addEventListener("click", handleNativeTreeClick, true);
      cleanup = () =>
        shadowRoot.removeEventListener("click", handleNativeTreeClick, true);
    };

    connect();

    return () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      cleanup();
    };
  }, [model, selectTreePath]);

  return (
    <FileTree
      className="ifc-pierre-tree"
      header={<span>Spatial / Containment Index</span>}
      model={model}
      onClickCapture={handleTreeActivation}
      onPointerDownCapture={handleTreeActivation}
    />
  );
}

function buildStructureTreeModel(roots: IfcTreeNode[]): StructureTreeModel {
  const model: StructureTreeModel = {
    expandedPaths: [],
    expressByPath: new Map(),
    pathByExpress: new Map(),
    paths: [],
    typeByPath: new Map(),
  };

  roots.forEach((root) => addTreeNode(root, "", model));
  return model;
}

function addTreeNode(
  node: IfcTreeNode,
  parentPath: string,
  model: StructureTreeModel,
) {
  const segment = formatTreeSegment(node);
  const path = parentPath ? `${parentPath}/${segment}` : segment;
  const canonicalPath = node.children.length ? `${path}/` : path;

  model.paths.push(canonicalPath);
  model.expressByPath.set(path, node.expressID);
  model.expressByPath.set(canonicalPath, node.expressID);
  model.pathByExpress.set(node.expressID, canonicalPath);
  model.typeByPath.set(path, node.typeName);
  model.typeByPath.set(canonicalPath, node.typeName);

  if (node.children.length) {
    model.expandedPaths.push(canonicalPath);
    node.children.forEach((child) => addTreeNode(child, path, model));
  }
}

function formatTreeSegment(node: IfcTreeNode) {
  const label = sanitizeTreeSegment(node.label || node.typeName);
  return `${label} #${node.expressID}`;
}

function sanitizeTreeSegment(value: string) {
  return (
    value.replace(/[\\/]/g, "-").replace(/\s+/g, " ").trim().slice(0, 96) ||
    "IFC Entity"
  );
}

function normalizeSelectedTreePath(path?: string | null) {
  if (!path) {
    return "";
  }
  return path.endsWith("/") ? path : path;
}

function readTreePathFromEvent(event: Event) {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) {
      continue;
    }
    const stickyPath = target.dataset.fileTreeStickyPath;
    if (stickyPath) {
      return stickyPath;
    }
    const itemPath = target.dataset.itemPath;
    if (itemPath) {
      return itemPath;
    }
  }
  return undefined;
}

function isTreeChevronClick(event: Event) {
  return event.composedPath().some((target) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return target.dataset.itemSection === "icon";
  });
}
