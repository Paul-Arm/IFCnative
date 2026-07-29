import { useEffect, useMemo, useState } from "react";
import type { MosaicNode } from "react-mosaic-component";

import {
  BUILT_IN_WORKSPACES,
  DEFAULT_MOSAIC_LAYOUT,
  DEFAULT_WORKSPACE_ID,
  MOSAIC_VIEW_IDS,
} from "../constants";
import { addMosaicView, getMosaicLeaves } from "../lib/mosaic";
import type { MosaicViewId } from "../types";
import {
  cloneMosaicNode,
  createCustomWorkspace,
  loadActiveWorkspaceId,
  loadCustomWorkspaces,
  resolveWorkspace,
  saveActiveWorkspaceId,
  saveCustomWorkspaces,
} from "../workspaceStorage";

/**
 * Workspaces (eingebaute + eigene Layouts), das aktuelle Mosaic-Layout und
 * abgedockte Fenster. Persistiert Auswahl und eigene Workspaces automatisch.
 */
export function useWorkspaceLayout(logAction: (code: string) => void) {
  const [workspaceBootState] = useState(() => {
    const customWorkspaces = loadCustomWorkspaces();
    const workspace = resolveWorkspace(
      loadActiveWorkspaceId(),
      customWorkspaces,
    );
    return {
      activeWorkspaceId: workspace.id,
      customWorkspaces,
      layout: cloneMosaicNode(workspace.layout) ?? DEFAULT_MOSAIC_LAYOUT,
    };
  });
  const [customWorkspaces, setCustomWorkspaces] = useState(
    workspaceBootState.customWorkspaces,
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    workspaceBootState.activeWorkspaceId,
  );
  const [mosaicValue, setMosaicValue] =
    useState<MosaicNode<MosaicViewId> | null>(workspaceBootState.layout);
  const [detachedViews, setDetachedViews] = useState<Set<MosaicViewId>>(
    () => new Set(),
  );

  const allWorkspaces = useMemo(
    () => [...BUILT_IN_WORKSPACES, ...customWorkspaces],
    [customWorkspaces],
  );
  const activeWorkspace =
    allWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    allWorkspaces[0];

  const closedMosaicIds = useMemo(() => {
    const visibleIds = new Set(getMosaicLeaves(mosaicValue));
    return MOSAIC_VIEW_IDS.filter((id) => !visibleIds.has(id));
  }, [mosaicValue]);

  useEffect(() => {
    saveCustomWorkspaces(customWorkspaces);
  }, [customWorkspaces]);

  useEffect(() => {
    saveActiveWorkspaceId(activeWorkspaceId || DEFAULT_WORKSPACE_ID);
  }, [activeWorkspaceId]);

  const selectWorkspace = (id: string) => {
    const workspace =
      allWorkspaces.find((candidate) => candidate.id === id) ??
      allWorkspaces[0];
    setActiveWorkspaceId(workspace.id);
    setMosaicValue(cloneMosaicNode(workspace.layout) ?? DEFAULT_MOSAIC_LAYOUT);
    logAction(`ui.workspace.select({ id: '${workspace.id}' });`);
  };

  const saveActiveWorkspace = () => {
    if (activeWorkspace?.builtIn) {
      return;
    }
    setCustomWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspaceId
          ? {
              ...workspace,
              layout: cloneMosaicNode(mosaicValue),
              updatedAt: new Date().toISOString(),
            }
          : workspace,
      ),
    );
    logAction(`ui.workspace.save({ id: '${activeWorkspaceId}' });`);
  };

  const createWorkspaceFromCurrentLayout = () => {
    const nextIndex = customWorkspaces.length + 1;
    const name = `Eigener Workspace ${nextIndex}`;
    const workspace = createCustomWorkspace(name, mosaicValue);
    setCustomWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceId(workspace.id);
    setMosaicValue(cloneMosaicNode(workspace.layout) ?? DEFAULT_MOSAIC_LAYOUT);
    logAction(`ui.workspace.create({ id: '${workspace.id}' });`);
  };

  const deleteActiveWorkspace = () => {
    if (activeWorkspace?.builtIn) {
      return;
    }
    const nextWorkspace = BUILT_IN_WORKSPACES[0];
    setCustomWorkspaces((current) =>
      current.filter((workspace) => workspace.id !== activeWorkspaceId),
    );
    setActiveWorkspaceId(nextWorkspace.id);
    setMosaicValue(
      cloneMosaicNode(nextWorkspace.layout) ?? DEFAULT_MOSAIC_LAYOUT,
    );
    logAction(`ui.workspace.delete({ id: '${activeWorkspaceId}' });`);
  };

  const restoreMosaicView = (id: MosaicViewId) => {
    setMosaicValue((current) => addMosaicView(current, id));
    logAction(`ui.restoreWindow({ view: '${id}' });`);
  };

  const resetMosaicLayout = () => {
    setMosaicValue(
      cloneMosaicNode(activeWorkspace?.layout) ?? DEFAULT_MOSAIC_LAYOUT,
    );
    logAction(`ui.resetLayout({ workspace: '${activeWorkspaceId}' });`);
  };

  const detachMosaicView = (id: MosaicViewId) => {
    if (id === "viewer") {
      logAction(
        `ui.detachWindow({ view: '${id}', ok: false, reason: 'viewer-stays-in-main' });`,
      );
      return;
    }
    if (typeof window === "undefined" || typeof window.open !== "function") {
      logAction(
        `ui.detachWindow({ view: '${id}', ok: false, reason: 'no-window-open' });`,
      );
      return;
    }
    setDetachedViews((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
    logAction(`ui.detachWindow({ view: '${id}', mode: 'portal', ok: true });`);
  };

  const reattachMosaicView = (id: MosaicViewId) => {
    setDetachedViews((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    logAction(`ui.detachWindow.close({ view: '${id}' });`);
  };

  const showMosaicViews = (ids: MosaicViewId[]) => {
    setMosaicValue((current) =>
      ids.reduce((node, id) => addMosaicView(node, id), current),
    );
  };

  return {
    activeWorkspace,
    activeWorkspaceId,
    allWorkspaces,
    closedMosaicIds,
    createWorkspaceFromCurrentLayout,
    customWorkspaces,
    deleteActiveWorkspace,
    detachMosaicView,
    detachedViews,
    mosaicValue,
    reattachMosaicView,
    resetMosaicLayout,
    restoreMosaicView,
    saveActiveWorkspace,
    selectWorkspace,
    setMosaicValue,
    showMosaicViews,
  };
}
