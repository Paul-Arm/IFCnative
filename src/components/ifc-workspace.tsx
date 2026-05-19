import {
    startTransition,
    useEffect,
    useMemo,
    useState,
    type SetStateAction,
} from "react";
import {
    Mosaic,
    MosaicWindow,
    type MosaicNode,
    type MosaicPath,
} from "react-mosaic-component";
import {
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

import {
    addNativeBodyElement,
    addNativeClassification,
    addNativeDocumentReference,
    addNativeElement,
    addNativeEmptyPropertySet,
    addNativeMaterial,
    addNativePropertySet,
    addNativePropertyToSet,
    addNativeQuantitySet,
    addNativeRelationship,
    addNativeSiUnit,
    addNativeTypeAssignment,
    applyCatalogQuickFix,
    assignNativeBodyRepresentation,
    createNativeSampleDocument,
    findCatalogObject,
    getNativePlacement,
    getNextNativeEntityId,
    parseNativeIfcFileInWorker,
    removeNativeRelationship,
    resolveNativeMovableProductId,
    serializeNativeIfcDocument,
    splitTopLevel,
    suggestCatalogObjectForEntity,
    updateNativeEntity,
    updateNativePlacement,
    updateNativePropertyValue,
    updateNativeRelationship,
    validateEntityAgainstCatalogObject,
    viewerWorldDeltaToIfcPlacementDelta,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
    type NativeIfcDocument,
    type NativeIfcEntity,
} from "@/ifc";
import { type NativeGraphPreset } from "@/ifc/nativeGraph";

import { BuilderPanel } from "./ifc-workspace/BuilderPanel";
import { CatalogPanel } from "./ifc-workspace/CatalogPanel";
import {
    DEFAULT_MOSAIC_LAYOUT,
    ENTITY_TYPES,
    MOSAIC_TITLES,
    MOSAIC_VIEW_IDS,
    RELATION_TYPES,
} from "./ifc-workspace/constants";
import { GraphPanel } from "./ifc-workspace/GraphPanel";
import { InspectorPanel } from "./ifc-workspace/InspectorPanel";
import { ConsolePanel, DiagnosticsPanel } from "./ifc-workspace/ReviewPanels";
import { StructurePanel } from "./ifc-workspace/StructurePanel";
import { styles } from "./ifc-workspace/styles";
import type {
    BodyElementDraft,
    CoordinateClipboard,
    EntityEditDraft,
    InspectorMode,
    MosaicViewId,
    ParsedCoordinates,
    Point,
    StructureMode,
} from "./ifc-workspace/types";
import {
    Button,
    MosaicWindowMenu,
    SegmentedControl,
    typeOption,
} from "./ifc-workspace/ui";
import type { ViewerCoordinatePick } from "./that-open-viewer";
import ThatOpenViewer from "./that-open-viewer";

interface WorkspaceDocumentSession {
  id: string;
  document: NativeIfcDocument;
  documentText: string;
  documentTextDirty: boolean;
  graphAnchorId: number;
  graphCollapsed: Set<number>;
  graphExpanded: Set<number>;
  graphPinned: Set<number>;
  graphPositions: Map<number, Point>;
  selectedId: number;
  sourceIfcBytes: ArrayBuffer | null;
  sourceIfcFile: File | null;
  treeExpanded: Set<number>;
  viewerModelBytes: ArrayBuffer | null;
  viewerModelDeferredReason: string;
  viewerModelFile: File | null;
  viewerModelLoadRequested: boolean;
  viewerModelRevision: number;
  viewerModelText: string;
}

const AUTO_VIEWER_LOAD_LIMIT_BYTES = 80 * 1024 * 1024;

let nextWorkspaceDocumentId = 0;

function createWorkspaceDocumentSession(
  document: NativeIfcDocument,
  options?: {
    bytes?: ArrayBuffer | null;
    file?: File | null;
    graphPositions?: Map<number, Point>;
    id?: string;
    selectedId?: number;
    text?: string;
    viewerModelLoadRequested?: boolean;
    viewerModelRevision?: number;
  },
): WorkspaceDocumentSession {
  const sourceBytes = options?.bytes ?? null;
  const sourceFile = options?.file ?? null;
  const text =
    options?.text ?? (sourceBytes ? "" : serializeNativeIfcDocument(document));
  const viewerModelLoadRequested =
    options?.viewerModelLoadRequested ?? shouldAutoLoadViewer(sourceBytes);
  const viewerModelDeferredReason = viewerModelLoadRequested
    ? ""
    : `3D-Konvertierung fuer grosse IFC (${formatByteSize(sourceBytes?.byteLength ?? 0)}) pausiert.`;
  const fallbackId =
    document.spatialRoots[0]?.id ?? document.entities[0]?.id ?? 0;
  const selectedId = document.entityById.has(options?.selectedId ?? 0)
    ? (options?.selectedId as number)
    : fallbackId;
  return {
    document,
    documentText: text,
    documentTextDirty: false,
    graphAnchorId: selectedId,
    graphCollapsed: new Set(),
    graphExpanded: new Set(),
    graphPinned: new Set(),
    graphPositions: options?.graphPositions ?? new Map(),
    id: options?.id ?? createWorkspaceDocumentId(document.fileName),
    selectedId,
    sourceIfcBytes: sourceBytes,
    sourceIfcFile: sourceFile,
    treeExpanded: new Set(),
    viewerModelBytes: sourceBytes,
    viewerModelDeferredReason,
    viewerModelFile: sourceFile,
    viewerModelLoadRequested,
    viewerModelRevision: options?.viewerModelRevision ?? 0,
    viewerModelText: text,
  };
}

function shouldAutoLoadViewer(bytes: ArrayBuffer | null) {
  return !bytes || bytes.byteLength <= AUTO_VIEWER_LOAD_LIMIT_BYTES;
}

function formatByteSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

function createWorkspaceDocumentId(fileName: string) {
  nextWorkspaceDocumentId += 1;
  return `${fileName || "IFC"}:${Date.now().toString(36)}:${nextWorkspaceDocumentId}`;
}

function matchesEntitySearch(entity: NativeIfcEntity, query: string) {
  const id = String(entity.id);
  return [
    id,
    `#${id}`,
    entity.type,
    entity.name,
    entity.globalId,
    entity.description,
  ].some((value) => value.toLowerCase().includes(query));
}

function createInitialWorkspaceDocument() {
  const document = createNativeSampleDocument();
  return createWorkspaceDocumentSession(document);
}

function applyStateAction<T>(current: T, action: SetStateAction<T>) {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

export default function IfcWorkspace() {
  const [initialDocument] = useState(createInitialWorkspaceDocument);
  const [documentSessions, setDocumentSessions] = useState<
    WorkspaceDocumentSession[]
  >(() => [initialDocument]);
  const [activeDocumentId, setActiveDocumentId] = useState(initialDocument.id);
  const [structureMode, setStructureMode] = useState<StructureMode>("tree");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("info");
  const [mosaicValue, setMosaicValue] =
    useState<MosaicNode<MosaicViewId> | null>(DEFAULT_MOSAIC_LAYOUT);
  const [search, setSearch] = useState("");
  const [graphDepth, setGraphDepth] = useState(1);
  const [graphPreset, setGraphPreset] = useState<NativeGraphPreset>("all");
  const [graphRelationshipTypes, setGraphRelationshipTypes] = useState<
    Set<string>
  >(() => new Set());
  const [loadingIfcName, setLoadingIfcName] = useState("");
  const [catalog, setCatalog] = useState<IfcObjectCatalog | null>(null);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>(() => [
    `${new Date().toLocaleTimeString()}  ui.boot({ shell: 'vite-react' });`,
  ]);
  const [coordinateClipboard, setCoordinateClipboard] =
    useState<CoordinateClipboard | null>(null);
  const desktopApi =
    typeof window === "undefined" ? undefined : window.ifcNativeDesktop;

  const activeSession =
    documentSessions.find((session) => session.id === activeDocumentId) ??
    documentSessions[0];
  const document = activeSession.document;
  const selectedId = activeSession.selectedId;
  const graphAnchorId = activeSession.graphAnchorId;
  const treeExpanded = activeSession.treeExpanded;
  const graphPinned = activeSession.graphPinned;
  const graphExpanded = activeSession.graphExpanded;
  const graphCollapsed = activeSession.graphCollapsed;
  const graphPositions = activeSession.graphPositions;
  const documentText = activeSession.documentText;
  const documentTextDirty = activeSession.documentTextDirty;

  const updateActiveSession = (
    updater: (session: WorkspaceDocumentSession) => WorkspaceDocumentSession,
  ) => {
    setDocumentSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id ? updater(session) : session,
      ),
    );
  };

  const setSelectedId = (action: SetStateAction<number>) => {
    updateActiveSession((session) => ({
      ...session,
      selectedId: applyStateAction(session.selectedId, action),
    }));
  };

  const setGraphAnchorId = (action: SetStateAction<number>) => {
    updateActiveSession((session) => ({
      ...session,
      graphAnchorId: applyStateAction(session.graphAnchorId, action),
    }));
  };

  const setTreeExpanded = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      treeExpanded: applyStateAction(session.treeExpanded, action),
    }));
  };

  const setGraphPinned = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphPinned: applyStateAction(session.graphPinned, action),
    }));
  };

  const setGraphExpanded = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphExpanded: applyStateAction(session.graphExpanded, action),
    }));
  };

  const setGraphCollapsed = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphCollapsed: applyStateAction(session.graphCollapsed, action),
    }));
  };

  const setGraphPositions = (action: SetStateAction<Map<number, Point>>) => {
    updateActiveSession((session) => ({
      ...session,
      graphPositions: applyStateAction(session.graphPositions, action),
    }));
  };

  const viewerDocument = document;
  const selectedEntity =
    viewerDocument.entityById.get(selectedId) ??
    document.entityById.get(selectedId) ??
    document.entities[0];
  const suggestedCatalogObject = useMemo(
    () =>
      catalog
        ? suggestCatalogObjectForEntity(
            viewerDocument,
            selectedId,
            catalog.objectTypes,
          )
        : undefined,
    [catalog, selectedId, viewerDocument],
  );
  const activeCatalogObjectId =
    selectedCatalogObjectId ||
    suggestedCatalogObject?.id ||
    catalog?.objectTypes[0]?.id ||
    "";
  const activeCatalogObject =
    findCatalogObject(catalog, activeCatalogObjectId) ?? suggestedCatalogObject;
  const catalogFindings = useMemo(
    () =>
      activeCatalogObject
        ? validateEntityAgainstCatalogObject(
            viewerDocument,
            selectedId,
            activeCatalogObject,
          )
        : [],
    [activeCatalogObject, selectedId, viewerDocument],
  );
  const viewerModels = useMemo(
    () =>
      documentSessions.flatMap((session) =>
        session.viewerModelLoadRequested
          ? [
              {
                documentId: session.id,
                fileName: session.document.fileName,
                ifcBytes: session.viewerModelBytes,
                ifcFile: session.viewerModelFile,
                ifcText: session.viewerModelText,
                revision: session.viewerModelRevision,
                selectedId: session.selectedId,
                selectedName: session.document.entityById.get(
                  session.selectedId,
                )?.name,
              },
            ]
          : [],
      ),
    [documentSessions],
  );
  const closedMosaicIds = useMemo(() => {
    const visibleIds = new Set(getMosaicLeaves(mosaicValue));
    return MOSAIC_VIEW_IDS.filter((id) => !visibleIds.has(id));
  }, [mosaicValue]);

  const normalizedSearch = search.trim().toLowerCase();
  const searchMatchedEntities = useMemo(() => {
    if (!normalizedSearch) {
      return [];
    }
    return document.entities.filter((entity) =>
      matchesEntitySearch(entity, normalizedSearch),
    );
  }, [document.entities, normalizedSearch]);

  const filteredEntities = useMemo(() => {
    const query = normalizedSearch;
    if (!query) {
      return document.entities.slice(0, 120);
    }
    return searchMatchedEntities.slice(0, 160);
  }, [document.entities, normalizedSearch, searchMatchedEntities]);

  const logAction = (code: string) => {
    setConsoleLines((current) => [
      ...current.slice(-180),
      `${new Date().toLocaleTimeString()}  ${code}`,
    ]);
  };

  const restoreMosaicView = (id: MosaicViewId) => {
    setMosaicValue((current) => addMosaicView(current, id));
    logAction(`ui.restoreWindow({ view: '${id}' });`);
  };

  const resetMosaicLayout = () => {
    setMosaicValue(DEFAULT_MOSAIC_LAYOUT);
    logAction("ui.resetLayout();");
  };

  const replaceDocument = (
    next: NativeIfcDocument,
    nextSelectedId?: number,
    log?: string,
    nextGraphPositions?: Map<number, Point>,
    nextText?: string,
    nextBytes?: ArrayBuffer | null,
    nextFile?: File | null,
  ) => {
    const session = createWorkspaceDocumentSession(next, {
      bytes: nextBytes,
      file: nextFile,
      graphPositions: nextGraphPositions,
      selectedId: nextSelectedId,
      text: nextText,
    });
    startTransition(() => {
      setDocumentSessions([session]);
      setActiveDocumentId(session.id);
    });
    if (log) {
      logAction(log);
    }
  };

  const commitDocument = (
    next: NativeIfcDocument,
    nextSelectedId: number | undefined,
    _summary: string,
    log?: string,
    nextGraphPositions?: Map<number, Point>,
    options?: { reloadViewer?: boolean },
  ) => {
    const committedSessionId = activeSession.id;
    let resolvedSelectedId = selectedId;
    let nextText: string | undefined;
    if (options?.reloadViewer) {
      nextText = serializeNativeIfcDocument(next);
    }
    if (options?.reloadViewer) {
      resolvedSelectedId = next.entityById.has(nextSelectedId ?? 0)
        ? (nextSelectedId as number)
        : (next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? selectedId);
    } else {
      resolvedSelectedId = next.entityById.has(nextSelectedId ?? 0)
        ? (nextSelectedId as number)
        : (next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? selectedId);
    }
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== committedSessionId) {
          return session;
        }
        return {
          ...session,
          document: next,
          documentText: nextText ?? session.documentText,
          documentTextDirty: options?.reloadViewer ? false : true,
          graphPositions: nextGraphPositions ?? session.graphPositions,
          selectedId: resolvedSelectedId,
          sourceIfcBytes: options?.reloadViewer ? null : session.sourceIfcBytes,
          sourceIfcFile: options?.reloadViewer ? null : session.sourceIfcFile,
          viewerModelBytes: options?.reloadViewer
            ? null
            : session.viewerModelBytes,
          viewerModelDeferredReason: options?.reloadViewer
            ? session.viewerModelLoadRequested
              ? ""
              : session.viewerModelDeferredReason ||
                "3D-Konvertierung pausiert."
            : session.viewerModelDeferredReason,
          viewerModelFile: options?.reloadViewer
            ? null
            : session.viewerModelFile,
          viewerModelLoadRequested: session.viewerModelLoadRequested,
          viewerModelRevision: options?.reloadViewer
            ? session.viewerModelRevision + 1
            : session.viewerModelRevision,
          viewerModelText: nextText ?? session.viewerModelText,
        };
      }),
    );
    if (log) {
      logAction(log);
    }
  };

  const selectEntity = (
    id: number,
    source = "ui",
    globalId?: string,
    documentId = activeSession.id,
  ) => {
    if (documentId !== activeSession.id) {
      const inactiveSession = documentSessions.find(
        (session) => session.id === documentId,
      );
      logAction(
        `${source}.selectInactiveIfc({ file: '${inactiveSession?.document.fileName ?? documentId}', id: ${id} });`,
      );
      return;
    }
    const selectionDocument = activeSession.document;
    const resolvedId =
      source === "thatopen"
        ? (resolveNativeMovableProductId(selectionDocument, id, globalId) ??
          (selectionDocument.entityById.has(id)
            ? id
            : selectionDocument.entities.find(
                (entity) => entity.globalId === globalId,
              )?.id))
        : selectionDocument.entityById.has(id) || !globalId
          ? id
          : selectionDocument.entities.find(
              (entity) => entity.globalId === globalId,
            )?.id;
    if (!resolvedId || !selectionDocument.entityById.has(resolvedId)) {
      return;
    }
    setSelectedId(resolvedId);
    if (source === "graph") {
      setGraphAnchorId(resolvedId);
    }
    const entity = selectionDocument.entityById.get(resolvedId);
    logAction(
      `${source}.selectEntity({ id: ${resolvedId}, class: '${entity?.type ?? "UNKNOWN"}' });`,
    );
  };

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
      replaceDocument(
        parsed.document,
        undefined,
        `ui.openIfc({ file: '${asset.name}', parser: 'worker', ms: ${Math.round(parsed.elapsedMs)} });`,
        undefined,
        undefined,
        parsed.bytes,
        asset.file,
      );
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
        nextSessions.push(
          createWorkspaceDocumentSession(parsed.document, {
            bytes: parsed.bytes,
            file: asset.file,
          }),
        );
        logAction(
          `ui.addIfc.file({ file: '${asset.name}', parser: 'worker', ms: ${Math.round(parsed.elapsedMs)} });`,
        );
      }
      startTransition(() => {
        setDocumentSessions((current) => [...current, ...nextSessions]);
        setActiveDocumentId(nextSessions[0].id);
      });
      logAction(`ui.addIfc({ files: ${nextSessions.length} });`);
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setLoadingIfcName("");
    }
  };

  const importCatalog = async () => {
    try {
      const asset = await pickCatalogFile();
      if (!asset) {
        return;
      }
      setCatalogImporting(true);
      logAction(`ui.importCatalog.start({ file: '${asset.name}' });`);
      const { parseCatalogWorkbook } = await import("@/ifc/catalogExcel");
      const parsed = parseCatalogWorkbook(
        await asset.file.arrayBuffer(),
        asset.name,
      );
      const suggested = suggestCatalogObjectForEntity(
        viewerDocument,
        selectedId,
        parsed.objectTypes,
      );
      setCatalog(parsed);
      setSelectedCatalogObjectId(
        suggested?.id ?? parsed.objectTypes[0]?.id ?? "",
      );
      setMosaicValue((current) => addMosaicView(current, "catalog"));
      logAction(
        `ui.importCatalog({ file: '${asset.name}', classes: ${parsed.objectTypes.length} });`,
      );
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setCatalogImporting(false);
    }
  };

  const applyCatalogFinding = (finding: CatalogValidationFinding) => {
    const sourceDocument = document;
    const next = applyCatalogQuickFix(sourceDocument, selectedId, finding);
    if (next === sourceDocument) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Catalog quick fix: ${finding.quickFix?.label ?? finding.kind}`,
      `catalog.quickFix({ id: ${selectedId}, kind: '${finding.kind}' });`,
    );
  };

  const applyCatalogFindings = (findings: CatalogValidationFinding[]) => {
    const fixes = findings.filter((finding) => finding.quickFix);
    if (!fixes.length) {
      return;
    }
    const sourceDocument = document;
    const next = fixes.reduce(
      (currentDocument, finding) =>
        applyCatalogQuickFix(currentDocument, selectedId, finding),
      sourceDocument,
    );
    if (next === sourceDocument) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Apply ${fixes.length.toLocaleString()} catalog quick fixes to #${selectedId}`,
      `catalog.quickFixAll({ id: ${selectedId}, fixes: ${fixes.length} });`,
    );
  };

  const loadSample = () => {
    replaceDocument(
      createNativeSampleDocument(),
      undefined,
      "ui.loadSample('IFCnative Builder Sample.ifc');",
    );
  };

  const exportIfc = async () => {
    const contents: BlobPart = documentTextDirty
      ? serializeNativeIfcDocument(document)
      : documentText ||
        activeSession.sourceIfcBytes ||
        serializeNativeIfcDocument(document);
    const fileName = document.fileName.replace(/\.ifc$/i, "") || "IFCnative";
    const blob = new Blob([contents], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName}.ifc`;
    anchor.click();
    URL.revokeObjectURL(url);
    logAction(`ui.exportIfc({ file: '${fileName}.ifc' });`);
  };

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    return desktopApi.onCommand((command) => {
      switch (command.type) {
        case "add-ifc":
          if (!loadingIfcName) {
            void addIfcFiles();
          }
          break;
        case "open-ifc":
          if (!loadingIfcName) {
            void openIfc();
          }
          break;
        case "load-sample":
          loadSample();
          break;
        case "import-catalog":
          if (!catalogImporting) {
            void importCatalog();
          }
          break;
        case "export-ifc":
          if (!loadingIfcName) {
            void exportIfc();
          }
          break;
        case "reset-layout":
          resetMosaicLayout();
          break;
        case "restore-window":
          if (MOSAIC_VIEW_IDS.includes(command.viewId)) {
            restoreMosaicView(command.viewId);
          }
          break;
      }
    });
  });

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    desktopApi.setMenuState({
      catalogImporting,
      closedWindowIds: closedMosaicIds,
      hasCatalog: Boolean(catalog),
      loadingIfcName,
    });
  }, [catalog, catalogImporting, closedMosaicIds, desktopApi, loadingIfcName]);

  const saveSelectedEdit = (draft: EntityEditDraft) => {
    const next = updateNativeEntity(document, selectedId, {
      args: splitTopLevel(draft.rawArgs),
      description: draft.description,
      name: draft.name,
      type: draft.type,
    });
    commitDocument(
      next,
      selectedId,
      `Edit #${selectedId} ${draft.type}`,
      `saveEdit({ id: ${selectedId}, class: '${draft.type}' });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const addElement = (type: string, name: string, parentId?: number) => {
    const addedId = getNextNativeEntityId(document);
    const next = addNativeElement(document, parentId, type, name);
    const added = next.entityById.get(addedId);
    commitDocument(
      next,
      added?.id,
      `Add ${type} '${name}'${parentId ? ` under #${parentId}` : ""}`,
      `addElement({ class: '${type}', name: '${name}' });`,
    );
  };

  const addBodyElement = (options: BodyElementDraft) => {
    const addedId = getNextNativeEntityId(document);
    const next = addNativeBodyElement(document, options);
    const added = next.entityById.get(addedId);
    commitDocument(
      next,
      added?.id,
      `Add ${options.type} body '${options.name}'${options.parentId ? ` under #${options.parentId}` : ""}`,
      `addBodyElement({ class: '${options.type}', name: '${options.name}', profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const assignBodyToSelected = (options: BodyElementDraft) => {
    const next = assignNativeBodyRepresentation(document, selectedId, options);
    commitDocument(
      next,
      selectedId,
      `Assign ${options.profile ?? "rectangle"} body representation to #${selectedId}`,
      `assignBodyRepresentation({ id: ${selectedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const addRelationship = (
    type: string,
    sourceId: number,
    targetId: number,
  ) => {
    const next = addNativeRelationship(document, type, sourceId, targetId);
    commitDocument(
      next,
      targetId,
      `Add ${type} from #${sourceId} to #${targetId}`,
      `addRelationship({ class: '${type}', sourceId: ${sourceId}, targetId: ${targetId} });`,
    );
  };

  const addGraphConnectedNode = (
    sourceId: number,
    type: string,
    name: string,
    relationshipType: string,
    position: Point,
  ) => {
    const addedId = getNextNativeEntityId(document);
    const withElement = addNativeElement(document, undefined, type, name);
    const next = addNativeRelationship(
      withElement,
      relationshipType,
      sourceId,
      addedId,
    );
    const nextPositions = new Map(graphPositions);
    nextPositions.set(addedId, position);
    commitDocument(
      next,
      addedId,
      `Create ${type} '${name}' from graph and connect #${sourceId} -> #${addedId}`,
      `graph.addConnectedNode({ sourceId: ${sourceId}, class: '${type}', relationship: '${relationshipType}', targetId: ${addedId} });`,
      nextPositions,
    );
    setGraphPinned((current) => addToSet(addToSet(current, sourceId), addedId));
    setGraphExpanded((current) => addToSet(current, sourceId));
    setGraphCollapsed((current) => removeFromSet(current, sourceId));
  };

  const connectGraphNodes = (
    sourceId: number,
    targetId: number,
    relationshipType: string,
  ) => {
    const next = addNativeRelationship(
      document,
      relationshipType,
      sourceId,
      targetId,
    );
    commitDocument(
      next,
      targetId,
      `Connect graph nodes #${sourceId} -> #${targetId} with ${relationshipType}`,
      `graph.addRelationship({ class: '${relationshipType}', sourceId: ${sourceId}, targetId: ${targetId} });`,
      new Map(graphPositions),
    );
    setGraphPinned((current) =>
      addToSet(addToSet(current, sourceId), targetId),
    );
    setGraphExpanded((current) => addToSet(current, sourceId));
    setGraphCollapsed((current) => removeFromSet(current, sourceId));
  };

  const addPset = (
    psetName: string,
    propertyName: string,
    propertyValue: string,
    propertyValueType = "IFCLABEL",
  ) => {
    const next = addNativePropertySet(
      document,
      selectedId,
      psetName,
      propertyName,
      propertyValue,
      propertyValueType,
    );
    commitDocument(
      next,
      selectedId,
      `Add Pset '${psetName}' to #${selectedId}`,
      `addPset({ objectId: ${selectedId}, name: '${psetName}' });`,
    );
  };

  const addEmptyPset = (psetName: string) => {
    const next = addNativeEmptyPropertySet(document, selectedId, psetName);
    commitDocument(
      next,
      selectedId,
      `Add empty Pset '${psetName}' to #${selectedId}`,
      `addEmptyPset({ objectId: ${selectedId}, name: '${psetName}' });`,
    );
  };

  const addPropertyToSet = (
    setId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType = "IFCLABEL",
  ) => {
    const next = addNativePropertyToSet(
      document,
      setId,
      propertyName,
      propertyValue,
      propertyValueType,
    );
    commitDocument(
      next,
      selectedId,
      `Add property '${propertyName}' to #${setId}`,
      `addPropertyToSet({ setId: ${setId}, name: '${propertyName}', type: '${propertyValueType}' });`,
    );
  };

  const addQuantity = (
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType = "IFCQUANTITYLENGTH",
  ) => {
    const next = addNativeQuantitySet(
      document,
      selectedId,
      qtoName,
      quantityName,
      quantityValue,
      quantityType,
    );
    commitDocument(
      next,
      selectedId,
      `Add quantity '${quantityName}' to #${selectedId}`,
      `addQuantity({ objectId: ${selectedId}, name: '${quantityName}', type: '${quantityType}' });`,
    );
  };

  const addMaterial = (materialName: string, materialCategory: string) => {
    const next = addNativeMaterial(
      document,
      selectedId,
      materialName,
      materialCategory,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material '${materialName}' to #${selectedId}`,
      `addMaterial({ objectId: ${selectedId}, name: '${materialName}' });`,
    );
  };

  const addClassification = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeClassification(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign classification '${identification}' to #${selectedId}`,
      `addClassification({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const addDocumentReference = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeDocumentReference(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign document '${identification}' to #${selectedId}`,
      `addDocumentReference({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const assignType = (typeName: string, typeClass: string, tag: string) => {
    const next = addNativeTypeAssignment(
      document,
      selectedId,
      typeName,
      typeClass,
      tag,
    );
    commitDocument(
      next,
      selectedId,
      `Assign type '${typeName}' to #${selectedId}`,
      `assignType({ objectId: ${selectedId}, class: '${typeClass}', name: '${typeName}' });`,
    );
  };

  const updatePsetProperty = (
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ) => {
    const sourceDocument = document;
    const next = updateNativePropertyValue(sourceDocument, propertyId, {
      name: propertyName,
      value: propertyValue,
      valueType: propertyValueType,
    });
    commitDocument(
      next,
      selectedId,
      `Update property #${propertyId} '${propertyName}'`,
      `updateProperty({ id: ${propertyId}, name: '${propertyName}' });`,
    );
  };

  const editRelationship = (
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ) => {
    const next = updateNativeRelationship(document, relationshipId, {
      sourceId,
      targetId,
      type,
    });
    commitDocument(
      next,
      selectedId,
      `Update relationship #${relationshipId} ${type}`,
      `updateRelationship({ id: ${relationshipId}, class: '${type}' });`,
    );
  };

  const deleteRelationship = (relationshipId: number) => {
    const relationship = document.relationships.find(
      (item) => item.id === relationshipId,
    );
    const nextSelection = relationship?.sourceIds.includes(selectedId)
      ? relationship.targetIds[0]
      : relationship?.sourceIds[0];
    const next = removeNativeRelationship(document, relationshipId);
    commitDocument(
      next,
      nextSelection && next.entityById.has(nextSelection)
        ? nextSelection
        : selectedId,
      `Delete relationship #${relationshipId}${relationship ? ` ${relationship.type}` : ""}`,
      `deleteRelationship({ id: ${relationshipId} });`,
    );
  };

  const moveSelectedPlacement = (x: string, y: string, z: string) => {
    const sourceDocument = document;
    const next = updateNativePlacement(sourceDocument, selectedId, { x, y, z });
    commitDocument(
      next,
      selectedId,
      `Move #${selectedId} placement to (${x}, ${y}, ${z})`,
      `movePlacement({ id: ${selectedId}, x: ${JSON.stringify(x)}, y: ${JSON.stringify(y)}, z: ${JSON.stringify(z)} });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const nudgeSelectedPlacement = (delta: {
    x?: number;
    y?: number;
    z?: number;
  }) => {
    const sourceDocument = document;
    const moveTargetId = resolveNativeMovableProductId(
      sourceDocument,
      selectedId,
    );
    if (moveTargetId == null) {
      logAction(
        `movePlacement.nudgeSkipped({ id: ${selectedId}, reason: 'no-movable-placement' });`,
      );
      return;
    }
    const placement = getNativePlacement(sourceDocument, moveTargetId);
    if (!placement) {
      logAction(
        `movePlacement.nudgeSkipped({ id: ${selectedId}, reason: 'no-movable-placement' });`,
      );
      return;
    }
    const nativeDelta = viewerWorldDeltaToIfcPlacementDelta(delta);
    const x = formatCoordinate(placement.x + nativeDelta.x);
    const y = formatCoordinate(placement.y + nativeDelta.y);
    const z = formatCoordinate(placement.z + nativeDelta.z);
    const next = updateNativePlacement(sourceDocument, moveTargetId, {
      x,
      y,
      z,
    });
    commitDocument(
      next,
      moveTargetId,
      `Move #${moveTargetId} placement by viewer delta (${formatCoordinate(delta.x ?? 0)}, ${formatCoordinate(delta.y ?? 0)}, ${formatCoordinate(delta.z ?? 0)}) to IFC (${x}, ${y}, ${z})`,
      `movePlacement.viewerDelta({ id: ${moveTargetId}, selectedId: ${selectedId}, dx: ${delta.x ?? 0}, dy: ${delta.y ?? 0}, dz: ${delta.z ?? 0} });`,
      undefined,
      { reloadViewer: true },
    );
  };

  const storePickedCoordinates = (pick: ViewerCoordinatePick) => {
    const copiedAt = new Date().toLocaleTimeString();
    const nextClipboard = {
      copiedAt,
      documentId: pick.documentId,
      entityId: pick.entityId,
      fileName: pick.fileName,
      localId: pick.localId,
      modelId: pick.modelId,
      source: pick.source,
      x: formatCoordinate(pick.x),
      y: formatCoordinate(pick.y),
      z: formatCoordinate(pick.z),
    } satisfies CoordinateClipboard;
    setCoordinateClipboard(nextClipboard);
    logAction(
      `viewer.coordinates.clipboard({ file: '${pick.fileName ?? document.fileName}', x: ${nextClipboard.x}, y: ${nextClipboard.y}, z: ${nextClipboard.z}${pick.entityId ? `, entityId: ${pick.entityId}` : ""} });`,
    );
  };

  const loadSystemCoordinateClipboard = async () => {
    let text = "";
    try {
      text = (await globalThis.navigator?.clipboard?.readText?.()) ?? "";
    } catch (error) {
      logAction(
        `builder.coordinates.readClipboardError(${JSON.stringify(String(error))});`,
      );
      return undefined;
    }
    const parsed = parseCoordinateClipboardText(text ?? "");
    if (!parsed) {
      logAction("builder.coordinates.readClipboardFailed();");
      return undefined;
    }
    const nextClipboard = {
      copiedAt: new Date().toLocaleTimeString(),
      source: "system",
      ...parsed,
    } satisfies CoordinateClipboard;
    setCoordinateClipboard(nextClipboard);
    logAction(
      `builder.coordinates.readClipboard({ x: ${nextClipboard.x}, y: ${nextClipboard.y}, z: ${nextClipboard.z} });`,
    );
    return nextClipboard;
  };

  const addUnit = (unitType: string, unitName: string) => {
    const next = addNativeSiUnit(document, unitType, "$", unitName);
    commitDocument(
      next,
      selectedId,
      `Add unit ${unitType} ${unitName}`,
      `addUnit({ unitType: '${unitType}', name: '${unitName}' });`,
    );
  };

  const requestActiveViewerLoad = () => {
    const sessionId = activeSession.id;
    setDocumentSessions((current) =>
      current.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              viewerModelDeferredReason: "",
              viewerModelLoadRequested: true,
              viewerModelRevision: session.viewerModelRevision + 1,
            }
          : session,
      ),
    );
    logAction(
      `viewer.loadRequested({ file: '${activeSession.document.fileName}' });`,
    );
  };

  const renderStructure = () => (
    <View style={styles.tileContent}>
      <SegmentedControl
        options={["tree", "graph"]}
        value={structureMode}
        onChange={(value) => setStructureMode(value as StructureMode)}
      />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search ID, class, name, GlobalId"
        placeholderTextColor="#71717a"
        style={styles.input}
      />
      {structureMode === "tree" ? (
        <StructurePanel
          document={document}
          expanded={treeExpanded}
          filteredEntities={filteredEntities}
          search={search}
          selectedId={selectedId}
          onSelect={selectEntity}
          onToggle={(id) => {
            setTreeExpanded((current) =>
              current.has(id)
                ? removeFromSet(current, id)
                : addToSet(current, id),
            );
          }}
        />
      ) : (
        <GraphPanel
          anchorId={graphAnchorId}
          classOptions={ENTITY_TYPES.map(typeOption)}
          collapsed={graphCollapsed}
          depth={graphDepth}
          document={document}
          expanded={graphExpanded}
          pinned={graphPinned}
          positions={graphPositions}
          preset={graphPreset}
          relationshipOptions={RELATION_TYPES.map(typeOption)}
          relationshipTypeFilters={graphRelationshipTypes}
          search={search}
          searchMatches={searchMatchedEntities}
          selectedId={selectedId}
          onConnectNodes={connectGraphNodes}
          onCreateNodeFromConnection={addGraphConnectedNode}
          onDepth={setGraphDepth}
          onLog={logAction}
          onPreset={setGraphPreset}
          onPositions={setGraphPositions}
          onRelationshipTypeFilters={(filters) =>
            setGraphRelationshipTypes(new Set(filters))
          }
          onSelect={selectEntity}
          onToggleChildren={(id, loaded) => {
            if (loaded) {
              setGraphExpanded((current) => removeFromSet(current, id));
              setGraphCollapsed((current) => addToSet(current, id));
            } else {
              setGraphCollapsed((current) => removeFromSet(current, id));
              setGraphExpanded((current) => addToSet(current, id));
            }
            logAction(`graph.children({ id: ${id}, loaded: ${!loaded} });`);
          }}
          onTogglePin={(id, point) => {
            setGraphPinned((current) => {
              const pinning = !current.has(id);
              const next = current.has(id)
                ? removeFromSet(current, id)
                : addToSet(current, id);
              if (pinning && point) {
                setGraphPositions((currentPositions) => {
                  const nextPositions = new Map(currentPositions);
                  nextPositions.set(id, point);
                  return nextPositions;
                });
              }
              logAction(`graph.pin({ id: ${id}, pinned: ${next.has(id)} });`);
              return next;
            });
          }}
        />
      )}
    </View>
  );

  const renderInspector = () => (
    <View style={styles.tileContent}>
      <SegmentedControl
        options={[
          "info",
          "edit",
          "placement",
          "psets",
          "relations",
          "resources",
          "refs",
          "units",
        ]}
        value={inspectorMode}
        onChange={(value) => setInspectorMode(value as InspectorMode)}
      />
      <InspectorPanel
        activeCatalogObjectId={activeCatalogObjectId}
        catalog={catalog}
        catalogFindings={catalogFindings}
        document={viewerDocument}
        mode={inspectorMode}
        selectedId={selectedId}
        onAddClassification={addClassification}
        onAddDocumentReference={addDocumentReference}
        onAddMaterial={addMaterial}
        onAssignType={assignType}
        onAddEmptyPset={addEmptyPset}
        onAddPropertyToSet={addPropertyToSet}
        onAddQuantity={addQuantity}
        onAddUnit={addUnit}
        onApplyCatalogFindings={applyCatalogFindings}
        onAddRelationship={addRelationship}
        onRemoveRelationship={deleteRelationship}
        onSaveEdit={saveSelectedEdit}
        onMovePlacement={moveSelectedPlacement}
        onUpdateProperty={updatePsetProperty}
        onUpdateRelationship={editRelationship}
      />
    </View>
  );

  const renderTileContent = (id: MosaicViewId) => {
    switch (id) {
      case "structure":
        return renderStructure();
      case "viewer":
        return (
          <View style={styles.tileContent}>
            <ThatOpenViewer
              activeDocumentId={activeSession.id}
              activeModelDeferredReason={
                activeSession.viewerModelDeferredReason
              }
              activeModelFileName={activeSession.document.fileName}
              activeModelLoaded={activeSession.viewerModelLoadRequested}
              models={viewerModels}
              onLog={logAction}
              onLoadActiveModel={requestActiveViewerLoad}
              onMoveSelected={nudgeSelectedPlacement}
              onPickCoordinates={storePickedCoordinates}
              onSelect={selectEntity}
            />
          </View>
        );
      case "inspector":
        return renderInspector();
      case "builder":
        return (
          <View style={styles.tileContent}>
            <BuilderPanel
              coordinateClipboard={coordinateClipboard}
              document={document}
              selectedId={selectedId}
              onAddClassification={addClassification}
              onAddDocumentReference={addDocumentReference}
              onAssignType={assignType}
              onAddElement={addElement}
              onAddBodyElement={addBodyElement}
              onAssignBodyToSelected={assignBodyToSelected}
              onAddMaterial={addMaterial}
              onAddRelationship={addRelationship}
              onAddPset={addPset}
              onAddQuantity={addQuantity}
              onAddUnit={addUnit}
              onLoadSystemCoordinates={loadSystemCoordinateClipboard}
            />
          </View>
        );
      case "catalog":
        return (
          <View style={styles.tileContent}>
            <CatalogPanel
              catalog={catalog}
              document={viewerDocument}
              findings={catalogFindings}
              importing={catalogImporting}
              selectedCatalogObjectId={activeCatalogObjectId}
              selectedId={selectedId}
              onApplyFinding={applyCatalogFinding}
              onImportCatalog={importCatalog}
              onSelectCatalogObject={setSelectedCatalogObjectId}
            />
          </View>
        );
      case "console":
        return (
          <View style={styles.tileContent}>
            <ConsolePanel
              lines={consoleLines}
              onClear={() => setConsoleLines([])}
            />
          </View>
        );
      case "diagnostics":
        return (
          <View style={styles.tileContent}>
            <DiagnosticsPanel document={document} />
          </View>
        );
    }
  };

  const renderMosaicTile = (id: MosaicViewId, path: MosaicPath) => (
    <MosaicWindow<MosaicViewId>
      className="ifcnative-mosaic-window"
      draggable
      path={path}
      title={
        id === "inspector"
          ? selectedEntity?.name || MOSAIC_TITLES[id]
          : MOSAIC_TITLES[id]
      }
    >
      {renderTileContent(id)}
    </MosaicWindow>
  );

  const renderDocumentTabs = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.documentTabs}
      contentContainerStyle={styles.documentTabsContent}
    >
      {documentSessions.map((session) => {
        const active = session.id === activeSession.id;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={session.id}
            onPress={() => setActiveDocumentId(session.id)}
            style={({ pressed }) => [
              styles.documentTab,
              active && styles.documentTabActive,
              pressed && styles.documentTabPressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.documentTabTitle,
                active && styles.documentTabTitleActive,
              ]}
            >
              {session.document.fileName}
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.documentTabMeta,
                active && styles.documentTabMetaActive,
              ]}
            >
              {session.document.schema} ·{" "}
              {session.document.entities.length.toLocaleString()} entities
              {session.documentTextDirty ? " · unsaved" : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topbar}>
        <View style={styles.toolbarMain}>
          <View style={styles.toolbarBrand}>
            <Text style={styles.appTitle}>IFCnative</Text>
            <Text style={styles.appMeta}>
              {documentSessions.length.toLocaleString()} IFC
            </Text>
          </View>
          <View style={styles.activeDocumentControl}>
            <Text style={styles.fieldLabel}>Aktive IFC</Text>
            {renderDocumentTabs()}
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            disabled={Boolean(loadingIfcName)}
            label={loadingIfcName ? "Loading IFC..." : "Open IFC"}
            primary
            onPress={() => void openIfc()}
          />
          <Button
            disabled={Boolean(loadingIfcName)}
            label="Add IFC"
            onPress={() => void addIfcFiles()}
          />
          <Button label="Sample" onPress={loadSample} />
          <Button
            disabled={catalogImporting}
            label={catalog ? "Reload Catalog" : "Import Catalog"}
            onPress={() => void importCatalog()}
          />
          <Button
            disabled={Boolean(loadingIfcName)}
            label="Export IFC"
            onPress={() => void exportIfc()}
          />
          <Button label="Reset Layout" onPress={resetMosaicLayout} />
          <MosaicWindowMenu
            closedIds={closedMosaicIds}
            onRestore={restoreMosaicView}
          />
        </View>
      </View>

      <View style={styles.mosaicShell}>
        <Mosaic<MosaicViewId>
          className="ifcnative-mosaic"
          renderTile={renderMosaicTile}
          resize={{ minimumPaneSizePercentage: 12 }}
          value={mosaicValue}
          zeroStateView={
            <View style={styles.zeroState}>
              <Button
                label="Restore Layout"
                primary
                onPress={resetMosaicLayout}
              />
            </View>
          }
          onChange={setMosaicValue}
        />
      </View>
    </SafeAreaView>
  );
}

