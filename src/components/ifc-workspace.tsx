import { Button as IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PanelTopOpen, Plus, Save, Trash2 } from "lucide-react";
import {
    cloneElement,
    isValidElement,
    startTransition,
    useEffect,
    useMemo,
    useRef,
    useState,
    type SetStateAction,
} from "react";
import {
    DEFAULT_CONTROLS_WITHOUT_CREATION,
    Mosaic,
    MosaicWindow,
    type MosaicNode,
    type MosaicPath,
} from "react-mosaic-component";

import {
    addNativeApproval,
    addNativeBodyElement,
    addNativeClassification,
    addNativeConstraintObjective,
    addNativeDocumentReference,
    addNativeElement,
    addNativeEmptyPropertySet,
    addNativeGroupAssignment,
    addNativeLibraryReference,
    addNativeMaterial,
    addNativeMaterialConstituentSet,
    addNativeMaterialLayerSet,
    addNativeMaterialLayerSetUsage,
    addNativeMaterialProfileSet,
    addNativeMaterialProfileSetUsage,
    addNativeMaterialStyle,
    addNativeMaterialWithProperties,
    addNativePropertySet,
    addNativePropertyToSet,
    addNativeQuantitySet,
    addNativeRelationship,
    addNativeSiUnit,
    addNativeTypeAssignment,
    applyCatalogQuickFix,
    assignNativeBodyRepresentation,
    buildObjectInfoIndex,
    createNativeSampleDocument,
    duplicateNativePropertySet,
    findCatalogObject,
    getNativePlacement,
    getNextNativeEntityId,
    parseNativeIfcFileInWorker,
    removeNativeEntity,
    removeNativePropertyFromSet,
    removeNativePropertySet,
    removeNativeRelationship,
    resolveNativeMovableProductId,
    serializeNativeIfcDocument,
    splitTopLevel,
    suggestCatalogObjectForEntity,
    updateNativeEntity,
    updateNativePlacement,
    updateNativePropertySetName,
    updateNativePropertyValue,
    updateNativeRelationship,
    validateEntityAgainstCatalogObject,
    validateObjectInfoIndex,
    viewerWorldDeltaToIfcPlacementDelta,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
    type NativeIfcDocument,
    type NativeIfcEntity,
} from "@/ifc";
import { type NativeGraphPreset } from "@/ifc/nativeGraph";

