import { useState } from "react";

import {
  createNativeSampleDocument,
  parseNativeIfcFileInWorker,
  serializeNativeIfcDocument,
  summarizeNativeIfcGeometry,
  type NativeIfcDocument,
} from "@/ifc";

import { downloadBlob, pickIfcFile, pickIfcFiles } from "../lib/filePickers";
import {
  createWorkspaceDocumentSession,
  type WorkspaceDocumentSession,
} from "../session/documentSession";
import type { RecentIfcFileEntry } from "../workspaceStorage";

/**
 * Öffnen, Hinzufügen, Beispiel-Laden und Export von IFC-Dateien inklusive
 * Lade-Indikator. Das Parsen läuft im Worker; die Ergebnisse werden über
 * replaceDocument/appendSessions in die Dokument-Sessions übernommen.
 */
export function useIfcFileActions(options: {
  activeSession: WorkspaceDocumentSession;
  appendSessions: (sessions: WorkspaceDocumentSession[]) => void;
  logAction: (code: string) => void;
  rememberRecentIfc: (
    session: WorkspaceDocumentSession,
    source: RecentIfcFileEntry["source"],
    file?: File | null,
  ) => void;
  replaceDocument: (
    next: NativeIfcDocument,
    nextSelectedId?: number,
    log?: string,
    nextGraphPositions?: undefined,
    nextText?: string,
    nextBytes?: ArrayBuffer | null,
    nextFile?: File | null,
  ) => WorkspaceDocumentSession;
}) {
  const {
    activeSession,
    appendSessions,
    logAction,
    rememberRecentIfc,
    replaceDocument,
  } = options;
  const [loadingIfcName, setLoadingIfcName] = useState("");

  const openIfc = async () => {
    try {
      const asset = await pickIfcFile();
      if (!asset) {
        return;
      }
      setLoadingIfcName(asset.name);
      logAction(
        `ui.openIfc.start({ file: '${asset.name}', parser: 'worker' });`,
      );
      const parsed = await parseNativeIfcFileInWorker(asset.file, asset.name);
      const session = replaceDocument(
        parsed.document,
        undefined,
        `ui.openIfc({ file: '${asset.name}', parser: 'worker', ms: ${Math.round(parsed.elapsedMs)} });`,
        undefined,
        undefined,
        parsed.bytes,
        asset.file,
      );
      rememberRecentIfc(session, "opened", asset.file);
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setLoadingIfcName("");
    }
  };

  const addIfcFiles = async () => {
    try {
      const assets = await pickIfcFiles(true);
      if (!assets.length) {
        return;
      }
      setLoadingIfcName(
        assets.length === 1
          ? assets[0].name
          : `${assets.length.toLocaleString()} IFC files`,
      );
      logAction(`ui.addIfc.start({ files: ${assets.length} });`);
      const nextSessions: WorkspaceDocumentSession[] = [];
      for (const asset of assets) {
        const parsed = await parseNativeIfcFileInWorker(asset.file, asset.name);
        const session = createWorkspaceDocumentSession(parsed.document, {
          bytes: parsed.bytes,
          file: asset.file,
        });
        nextSessions.push(session);
        rememberRecentIfc(session, "added", asset.file);
        logAction(
          `ui.addIfc.file({ file: '${asset.name}', parser: 'worker', ms: ${Math.round(parsed.elapsedMs)} });`,
        );
      }
      appendSessions(nextSessions);
      logAction(`ui.addIfc({ files: ${nextSessions.length} });`);
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setLoadingIfcName("");
    }
  };

  const loadSample = () => {
    const session = replaceDocument(
      createNativeSampleDocument(),
      undefined,
      "ui.loadSample('IFCnative Builder Sample.ifc');",
    );
    rememberRecentIfc(session, "sample");
  };

  const exportIfc = async () => {
    const { document, documentText, documentTextDirty } = activeSession;
    const contents: BlobPart = documentTextDirty
      ? serializeNativeIfcDocument(document)
      : documentText ||
        activeSession.sourceIfcBytes ||
        serializeNativeIfcDocument(document);
    const fileName = document.fileName.replace(/\.ifc$/i, "") || "IFCnative";
    const blob = new Blob([contents], { type: "application/x-step" });
    const geometry = summarizeNativeIfcGeometry(document);
    downloadBlob(blob, `${fileName}.ifc`);
    logAction(
      `ui.exportIfc({ file: '${fileName}.ifc', bytes: ${blob.size}, representedProducts: ${geometry.representedProductCount}, shapeRepresentations: ${geometry.shapeRepresentationCount}, geometryItems: ${geometry.geometryItemCount} });`,
    );
  };

  return { addIfcFiles, exportIfc, loadSample, loadingIfcName, openIfc };
}