function pickIfcFile() {
  return pickIfcFiles(false).then((files) => files[0]);
}

function pickIfcFiles(multiple: boolean) {
  return new Promise<{ file: File; name: string }[]>((resolve, reject) => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept =
      ".ifc,application/x-step,text/plain,application/octet-stream";
    input.onchange = () => {
      const files = Array.from(input.files ?? []).map((file) => ({
        file,
        name: file.name,
      }));
      resolve(files);
    };
    input.onerror = () => reject(new Error("File picker failed."));
    input.click();
  });
}

function pickCatalogFile() {
  return new Promise<{ file: File; name: string } | undefined>(
    (resolve, reject) => {
      const input = globalThis.document.createElement("input");
      input.type = "file";
      input.accept =
        ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? { file, name: file.name } : undefined);
      };
      input.onerror = () => reject(new Error("File picker failed."));
      input.click();
    },
  );
}

function removeFromSet<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function addToSet<T>(current: Set<T>, value: T) {
  return new Set(current).add(value);
}

function getMosaicLeaves<T extends string | number>(
  node: MosaicNode<T> | null,
): T[] {
  if (node == null) {
    return [];
  }
  if (typeof node !== "object") {
    return [node];
  }
  return [...getMosaicLeaves(node.first), ...getMosaicLeaves(node.second)];
}