import {
    Button,
    MosaicWindowMenu,
    SegmentedControl,
    typeOption,
} from "@/components/ifc-workspace/ui";
import { ChildWindow } from "./child-window";
import { registerEmergencySave } from "./error-boundary";
import { BuilderPanel } from "./ifc-workspace/BuilderPanel";
import { CatalogPanel, CatalogReviewPanel } from "./ifc-workspace/CatalogPanel";
import {
    BUILT_IN_WORKSPACES,
    DEFAULT_MOSAIC_LAYOUT,
    DEFAULT_WORKSPACE_ID,
    ENTITY_TYPES,
    MOSAIC_TITLES,
    MOSAIC_VIEW_IDS,
    RELATION_TYPES,
} from "./ifc-workspace/constants";
import { GraphPanel } from "./ifc-workspace/GraphPanel";
import {
    InspectorPanel,
    ResourceControlsPanel,
    ResourceReferencesPanel,
} from "./ifc-workspace/InspectorPanel";
import { ObjectInfoPanel } from "./ifc-workspace/ObjectInfoPanel";
import { ConsolePanel, DiagnosticsPanel } from "./ifc-workspace/ReviewPanels";
import { StructurePanel } from "./ifc-workspace/StructurePanel";
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
import { NotesPanel, RecentFilesPanel } from "./ifc-workspace/WorkspacePanels";
import {
    cloneMosaicNode,
    createCustomWorkspace,
    loadActiveWorkspaceId,
    loadCustomWorkspaces,
    loadNotes,
    loadRecentIfcFiles,
    mergeRecentIfcFile,
    resolveWorkspace,
    saveActiveWorkspaceId,
    saveCustomWorkspaces,
    saveNotes,
    saveRecentIfcFiles,
    type RecentIfcFileEntry,
} from "./ifc-workspace/workspaceStorage";
import type { RelationshipFlowClipboardNode } from "./relationship-flow.types";
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
  const [initialDocument] = useState(createInitialWorkspaceDocument);
  const [documentSessions, setDocumentSessions] = useState<
    WorkspaceDocumentSession[]
  >(() => [initialDocument]);
  const [activeDocumentId, setActiveDocumentId] = useState(initialDocument.id);
  const [customWorkspaces, setCustomWorkspaces] = useState(
    workspaceBootState.customWorkspaces,
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    workspaceBootState.activeWorkspaceId,
  );
  const [structureMode, setStructureMode] = useState<StructureMode>("tree");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("info");
  const [mosaicValue, setMosaicValue] =
    useState<MosaicNode<MosaicViewId> | null>(workspaceBootState.layout);
  const [search, setSearch] = useState("");
  const [graphDepth, setGraphDepth] = useState(1);
  const [graphPreset, setGraphPreset] = useState<NativeGraphPreset>("all");
  const [graphRelationshipTypes, setGraphRelationshipTypes] = useState<
    Set<string>
  >(() => new Set());
  const [graphFocusRequest, setGraphFocusRequest] = useState<{
    entityId: number;
    nonce: number;
  } | null>(null);
  const [viewerFocusRequest, setViewerFocusRequest] = useState<{
    documentId: string;
    entityId: number;
    nonce: number;
  } | null>(null);
  const [loadingIfcName, setLoadingIfcName] = useState("");
  const [catalog, setCatalog] = useState<IfcObjectCatalog | null>(null);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>(() => [
    `${new Date().toLocaleTimeString()}  ui.boot({ shell: 'vite-react' });`,
  ]);
  const [recentIfcFiles, setRecentIfcFiles] = useState(loadRecentIfcFiles);
  const [notes, setNotes] = useState(loadNotes);
  const [coordinateClipboard, setCoordinateClipboard] =
    useState<CoordinateClipboard | null>(null);
  const [detachedViews, setDetachedViews] = useState<Set<MosaicViewId>>(
    () => new Set(),
  );
  const desktopApi =
    typeof window === "undefined" ? undefined : window.ifcNativeDesktop;
  const allWorkspaces = useMemo(
    () => [...BUILT_IN_WORKSPACES, ...customWorkspaces],
    [customWorkspaces],
  );
  const activeWorkspace =
    allWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    allWorkspaces[0];

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
  const objectInfoIndex = useMemo(
    () => buildObjectInfoIndex(viewerDocument),
    [viewerDocument],
  );
  const objectInfoFindings = useMemo(
    () => validateObjectInfoIndex(objectInfoIndex),
    [objectInfoIndex],
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
    return session;
  };

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
      setGraphFocusRequest(null);
    }
    const entity = selectionDocument.entityById.get(resolvedId);
    logAction(
      `${source}.selectEntity({ id: ${resolvedId}, class: '${entity?.type ?? "UNKNOWN"}' });`,
    );
  };

  const revealGraphWarningEntity = (id: number) => {
    const entity = activeSession.document.entityById.get(id);
    if (!entity) {
      return;
    }
    setSelectedId(id);
    setGraphAnchorId(id);
    setGraphCollapsed((current) => removeFromSet(current, id));
    setGraphExpanded((current) => addToSet(current, id));
    setGraphFocusRequest({
      entityId: id,
      nonce: Date.now(),
    });
    logAction(`graph.warning.reveal({ id: ${id}, class: '${entity.type}' });`);
  };

  const centerViewerCamera = (id = selectedId, source = "ui") => {
    const entity = activeSession.document.entityById.get(id);
    if (!entity) {
      return;
    }
    setSelectedId(id);
    if (!activeSession.viewerModelLoadRequested) {
      requestActiveViewerLoad();
    }
    setViewerFocusRequest({
      documentId: activeSession.id,
      entityId: id,
      nonce: Date.now(),
    });
    logAction(
      `${source}.cameraCenter({ id: ${id}, class: '${entity.type}' });`,
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key !== "." && event.code !== "Period") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      centerViewerCamera(
        selectedId,
        structureMode === "graph" ? "graph" : "tree",
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSession, selectedId, structureMode]);

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
      setMosaicValue((current) =>
        addMosaicView(addMosaicView(current, "catalog"), "catalog-review"),
      );
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
    const session = replaceDocument(
      createNativeSampleDocument(),
      undefined,
      "ui.loadSample('IFCnative Builder Sample.ifc');",
    );
    rememberRecentIfc(session, "sample");
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
    saveCustomWorkspaces(customWorkspaces);
  }, [customWorkspaces]);

  useEffect(() => {
    saveActiveWorkspaceId(activeWorkspaceId || DEFAULT_WORKSPACE_ID);
  }, [activeWorkspaceId]);

  useEffect(() => {
    saveRecentIfcFiles(recentIfcFiles);
  }, [recentIfcFiles]);

  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const emergencyStateRef = useRef({
    activeWorkspaceId,
    customWorkspaces,
    notes,
    recentIfcFiles,
  });
  emergencyStateRef.current = {
    activeWorkspaceId,
    customWorkspaces,
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

  const pasteGraphNodes = (
    sourceId: number,
    relationshipType: string,
    copiedNodes: RelationshipFlowClipboardNode[],
    connect: boolean,
  ) => {
    if (
      (connect && !document.entityById.has(sourceId)) ||
      copiedNodes.length === 0
    ) {
      return;
    }
    const pasteableNodes = copiedNodes.filter(
      (node) => node.type !== "IFCPROJECT",
    );
    if (!pasteableNodes.length) {
      logAction("graph.pasteNodesSkipped({ reason: 'no-pasteable-nodes' });");
      return;
    }

    let next = document;
    const nextPositions = new Map(graphPositions);
    const pastedIds: number[] = [];
    pasteableNodes.forEach((node, index) => {
      const addedId = getNextNativeEntityId(next);
      const withElement = addNativeElement(
        next,
        undefined,
        node.type,
        graphCopyName(node.name, node.type, index),
      );
      next = connect
        ? addNativeRelationship(
            withElement,
            relationshipType,
            sourceId,
            addedId,
          )
        : withElement;
      nextPositions.set(addedId, { x: node.x, y: node.y });
      pastedIds.push(addedId);
    });

    commitDocument(
      next,
      pastedIds[pastedIds.length - 1],
      connect
        ? `Paste ${pastedIds.length.toLocaleString()} graph node${pastedIds.length === 1 ? "" : "s"} under #${sourceId}`
        : `Paste ${pastedIds.length.toLocaleString()} graph node${pastedIds.length === 1 ? "" : "s"} without relationships`,
      `graph.pasteNodesCommit({ sourceId: ${sourceId}, relationship: '${relationshipType}', connect: ${connect}, ids: [${pastedIds.join(", ")}] });`,
      nextPositions,
    );
    setGraphPinned(
      (current) =>
        new Set([...current, ...(connect ? [sourceId] : []), ...pastedIds]),
    );
    if (connect) {
      setGraphExpanded((current) => addToSet(current, sourceId));
      setGraphCollapsed((current) => removeFromSet(current, sourceId));
    }
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

  const addMaterialWithProperties = (
    materialName: string,
    materialCategory: string,
    propertySetName: string,
    propertyRows: string,
  ) => {
    const next = addNativeMaterialWithProperties(
      document,
      selectedId,
      materialName,
      materialCategory,
      propertySetName,
      propertyRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material '${materialName}' with properties to #${selectedId}`,
      `addMaterialWithProperties({ objectId: ${selectedId}, name: ${JSON.stringify(materialName)} });`,
    );
  };

  const addMaterialStyle = (
    materialName: string,
    materialCategory: string,
    styleName: string,
    color: string,
    transparency: string,
  ) => {
    const next = addNativeMaterialStyle(
      document,
      selectedId,
      materialName,
      materialCategory,
      styleName,
      color,
      transparency,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material style '${styleName}' to #${selectedId}`,
      `addMaterialStyle({ objectId: ${selectedId}, material: ${JSON.stringify(materialName)}, color: ${JSON.stringify(color)} });`,
    );
  };

  const addMaterialLayerSet = (setName: string, layerRows: string) => {
    const next = addNativeMaterialLayerSet(
      document,
      selectedId,
      setName,
      layerRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material layer set '${setName}' to #${selectedId}`,
      `addMaterialLayerSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialLayerSetUsage = (
    setName: string,
    layerRows: string,
    direction: string,
    directionSense: string,
    offset: string,
    referenceExtent: string,
  ) => {
    const next = addNativeMaterialLayerSetUsage(
      document,
      selectedId,
      setName,
      layerRows,
      direction,
      directionSense,
      offset,
      referenceExtent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material layer set usage '${setName}' to #${selectedId}`,
      `addMaterialLayerSetUsage({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialProfileSet = (
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
  ) => {
    const next = addNativeMaterialProfileSet(
      document,
      selectedId,
      setName,
      profileName,
      materialName,
      category,
      width,
      depth,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material profile set '${setName}' to #${selectedId}`,
      `addMaterialProfileSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialProfileSetUsage = (
    setName: string,
    profileName: string,
    materialName: string,
    category: string,
    width: string,
    depth: string,
    cardinalPoint: string,
    referenceExtent: string,
  ) => {
    const next = addNativeMaterialProfileSetUsage(
      document,
      selectedId,
      setName,
      profileName,
      materialName,
      category,
      width,
      depth,
      cardinalPoint,
      referenceExtent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material profile set usage '${setName}' to #${selectedId}`,
      `addMaterialProfileSetUsage({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addMaterialConstituentSet = (
    setName: string,
    constituentRows: string,
  ) => {
    const next = addNativeMaterialConstituentSet(
      document,
      selectedId,
      setName,
      constituentRows,
    );
    commitDocument(
      next,
      selectedId,
      `Assign material constituent set '${setName}' to #${selectedId}`,
      `addMaterialConstituentSet({ objectId: ${selectedId}, name: ${JSON.stringify(setName)} });`,
    );
  };

  const addGroupAssignment = (
    groupType: string,
    groupName: string,
    objectType: string,
    longName: string,
  ) => {
    const next = addNativeGroupAssignment(
      document,
      selectedId,
      groupType,
      groupName,
      objectType,
      longName,
    );
    commitDocument(
      next,
      selectedId,
      `Assign ${groupType} '${groupName}' to #${selectedId}`,
      `addGroupAssignment({ objectId: ${selectedId}, type: ${JSON.stringify(groupType)}, name: ${JSON.stringify(groupName)} });`,
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

  const addLibraryReference = (
    identification: string,
    name: string,
    location: string,
  ) => {
    const next = addNativeLibraryReference(
      document,
      selectedId,
      identification,
      name,
      location,
    );
    commitDocument(
      next,
      selectedId,
      `Assign library '${identification}' to #${selectedId}`,
      `addLibraryReference({ objectId: ${selectedId}, id: '${identification}' });`,
    );
  };

  const addApproval = (identifier: string, name: string, status: string) => {
    const next = addNativeApproval(
      document,
      selectedId,
      identifier,
      name,
      status,
    );
    commitDocument(
      next,
      selectedId,
      `Assign approval '${identifier || name}' to #${selectedId}`,
      `addApproval({ objectId: ${selectedId}, id: '${identifier}' });`,
    );
  };

  const addConstraint = (
    name: string,
    grade: string,
    source: string,
    qualifier: string,
    intent: string,
  ) => {
    const next = addNativeConstraintObjective(
      document,
      selectedId,
      name,
      grade,
      source,
      qualifier,
      intent,
    );
    commitDocument(
      next,
      selectedId,
      `Assign constraint '${name}' to #${selectedId}`,
      `addConstraint({ objectId: ${selectedId}, name: ${JSON.stringify(name)} });`,
    );
  };

  const updateResourceEntityArgs = (
    updates: Array<{ entityId: number; args: string[] }>,
    label: string,
  ) => {
    if (updates.length === 0) {
      return;
    }
    const next = updates.reduce(
      (current, update) =>
        updateNativeEntity(current, update.entityId, { args: update.args }),
      document,
    );
    commitDocument(
      next,
      selectedId,
      label,
      `updateResourceEntities({ ids: [${updates.map((update) => update.entityId).join(", ")}] });`,
    );
  };

  const removeResourceAssociation = (relationshipId: number) => {
    const relationship = document.entityById.get(relationshipId);
    const next = removeNativeRelationship(document, relationshipId);
    commitDocument(
      next,
      selectedId,
      `Remove ${relationship?.type ?? "resource association"} #${relationshipId}`,
      `removeResourceAssociation({ id: ${relationshipId} });`,
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

  const deletePsetProperty = (setId: number, propertyId: number) => {
    const next = removeNativePropertyFromSet(document, setId, propertyId);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Delete property #${propertyId} from #${setId}`,
      `deleteProperty({ setId: ${setId}, id: ${propertyId} });`,
    );
  };

  const renamePset = (setId: number, name: string) => {
    const next = updateNativePropertySetName(document, setId, name);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Rename Pset #${setId} to '${name}'`,
      `renamePset({ setId: ${setId}, name: ${JSON.stringify(name)} });`,
    );
  };

  const duplicatePset = (setId: number) => {
    const set = document.propertySetsByEntity
      .get(selectedId)
      ?.find((item) => item.id === setId);
    const next = duplicateNativePropertySet(
      document,
      selectedId,
      setId,
      `${set?.name || `#${setId}`} Copy`,
    );
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Duplicate ${set?.kind ?? "Pset"} #${setId}${set ? ` '${set.name}'` : ""}`,
      `duplicatePset({ objectId: ${selectedId}, setId: ${setId} });`,
    );
  };

  const deletePset = (setId: number) => {
    const set = document.propertySetsByEntity
      .get(selectedId)
      ?.find((item) => item.id === setId);
    const next = removeNativePropertySet(document, selectedId, setId);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Delete ${set?.kind ?? "Pset"} #${setId}${set ? ` '${set.name}'` : ""}`,
      `deletePset({ objectId: ${selectedId}, setId: ${setId} });`,
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

  const deleteEntity = (entityId: number, source: "tree" | "graph") => {
    const entity = document.entityById.get(entityId);
    if (!entity || entity.type === "IFCPROJECT") {
      return;
    }

    const next = removeNativeEntity(document, entityId);
    if (next === document) {
      return;
    }

    const nextSelection = findNextSelectionAfterEntityDelete(
      document,
      next,
      entityId,
    );
    const nextAnchor = next.entityById.has(graphAnchorId)
      ? graphAnchorId
      : next.entityById.has(nextSelection ?? 0)
        ? (nextSelection as number)
        : (next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? graphAnchorId);
    const nextPositions = filterGraphPositions(graphPositions, next);

    setTreeExpanded((current) => filterEntitySet(current, next));
    setGraphPinned((current) => filterEntitySet(current, next));
    setGraphExpanded((current) => filterEntitySet(current, next));
    setGraphCollapsed((current) => filterEntitySet(current, next));
    setGraphAnchorId(nextAnchor);

    commitDocument(
      next,
      nextSelection,
      `Delete #${entityId} ${entity.type}`,
      `${source}.deleteEntity({ id: ${entityId}, class: '${entity.type}' });`,
      nextPositions,
      { reloadViewer: true },
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
    <TileContent>
      <SegmentedControl
        options={["tree", "graph"]}
        value={structureMode}
        onChange={(value) => setStructureMode(value as StructureMode)}
      />
      <Input
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder="Search ID, class, name, GlobalId"
        className="h-8 shrink-0"
      />
      {structureMode === "tree" ? (
        <StructurePanel
          document={document}
          expanded={treeExpanded}
          filteredEntities={filteredEntities}
          search={search}
          selectedId={selectedId}
          onCenterCamera={(id) => centerViewerCamera(id, "tree")}
          onRemove={(id) => deleteEntity(id, "tree")}
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
          focusRequest={graphFocusRequest}
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
          onPasteNodes={pasteGraphNodes}
          onPreset={setGraphPreset}
          onPositions={setGraphPositions}
          onRemoveNode={(id) => deleteEntity(id, "graph")}
          onRemoveRelationship={deleteRelationship}
          onRelationshipTypeFilters={(filters) =>
            setGraphRelationshipTypes(new Set(filters))
          }
          onRevealWarningEntity={revealGraphWarningEntity}
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
    </TileContent>
  );

  const renderInspector = () => (
    <TileContent>
      <SegmentedControl
        options={[
          "info",
          "edit",
          "placement",
          "geometry",
          "psets",
          "object-info",
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
        objectInfoFindings={objectInfoFindings}
        objectInfoIndex={objectInfoIndex}
        selectedId={selectedId}
        onAddGroupAssignment={addGroupAssignment}
        onAddMaterial={addMaterial}
        onAddMaterialConstituentSet={addMaterialConstituentSet}
        onAddMaterialLayerSet={addMaterialLayerSet}
        onAddMaterialLayerSetUsage={addMaterialLayerSetUsage}
        onAddMaterialProfileSet={addMaterialProfileSet}
        onAddMaterialProfileSetUsage={addMaterialProfileSetUsage}
        onAddMaterialStyle={addMaterialStyle}
        onAddMaterialWithProperties={addMaterialWithProperties}
        onAssignType={assignType}
        onAssignBodyToSelected={assignBodyToSelected}
        onAddEmptyPset={addEmptyPset}
        onAddPropertyToSet={addPropertyToSet}
        onAddQuantity={addQuantity}
        onAddUnit={addUnit}
        onApplyCatalogFindings={applyCatalogFindings}
        onAddRelationship={addRelationship}
        onDuplicatePropertySet={duplicatePset}
        onRemoveRelationship={deleteRelationship}
        onRemovePropertyFromSet={deletePsetProperty}
        onRemovePropertySet={deletePset}
        onSaveEdit={saveSelectedEdit}
        onMovePlacement={moveSelectedPlacement}
        onRenamePropertySet={renamePset}
        onSelectEntity={selectEntity}
        onUpdateProperty={updatePsetProperty}
        onUpdateRelationship={editRelationship}
      />
    </TileContent>
  );

  const renderResourceReferences = () => (
    <TileContent>
      <ResourceReferencesPanel
        document={viewerDocument}
        selectedId={selectedId}
        onAddClassification={addClassification}
        onAddDocumentReference={addDocumentReference}
        onAddLibraryReference={addLibraryReference}
        onRemoveAssociation={removeResourceAssociation}
        onUpdateEntityArgs={updateResourceEntityArgs}
      />
    </TileContent>
  );

  const renderResourceControls = () => (
    <TileContent>
      <ResourceControlsPanel
        document={viewerDocument}
        selectedId={selectedId}
        onAddApproval={addApproval}
        onAddConstraint={addConstraint}
        onRemoveAssociation={removeResourceAssociation}
        onUpdateEntityArgs={updateResourceEntityArgs}
      />
    </TileContent>
  );

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

  const renderToolbarControls = (id: MosaicViewId) => [
    id !== "viewer" && !detachedViews.has(id) ? (
      <button
        key="detach"
        aria-label={`${MOSAIC_TITLES[id]} als eigenes Fenster oeffnen`}
        className="mosaic-default-control detach-button"
        title="Als eigenes Fenster oeffnen"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          detachMosaicView(id);
        }}
      >
        <PanelTopOpen aria-hidden className="size-3.5" />
      </button>
    ) : null,
    ...DEFAULT_CONTROLS_WITHOUT_CREATION.map((control, index) =>
      isValidElement(control)
        ? cloneElement(control, { key: `default-${index}` })
        : control,
    ),
  ];

  const renderViewContent = (id: MosaicViewId) => {
    switch (id) {
      case "structure":
        return renderStructure();
      case "viewer":
        return (
          <TileContent>
            <ThatOpenViewer
              activeDocumentId={activeSession.id}
              activeModelDeferredReason={
                activeSession.viewerModelDeferredReason
              }
              activeModelFileName={activeSession.document.fileName}
              activeModelLoaded={activeSession.viewerModelLoadRequested}
              focusRequest={viewerFocusRequest}
              models={viewerModels}
              onLog={logAction}
              onLoadActiveModel={requestActiveViewerLoad}
              onMoveSelected={nudgeSelectedPlacement}
              onPickCoordinates={storePickedCoordinates}
              onSelect={selectEntity}
            />
          </TileContent>
        );
      case "inspector":
        return renderInspector();
      case "resource-references":
        return renderResourceReferences();
      case "resource-controls":
        return renderResourceControls();
      case "builder":
        return (
          <TileContent>
            <BuilderPanel
              coordinateClipboard={coordinateClipboard}
              document={document}
              selectedId={selectedId}
              onAddApproval={addApproval}
              onAddClassification={addClassification}
              onAddConstraint={addConstraint}
              onAddDocumentReference={addDocumentReference}
              onAddGroupAssignment={addGroupAssignment}
              onAddLibraryReference={addLibraryReference}
              onAssignType={assignType}
              onAddElement={addElement}
              onAddBodyElement={addBodyElement}
              onAssignBodyToSelected={assignBodyToSelected}
              onAddMaterial={addMaterial}
              onAddMaterialConstituentSet={addMaterialConstituentSet}
              onAddMaterialLayerSet={addMaterialLayerSet}
              onAddMaterialLayerSetUsage={addMaterialLayerSetUsage}
              onAddMaterialProfileSet={addMaterialProfileSet}
              onAddMaterialProfileSetUsage={addMaterialProfileSetUsage}
              onAddMaterialStyle={addMaterialStyle}
              onAddMaterialWithProperties={addMaterialWithProperties}
              onAddRelationship={addRelationship}
              onAddPset={addPset}
              onAddQuantity={addQuantity}
              onAddUnit={addUnit}
              onLoadSystemCoordinates={loadSystemCoordinateClipboard}
            />
          </TileContent>
        );
      case "catalog":
        return (
          <TileContent>
            <CatalogPanel
              catalog={catalog}
              document={viewerDocument}
              importing={catalogImporting}
              selectedCatalogObjectId={activeCatalogObjectId}
              selectedId={selectedId}
              onImportCatalog={importCatalog}
              onSelectCatalogObject={setSelectedCatalogObjectId}
            />
          </TileContent>
        );
      case "catalog-review":
        return (
          <TileContent>
            <CatalogReviewPanel
              catalog={catalog}
              findings={catalogFindings}
              selectedCatalogObjectId={activeCatalogObjectId}
              onApplyFinding={applyCatalogFinding}
            />
          </TileContent>
        );
      case "object-info":
        return (
          <TileContent>
            <ObjectInfoPanel
              document={viewerDocument}
              findings={objectInfoFindings}
              index={objectInfoIndex}
              selectedId={selectedId}
              onSelectEntity={selectEntity}
            />
          </TileContent>
        );
      case "console":
        return (
          <TileContent>
            <ConsolePanel
              lines={consoleLines}
              onClear={() => setConsoleLines([])}
            />
          </TileContent>
        );
      case "diagnostics":
        return (
          <TileContent>
            <DiagnosticsPanel document={document} />
          </TileContent>
        );
      case "recent":
        return (
          <TileContent>
            <RecentFilesPanel
              activeDocumentId={activeSession.id}
              entries={recentIfcFiles}
              onClear={() => setRecentIfcFiles([])}
              onSelectDocument={(documentId) => {
                if (
                  documentSessions.some((session) => session.id === documentId)
                ) {
                  setActiveDocumentId(documentId);
                }
              }}
            />
          </TileContent>
        );
      case "notes":
        return (
          <TileContent>
            <NotesPanel notes={notes} onNotesChange={setNotes} />
          </TileContent>
        );
    }
  };

  const renderTileContent = (id: MosaicViewId) => {
    if (detachedViews.has(id)) {
      return (
        <TileContent>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <PanelTopOpen aria-hidden className="size-6 opacity-60" />
            <div>
              {MOSAIC_TITLES[id]} ist in einem eigenen Fenster geoeffnet.
            </div>
            <Button
              label="Zurueck ins Hauptfenster"
              onPress={() => reattachMosaicView(id)}
            />
          </div>
        </TileContent>
      );
    }
    return renderViewContent(id);
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
      toolbarControls={renderToolbarControls(id)}
    >
      {renderTileContent(id)}
    </MosaicWindow>
  );

  const renderWorkspaceSwitcher = () => (
    <div className="flex shrink-0 items-center gap-1">
      <Select
        value={activeWorkspace?.id ?? DEFAULT_WORKSPACE_ID}
        onValueChange={(nextValue) => {
          if (nextValue) {
            selectWorkspace(nextValue);
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
        aria-label="Neuen Workspace hinzufuegen"
        size="icon-sm"
        title="Neuen Workspace hinzufuegen"
        variant="outline"
        onClick={createWorkspaceFromCurrentLayout}
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
        onClick={saveActiveWorkspace}
      >
        <Save aria-hidden className="size-3.5" />
      </IconButton>
      {!activeWorkspace?.builtIn ? (
        <IconButton
          aria-label="Workspace loeschen"
          size="icon-sm"
          title="Workspace loeschen"
          variant="outline"
          onClick={deleteActiveWorkspace}
        >
          <Trash2 aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );

  const renderDocumentTabs = () => (
    <Tabs
      value={activeSession.id}
      onValueChange={(nextValue) => {
        if (nextValue) {
          setActiveDocumentId(nextValue);
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
            <TabsTrigger
              key={session.id}
              value={session.id}
              className="group relative h-auto min-w-40 max-w-60 flex-col items-start gap-0.5 rounded-t-md border-x border-t border-transparent bg-transparent px-3 py-1.5 text-left transition-colors hover:bg-muted/40 data-active:border-border data-active:bg-card data-active:shadow-[0_1px_0_0_var(--color-card)]"
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40 group-data-active:bg-primary" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {session.document.fileName}
                </span>
                {session.documentTextDirty ? (
                  <span
                    aria-label="unsaved"
                    className="size-1.5 shrink-0 rounded-full bg-amber-500"
                  />
                ) : null}
              </span>
              <span className="w-full truncate pl-3 text-[0.65rem] font-normal text-muted-foreground">
                {session.document.schema} ·{" "}
                {session.document.entities.length.toLocaleString()} entities
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="relative z-20 flex shrink-0 flex-col gap-2 border-b border-border/70 bg-card/95 px-4 pt-2 pb-0 shadow-sm backdrop-blur lg:flex-row lg:items-center lg:gap-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-emerald-600 text-[10px] font-bold text-white shadow-sm"
          >
            IFC
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              IFCnative
            </span>
            <span className="text-[0.65rem] text-muted-foreground">
              {documentSessions.length.toLocaleString()}{" "}
              {documentSessions.length === 1 ? "Datei" : "Dateien"}
            </span>
          </div>
          <div className="mx-2 hidden h-6 w-px bg-border/70 lg:block" />
        </div>
        {renderWorkspaceSwitcher()}
        <div className="min-w-0 flex-1">{renderDocumentTabs()}</div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-2 lg:pb-0">
          <div className="flex items-center gap-1 rounded-md">
            <Button
              disabled={Boolean(loadingIfcName)}
              label={loadingIfcName ? "Lädt…" : "IFC öffnen"}
              primary
              onPress={() => void openIfc()}
            />
            <Button
              disabled={Boolean(loadingIfcName)}
              label="Hinzufügen"
              onPress={() => void addIfcFiles()}
            />
            <Button label="Beispiel" onPress={loadSample} />
          </div>
          <div className="mx-1 h-5 w-px bg-border/70" />
          <div className="flex items-center gap-1">
            <Button
              disabled={catalogImporting}
              label={catalog ? "Katalog neu laden" : "Katalog importieren"}
              onPress={() => void importCatalog()}
            />
            <Button
              disabled={Boolean(loadingIfcName)}
              label="IFC exportieren"
              onPress={() => void exportIfc()}
            />
          </div>
          <div className="mx-1 h-5 w-px bg-border/70" />
          <div className="flex items-center gap-1">
            <MosaicWindowMenu
              closedIds={closedMosaicIds}
              onRestore={restoreMosaicView}
            />
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 p-1.5">
        <div className="h-full min-h-[640px] overflow-hidden rounded-lg border border-border/60 bg-muted/30">
          <Mosaic<MosaicViewId>
            className="ifcnative-mosaic"
            renderTile={renderMosaicTile}
            resize={{ minimumPaneSizePercentage: 12 }}
            value={mosaicValue}
            zeroStateView={
              <div className="flex h-full items-center justify-center">
                <Button
                  label="Layout wiederherstellen"
                  primary
                  onPress={resetMosaicLayout}
                />
              </div>
            }
            onChange={setMosaicValue}
          />
        </div>
      </main>
      {[...detachedViews].map((id) => (
        <ChildWindow
          key={id}
          title={`IFCnative - ${MOSAIC_TITLES[id]}`}
          onClose={() => reattachMosaicView(id)}
        >
          <div className="flex h-full min-h-0 flex-1 flex-col bg-background p-3 text-foreground">
            {renderViewContent(id)}
          </div>
        </ChildWindow>
      ))}
    </div>
  );
}

function TileContent({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col gap-3">{children}</div>;
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

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function filterEntitySet(current: Set<number>, document: NativeIfcDocument) {
  return new Set([...current].filter((id) => document.entityById.has(id)));
}

function filterGraphPositions(
  current: Map<number, Point>,
  document: NativeIfcDocument,
) {
  return new Map([...current].filter(([id]) => document.entityById.has(id)));
}

function findNextSelectionAfterEntityDelete(
  current: NativeIfcDocument,
  next: NativeIfcDocument,
  entityId: number,
) {
  const related = current.relationshipsByEntity.get(entityId) ?? [];
  const candidates = [
    ...related.flatMap((relationship) =>
      relationship.targetIds.includes(entityId) ? relationship.sourceIds : [],
    ),
    ...related.flatMap((relationship) => relationship.sourceIds),
    ...related.flatMap((relationship) => relationship.targetIds),
    next.spatialRoots[0]?.id,
    next.entities[0]?.id,
  ].filter(
    (candidate): candidate is number =>
      Number.isFinite(candidate) && candidate !== entityId,
  );

  return candidates.find((candidate) => next.entityById.has(candidate));
}

function addToSet<T>(current: Set<T>, value: T) {
  return new Set(current).add(value);
}

function graphCopyName(name: string, type: string, index: number) {
  const baseName = name.trim() || type.replace(/^IFC/i, "");
  return `${baseName} Copy${index > 0 ? ` ${index + 1}` : ""}`;
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
