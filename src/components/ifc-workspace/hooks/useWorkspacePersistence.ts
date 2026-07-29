import { useEffect, useRef, useState } from "react";

import { registerEmergencySave } from "../../error-boundary";
import type { WorkspaceDocumentSession } from "../session/documentSession";
import { DEFAULT_WORKSPACE_ID, type WorkspaceDefinition } from "../constants";
import {
  loadNotes,
  loadPortalSettings,
  loadPortalTokens,
  loadRecentIfcFiles,
  mergeRecentIfcFile,
  saveActiveWorkspaceId,
  saveCustomWorkspaces,
  saveNotes,
  savePortalSettings,
  savePortalTokens,
  saveRecentIfcFiles,
  type RecentIfcFileEntry,
} from "../workspaceStorage";

/**
 * localStorage-gestützter Zustand (zuletzt geöffnete Dateien, Notizen,
 * Portal-Einstellungen) inklusive Auto-Save-Effekten und Notfall-Sicherung
 * über die Error-Boundary.
 */
export function useWorkspacePersistence(options: {
  activeWorkspaceId: string;
  customWorkspaces: WorkspaceDefinition[];
}) {
  const [recentIfcFiles, setRecentIfcFiles] = useState(loadRecentIfcFiles);
  const [notes, setNotes] = useState(loadNotes);
  const [portalSettings, setPortalSettings] = useState(loadPortalSettings);
  const [portalTokens, setPortalTokens] = useState(loadPortalTokens);

  useEffect(() => {
    saveRecentIfcFiles(recentIfcFiles);
  }, [recentIfcFiles]);

  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  useEffect(() => {
    savePortalSettings(portalSettings);
  }, [portalSettings]);

  useEffect(() => {
    savePortalTokens(portalTokens);
  }, [portalTokens]);

  const emergencyStateRef = useRef({
    activeWorkspaceId: options.activeWorkspaceId,
    customWorkspaces: options.customWorkspaces,
    notes,
    recentIfcFiles,
  });
  emergencyStateRef.current = {
    activeWorkspaceId: options.activeWorkspaceId,
    customWorkspaces: options.customWorkspaces,
    notes,
    recentIfcFiles,
  };
  useEffect(
    () =>
      registerEmergencySave(() => {
        const snapshot = emergencyStateRef.current;
        saveNotes(snapshot.notes);
        saveRecentIfcFiles(snapshot.recentIfcFiles);
        saveCustomWorkspaces(snapshot.customWorkspaces);
        saveActiveWorkspaceId(
          snapshot.activeWorkspaceId || DEFAULT_WORKSPACE_ID,
        );
      }),
    [],
  );

  const rememberRecentIfc = (
    session: WorkspaceDocumentSession,
    source: RecentIfcFileEntry["source"],
    file?: File | null,
  ) => {
    const filePath =
      file &&
      "path" in file &&
      typeof (file as File & { path?: unknown }).path === "string"
        ? (file as File & { path?: string }).path
        : undefined;
    const entry: RecentIfcFileEntry = {
      documentId: session.id,
      entityCount: session.document.entities.length,
      id: `${filePath || session.document.fileName}:${Date.now().toString(36)}`,
      name: session.document.fileName,
      openedAt: new Date().toISOString(),
      path: filePath,
      schema: session.document.schema,
      size: file?.size ?? session.sourceIfcBytes?.byteLength,
      source,
    };
    setRecentIfcFiles((current) => mergeRecentIfcFile(current, entry));
  };

  return {
    notes,
    portalSettings,
    portalTokens,
    recentIfcFiles,
    rememberRecentIfc,
    setNotes,
    setPortalSettings,
    setPortalTokens,
    setRecentIfcFiles,
  };
}