function addMosaicView<T extends string | number>(
  node: MosaicNode<T> | null,
  id: T,
): MosaicNode<T> {
  if (getMosaicLeaves(node).includes(id)) {
    return node ?? id;
  }
  if (node == null) {
    return id;
  }
  return {
    direction: "row",
    first: node,
    second: id,
    splitPercentage: 74,
  };
}

function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function parseCoordinateClipboardText(
  text: string,
): ParsedCoordinates | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const x = readClipboardCoordinate(data.x);
    const y = readClipboardCoordinate(data.y);
    const z = readClipboardCoordinate(data.z);
    if (x && y && z) {
      const parsed = toParsedCoordinates(x, y, z);
      const documentId = readClipboardString(data.documentId);
      const entityId = readClipboardNumber(data.entityId);
      const fileName = readClipboardString(data.fileName);
      const localId = readClipboardNumber(data.localId);
      const modelId = readClipboardString(data.modelId);
      return {
        ...parsed,
        ...(documentId ? { documentId } : {}),
        ...(entityId ? { entityId } : {}),
        ...(fileName ? { fileName } : {}),
        ...(localId ? { localId } : {}),
        ...(modelId ? { modelId } : {}),
        ...(data.source === "thatopen" ? { source: "thatopen" as const } : {}),
      };
    }
  } catch {
    // fall through to plain text parsing
  }

  const labeled = [
    ...trimmed.matchAll(/\b([xyz])\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/gi),
  ];
  if (labeled.length >= 3) {
    const coordinates = new Map(
      labeled.map((match) => [
        match[1].toLowerCase(),
        normalizeCoordinateText(match[2]),
      ]),
    );
    const x = coordinates.get("x");
    const y = coordinates.get("y");
    const z = coordinates.get("z");
    if (x && y && z) {
      return toParsedCoordinates(x, y, z);
    }
  }

  const numbers = trimmed
    .match(/-?\d+(?:[.,]\d+)?/g)
    ?.map(normalizeCoordinateText);
  if (numbers && numbers.length >= 3) {
    const [x, y, z] = numbers;
    if (x && y && z) {
      return toParsedCoordinates(x, y, z);
    }
  }
  return undefined;
}

function toParsedCoordinates(
  x: string,
  y: string,
  z: string,
): ParsedCoordinates {
  return { x, y, z };
}

function readClipboardCoordinate(value: unknown) {
  if (typeof value === "number") {
    return formatCoordinate(value);
  }
  if (typeof value === "string") {
    return normalizeCoordinateText(value);
  }
  return undefined;
}

function readClipboardString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readClipboardNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizeCoordinateText(value: string) {
  const normalized = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(normalized)) {
    return undefined;
  }
  return formatCoordinate(normalized);
}
