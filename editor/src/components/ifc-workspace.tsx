import { Button as IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
    FileText,
    PanelTopOpen,
    Plus,
    Redo2,
    Search,
    Settings,
    Undo2,
    X,
} from "lucide-react";
import {
    cloneElement,
    isValidElement,
    lazy,
    startTransition,
    Suspense,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
    DEFAULT_CONTROLS_WITHOUT_CREATION,
    Mosaic,
    MosaicWindow,
    type MosaicNode,
    type MosaicPath,
} from "react-mosaic-component";
import { pickFiles } from "../desktop/pickFiles";
import { captureTelemetryError, setTelemetryIfcContext } from "../diagnostics/telemetry";
import {
    loadWorkspaceDocument,
    loadWorkspaceDocuments,
} from "./ifc-workspace/documentLoading";

import {
    pickDesktopIfcAssets,
    readDesktopIfcAsset,
    readDesktopStartupIfcAssets,
} from "@/desktop/startupIfc";
import { createMinimalIfcProjectWithFreshGuids } from "@/ifc/builder";
import { canAssignNativeMaterial, createNativeMaterial, updateNativeMaterial, type NativeMaterialDraft } from "@/ifc/nativeDocument";
import { assignMaterialWithAppearance, saveMaterialProperty, updateMaterialAppearance, type MaterialAppearanceDraft, type MaterialPropertyDraft } from "@/ifc/materialEditing";
import {
    catalogObjectLabel,
    findCatalogObject,
    type CatalogKind,
    type CatalogObjectType,
    type CatalogValidationFinding,
    type IfcObjectCatalog,
} from "@/ifc/catalog";
import {
    applyCatalogQuickFix,
    suggestCatalogObjectForEntity,
    validateEntityAgainstCatalogObject,
} from "@/ifc/catalogValidation";
import {
    ifcPlacementPointToViewerWorldPoint,
    viewerWorldDeltaToIfcPlacementDelta,
    viewerWorldDirectionToIfcPlacementDirection,
    viewerWorldPointToIfcPlacementPoint,
} from "@/ifc/coordinateMapping";
import {
    applyDiagnosticObjectInfo,
    applyDiagnosticProcedureFromCatalog,
    setDiagnosticObjectiveReferences as setNativeDiagnosticObjectiveReferences,
    type DiagnosticObjectInfoDraft,
} from "@/ifc/diagnosticsAssistant";
import { parseIdsXml, type IdsDocumentModel } from "@/ifc/ids";
import {
    addNativeApproval,
    addNativeBodyElement,
    addNativeClassification,
    addNativeConstraintObjective,
    addNativeDocumentReference,
    addNativeElement,
    addNativeEmptyPropertySet,
    addNativeEntityToGroup,
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
    addNativePropertySetValues,
    addNativePropertyToSet,
    addNativeQuantitySet,
    addNativeRelationship,
    addNativeSiUnit,
    addNativeTypeAssignment,
    assignNativeBodyRepresentation,
    batchNativeDocument,
    combineNativeBodyElements,
    createNativeSampleDocument,
    duplicateNativeBodyElement,
    duplicateNativePropertySet,
    ensureNativeSpatialStructure,
    extractNativeSubsetIfc,
    getNativeBodyRepresentation,
    getNativeLengthUnitScale,
    getNativePlacement,
    getNativePlacementWorld,
    getNextNativeEntityId,
    listNativeUnassignedProductIds,
    mergeNativePropertySetValues,
    nativeWorldDirectionInPlacementParentFrame,
    planNativeEntityRemoval,
    removeNativeBodyRepresentation,
    removeNativeGroupMembership,
    removeNativePropertyFromSet,
    removeNativePropertySet,
    removeNativeRelationship,
    resolveNativeMovableProductId,
    splitNativeBodyByPlane,
    splitTopLevel,
    updateNativeEntity,
    updateNativePlacement,
    updateNativePlacementRotation,
    updateNativePlacementWorld,
    updateNativePropertySetName,
    updateNativePropertyValue,
    updateNativeRelationship,
    type NativeBodyProfile,
    type NativeEntityRemovalPlan,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type NativeSpatialStructureDraft,
} from "@/ifc/nativeDocument";
import { parseNativeIfcFileInWorker } from "@/ifc/nativeDocumentWorker";
import { type NativeGraphPreset } from "@/ifc/nativeGraph";
import {
    buildObjectInfoIndex,
    validateObjectInfoIndex,
} from "@/ifc/objectInfoValidation";

import {
    AttributionHeaderChip,
    AttributionOverlay,
    type AttributionMode,
    type AttributionStatus,
} from "@/components/ifc-workspace/AttributionOverlay";
import {
    Button,
    parseDecimalInput,
    SegmentedControl,
    typeOption,
} from "@/components/ifc-workspace/ui";
import { WorkspaceMenubar } from "@/components/ifc-workspace/WorkspaceMenubar";
import { WindowTitlebar } from "@/components/ifc-workspace/WindowTitlebar";
import {
    UI_SCALE_OPTIONS,
    useUiScale,
    type UiScale,
} from "@/hooks/use-ui-scale";
import { unwrapMutation } from "@/ifc/attribution/mutations";
import {
    readBauteilId,
    writeBauteilReference,
} from "@/ifc/attribution/recipes";
import { schemaRevision as currentSchemaRevision } from "@/ifc/attribution/schema";
import {
    applyAttributionSettings,
    type AttributionSettings,
} from "@/ifc/attribution/settings";
import { recordDiagnostic } from "../diagnostics/watchdog";
import { ChildWindow } from "./child-window";
import { registerEmergencySave } from "./error-boundary";
import type { AttributionPick } from "./ifc-workspace/AttributionPanel";
const AttributionPanel = lazy(() =>
  import("./ifc-workspace/AttributionPanel").then((module) => ({
    default: module.AttributionPanel,
  })),
);

import { saveIfcFile } from "@/desktop/saveIfc";
import { editorUpdates } from "@/updates/client";
import { useUpdateScheduler } from "@/updates/use-updates";
import { VcsApiClient } from "@/vcs/client";
import type { VcsDocumentOrigin } from "@/vcs/types";
import {
    BUILT_IN_WORKSPACES,
    DEFAULT_MOSAIC_LAYOUT,
    DEFAULT_WORKSPACE_ID,
    ENTITY_TYPES,
    MOSAIC_TITLES,
    MOSAIC_VIEW_IDS,
    RELATION_TYPES,
} from "./ifc-workspace/constants";
import { DeleteEntityDialog } from "./ifc-workspace/DeleteEntityDialog";
import {
    clearRecoveryDocuments,
    readRecoveryDocuments,
    writeRecoveryDocuments,
    type RecoveredDocument,
} from "./ifc-workspace/documentRecovery";
import {
    acknowledgeDocumentSave,
    captureDocumentSave,
    commitDocumentTransaction,
    createDocumentTransaction,
    createWorkspaceDocumentSession,
    mergePendingViewerChange,
    readDocumentText,
    refreshDocumentViewer,
    requestDocumentViewerLoad,
    restoreDocumentTransaction,
    type WorkspaceDocumentSession,
} from "./ifc-workspace/documentTransaction";
import { INSPECTOR_MODES } from "./ifc-workspace/inspectorModes";
import { type NewIfcDraft } from "./ifc-workspace/NewIfcDialog";
import { SaveDialog } from "./ifc-workspace/SaveDialog";
import type { SettingsSectionId } from "./ifc-workspace/SettingsDialog";
import {
    StartPage,
    type StartPageHubDocument,
} from "./ifc-workspace/StartPage";
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
import { UpdateNotification } from "./ifc-workspace/UpdateNotification";
import { useDocumentSessions } from "./ifc-workspace/useDocumentSessions";
import { VcsOriginStatus } from "./ifc-workspace/VcsOriginStatus";
import { NotesPanel, RecentFilesPanel } from "./ifc-workspace/WorkspacePanels";
import {
    cloneMosaicNode,
    createCustomWorkspace,
    loadActiveWorkspaceId,
    loadAttributionSettings,
    loadCustomWorkspaces,
    loadNotes,
    loadPortalSettings,
    loadPortalTokens,
    loadRecentIfcFiles,
    loadVcsAuth,
    loadVcsSettings,
    mergeRecentIfcFile,
    resolveWorkspace,
    saveActiveWorkspaceId,
    saveAttributionSettings,
    saveCustomWorkspaces,
    saveNotes,
    savePortalSettings,
    savePortalTokens,
    saveRecentIfcFiles,
    saveVcsAuth,
    saveVcsSettings,
    type RecentIfcFileEntry,
} from "./ifc-workspace/workspaceStorage";
import type { RelationshipFlowClipboardNode } from "./relationship-flow.types";
import type {
    ViewerContextMenuTarget,
    ViewerCoordinatePick,
    ViewerCutPlaneChange,
    ViewerCutPlaneMode,
    ViewerCutPlaneState,
    ViewerMirrorOp,
    ViewerMirrorRequest,
    ViewerMirrorResult,
    ViewerRotationChange,
} from "./that-open-viewer.types";
const PsetBatchPanel = lazy(() =>
  import("./ifc-workspace/PsetBatchPanel").then((module) => ({
    default: module.PsetBatchPanel,
  })),
);
const VcsPanel = lazy(() =>
  import("./ifc-workspace/VcsPanel").then((module) => ({
    default: module.VcsPanel,
  })),
);
const SpatialStructureDialog = lazy(() =>
  import("./ifc-workspace/SpatialStructureDialog").then((module) => ({
    default: module.SpatialStructureDialog,
  })),
);
const SettingsDialog = lazy(() =>
  import("./ifc-workspace/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const PortalPanel = lazy(() =>
  import("./ifc-workspace/PortalPanel").then((module) => ({
    default: module.PortalPanel,
  })),
);
const CheckPanel = lazy(() =>
  import("./ifc-workspace/CheckPanel").then((module) => ({
    default: module.CheckPanel,
  })),
);
const ResourceReferencesPanel = lazy(() =>
  import("./ifc-workspace/InspectorPanel").then((module) => ({
    default: module.ResourceReferencesPanel,
  })),
);
const ResourceControlsPanel = lazy(() =>
  import("./ifc-workspace/InspectorPanel").then((module) => ({
    default: module.ResourceControlsPanel,
  })),
);
const InspectorPanel = lazy(() =>
  import("./ifc-workspace/InspectorPanel").then((module) => ({
    default: module.InspectorPanel,
  })),
);
const GroupsPanel = lazy(() =>
  import("./ifc-workspace/GroupsPanel").then((module) => ({
    default: module.GroupsPanel,
  })),
);
const HubAddDialog = lazy(() =>
  import("./ifc-workspace/HubAddDialog").then((module) => ({
    default: module.HubAddDialog,
  })),
);
const GroupManagerDialog = lazy(() =>
  import("./ifc-workspace/GroupManagerDialog").then((module) => ({
    default: module.GroupManagerDialog,
  })),
);
const GraphPanel = lazy(() =>
  import("./ifc-workspace/GraphPanel").then((module) => ({
    default: module.GraphPanel,
  })),
);
const DiagnosticsAssistantPanel = lazy(() =>
  import("./ifc-workspace/DiagnosticsAssistantPanel").then((module) => ({
    default: module.DiagnosticsAssistantPanel,
  })),
);
const CatalogReviewPanel = lazy(() =>
  import("./ifc-workspace/CatalogPanel").then((module) => ({
    default: module.CatalogReviewPanel,
  })),
);
const CatalogPanel = lazy(() =>
  import("./ifc-workspace/CatalogPanel").then((module) => ({
    default: module.CatalogPanel,
  })),
);
const BuilderPanel = lazy(() =>
  import("./ifc-workspace/BuilderPanel").then((module) => ({
    default: module.BuilderPanel,
  })),
);
const MaterialsPanel = lazy(() =>
  import("./ifc-workspace/MaterialsPanel").then((module) => ({ default: module.MaterialsPanel })),
);

const ThatOpenViewer = lazy(() => import("./that-open-viewer"));

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
  const startupIfcHandledRef = useRef(false);
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
  const [documentSessions, setDocumentSessions] =
    useDocumentSessions(initialDocument);
  const [activeDocumentId, setActiveDocumentId] = useState(initialDocument.id);
  const [customWorkspaces, setCustomWorkspaces] = useState(
    workspaceBootState.customWorkspaces,
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    workspaceBootState.activeWorkspaceId,
  );
  const [structureMode, setStructureMode] = useState<StructureMode>("tree");
  const [treeRevealNonce, setTreeRevealNonce] = useState(0);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("overview");
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
  // Warteschlange statt Single-Slot: zwei schnelle Commits (oder Commits
  // während der Viewer-Initialisierung) dürfen keine Mirror-Op verlieren.
  const [viewerMirrorRequests, setViewerMirrorRequests] = useState<
    ViewerMirrorRequest[]
  >([]);
  const [viewerCutPlane, setViewerCutPlane] = useState<ViewerCutPlaneState>({
    active: false,
    mode: "translate",
    normal: { x: 0, y: 1, z: 0 },
    resetNonce: 0,
  });
  const [loadingIfcName, setLoadingIfcName] = useState("");
  const [catalog, setCatalog] = useState<IfcObjectCatalog | null>(null);
  const [catalogKind, setCatalogKind] = useState<CatalogKind>("diagnostik");
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [idsModel, setIdsModel] = useState<IdsDocumentModel | null>(null);
  const [idsImporting, setIdsImporting] = useState(false);
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState("");
  const [attributionPick, setAttributionPick] =
    useState<AttributionPick | null>(null);
  // IFC-Attribuierung läuft als großes Fenster über dem Layout, eingeklappt als Chip in der Kopfzeile (Zustand bleibt gemountet).
  const [attributionMode, setAttributionMode] =
    useState<AttributionMode>("closed");
  const [attributionStatus, setAttributionStatus] =
    useState<AttributionStatus | null>(null);
  // Schemadatei der Attribuierung: beim Start anwenden, damit das erste Rendern schon dagegen prüft.
  const [attributionSettings, setAttributionSettingsState] =
    useState<AttributionSettings>(() => {
      const loaded = loadAttributionSettings();
      applyAttributionSettings(loaded);
      return loaded;
    });
  const [schemaRevision, setSchemaRevision] = useState(() =>
    currentSchemaRevision(),
  );
  const setAttributionSettings = (next: AttributionSettings) => {
    setSchemaRevision(applyAttributionSettings(next));
    setAttributionSettingsState(next);
    logAction(
      `ui.attributionSchema({ file: ${JSON.stringify(next.schemaFile?.name ?? null)} });`,
    );
  };
  const [recentIfcFiles, setRecentIfcFiles] = useState(loadRecentIfcFiles);
  const [notes, setNotes] = useState(loadNotes);
  const [portalSettings, setPortalSettings] = useState(loadPortalSettings);
  const [portalTokens, setPortalTokens] = useState(loadPortalTokens);
  const [vcsSettings, setVcsSettings] = useState(loadVcsSettings);
  const [vcsAuth, setVcsAuth] = useState(loadVcsAuth);
  const [coordinateClipboard, setCoordinateClipboard] =
    useState<CoordinateClipboard | null>(null);
  const [groupManagerEntityId, setGroupManagerEntityId] = useState<
    number | null
  >(null);
  const [deleteRequest, setDeleteRequest] = useState<{
    documentId: string;
    entity: NativeIfcEntity;
    plan: NativeEntityRemovalPlan;
    sourceDocument: NativeIfcDocument;
    source: "tree" | "graph" | "groups" | "viewer" | "keyboard";
  } | null>(null);
  // Der 3D-Viewer lebt in einem eigenen, dauerhaften DOM-Knoten außerhalb
  // des Mosaic-Baums. react-mosaic mountet Kacheln bei jedem Layout- oder
  // Workspace-Wechsel neu; ein neu gemounteter Viewer würde seine Runtime
  // verwerfen und alle IFC-Modelle erneut zu Fragments konvertieren. Der
  // Host wird stattdessen nur in die jeweils sichtbare Kachel umgehängt.
  const [viewerHost] = useState(() => createPersistentViewerHost());
  useEffect(() => () => viewerHost.dispose(), [viewerHost]);
  const [detachedViews, setDetachedViews] = useState<Set<MosaicViewId>>(
    () => new Set(),
  );
  // Sichtbare Rückmeldung für Aktionen, die bisher nur in die DEV-Konsole
  // geloggt haben (Öffnen, Hinzufügen, Export, Katalogimport). Ohne sie sah
  // ein Fehlschlag exakt so aus wie "der Knopf tut nichts".
  const [statusAlert, setStatusAlert] = useState<{
    message: string;
    tone: "danger" | "success";
  } | null>(null);
  const [recoveredDocuments, setRecoveredDocuments] = useState<
    RecoveredDocument[]
  >([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const saveInFlight = useRef(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [hubAddOpen, setHubAddOpen] = useState(false);
  const [structureDialogOpen, setStructureDialogOpen] = useState(false);
  // Zentrale Einstellungen (Modal): ersetzt die früheren Einstellungs-Panels.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("appearance");
  const { scale: uiScale, setScale: setUiScale } = useUiScale();
  /** Öffnet die zentralen Einstellungen, optional in einem Abschnitt. */
  const openSettings = (section: SettingsSectionId = "appearance") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
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
  const selectedIds = activeSession.selectedIds;
  const graphAnchorId = activeSession.graphAnchorId;
  const graphPinned = activeSession.graphPinned;
  const graphExpanded = activeSession.graphExpanded;
  const graphCollapsed = activeSession.graphCollapsed;
  const graphPositions = activeSession.graphPositions;
  const hasUnexportedChanges = activeSession.hasUnexportedChanges;
  const undoStack = activeSession.undoStack ?? [];
  const redoStack = activeSession.redoStack ?? [];
  // Startseite: sichtbar, solange nur das unberührte Startdokument offen
  // ist. Jedes echte Öffnen (Picker, Drop, Hub, Neue IFC, Desktop-Übergabe,
  // Recovery) ersetzt bzw. ergänzt die Sessions und blendet sie dadurch aus.
  const showStartPage =
    documentSessions.length === 1 &&
    documentSessions[0].id === initialDocument.id &&
    !documentSessions[0].hasUnexportedChanges;

  // Geometry edits don't change telemetry context or trigger IPC messages.
  const telemetryIfcNames = [...new Set([
    ...(/\.ifc$/i.test(loadingIfcName) ? [loadingIfcName] : []),
    ...(showStartPage ? [] : documentSessions.map((session) => session.document.fileName)),
  ])].slice(0, 32).join("\0");
  useEffect(() => {
    setTelemetryIfcContext(telemetryIfcNames ? telemetryIfcNames.split("\0") : []);
  }, [telemetryIfcNames]);

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

  const setSelectedIds = (action: SetStateAction<Set<number>>) => {
    updateActiveSession((session) => ({
      ...session,
      selectedIds: applyStateAction(session.selectedIds, action),
    }));
  };

  // Objects targeted by batch operations: the explicit multi-selection from the
  // tree, or the single active object when nothing else is selected.
  const batchSelectionIds = useMemo(() => {
    const ids = [...selectedIds].filter((id) => document.entityById.has(id));
    return ids.length > 0
      ? ids
      : document.entityById.has(selectedId)
        ? [selectedId]
        : [];
  }, [document, selectedId, selectedIds]);

  const setGraphAnchorId = (action: SetStateAction<number>) => {
    updateActiveSession((session) => ({
      ...session,
      graphAnchorId: applyStateAction(session.graphAnchorId, action),
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
  const viewerEditCapabilities = useMemo(() => {
    const hasPlacement = Boolean(getNativePlacement(document, selectedId));
    return {
      canMove: hasPlacement,
      canRotate: hasPlacement,
      transformDisabledReason: hasPlacement
        ? undefined
        : "Auswahl hat kein editierbares IFCLOCALPLACEMENT",
    };
  }, [document, selectedId]);
  // Rotary-Menü: Kombinieren ist nur mit ≥2 platzierten Objekten mit
  // Geometrie sinnvoll — gleiche Regel wie der Builder-Panel-Button.
  const viewerCombineCount = useMemo(() => {
    if (batchSelectionIds.length < 2) {
      return 0;
    }
    return batchSelectionIds.every(
      (id) =>
        getNativeBodyRepresentation(document, id).hasRepresentation &&
        Boolean(getNativePlacement(document, id)),
    )
      ? batchSelectionIds.length
      : 0;
  }, [batchSelectionIds, document]);
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
    return MOSAIC_VIEW_IDS.filter((id) =>
      id === "attribution" ? attributionMode === "closed" : !visibleIds.has(id),
    );
  }, [attributionMode, mosaicValue]);

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
    if (import.meta.env.DEV) {
      console.debug(`${new Date().toLocaleTimeString()}  ${code}`);
    }
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

  const toggleMosaicView = (id: MosaicViewId, open: boolean) => {
    if (id === "attribution") {
      setAttributionMode(open ? "open" : "closed");
      logAction(`ui.attribution({ mode: '${open ? "open" : "closed"}' });`);
      return;
    }
    if (open) {
      restoreMosaicView(id);
      return;
    }
    setMosaicValue((current) => removeMosaicView(current, id));
    logAction(`ui.closeWindow({ view: '${id}' });`);
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
    summary: string,
    log?: string,
    nextGraphPositions?: Map<number, Point>,
    options?: {
      /**
       * Fasst wiederholte Änderungen zusammen: existiert bereits ein
       * ausstehender Eintrag mit diesem key, wird nur dessen Label ersetzt
       * (z. B. transform:<id> bei Mehrfach-Verschiebung).
       */
      pendingKey?: string;
      /**
       * Dual-Write: die Änderung wird sofort per Fragments-Edit-API in das
       * geladene Modell gespiegelt. Der Pending-Eintrag bleibt als Fallback
       * bestehen und wird erst bei gemeldetem Mirror-Erfolg entfernt —
       * schlägt der Mirror fehl, bleibt "Modell neu berechnen" verfügbar.
       */
      viewerMirror?: ViewerMirrorOp;
      /** Rebuild this document from its committed IFC after topology changes. */
      refreshViewer?: boolean;
    },
  ) => {
    const committedSessionId = activeSession.id;
    const transaction = createDocumentTransaction(document, next, summary);
    try {
      setDocumentSessions((current) =>
        current.map((session) =>
          session.id === committedSessionId
            ? commitDocumentTransaction(session, transaction, {
                selectedId: nextSelectedId,
                graphPositions: nextGraphPositions,
                pendingKey: options?.pendingKey,
                refreshViewer: options?.refreshViewer,
              })
            : session,
        ),
      );
    } catch (error) {
      reportFailure("Änderung konnte nicht übernommen werden", error);
      return;
    }
    if (transaction.affectsGeometry && options?.refreshViewer) {
      dropQueuedMirrorRequests([committedSessionId]);
    } else if (
      transaction.affectsGeometry &&
      options?.viewerMirror &&
      activeSession.viewerModelLoadRequested
    ) {
      setViewerMirrorRequests((current) => [
        ...current,
        {
          documentId: committedSessionId,
          label: summary,
          nonce: Date.now() + Math.random(),
          op: options.viewerMirror as ViewerMirrorOp,
          pendingKey: options.pendingKey,
        },
      ]);
    }
    if (log) {
      logAction(log);
    }
  };

  // Rückmeldung des Live-Mirrors: bei Erfolg ist die Änderung im Viewer
  // sichtbar — der zugehörige Pending-Eintrag (Fallback-Recalc) entfällt.
  // Bei Fehlschlag bleibt er bestehen bzw. wird wiederhergestellt.
  const applyViewerMirrorResult = (result: ViewerMirrorResult) => {
    // Konsumierten Request aus der Queue räumen: ein Remount des Viewers
    // (frische handled-Nonces) würde ihn sonst erneut anwenden.
    setViewerMirrorRequests((current) =>
      current.filter((request) =>
        result.nonce !== undefined
          ? request.nonce !== result.nonce
          : !(
              request.documentId === result.documentId &&
              request.label === result.label
            ),
      ),
    );
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== result.documentId) {
          return session;
        }
        if (!result.ok) {
          return {
            ...session,
            pendingViewerChanges: mergePendingViewerChange(
              session.pendingViewerChanges,
              { key: result.pendingKey, label: result.label },
            ),
          };
        }
        const remaining = session.pendingViewerChanges.filter((change) =>
          result.pendingKey
            ? change.key !== result.pendingKey
            : change.label !== result.label,
        );
        return {
          ...session,
          pendingViewerChanges: remaining,
          // Die Anzeige ist dem gespeicherten viewerModelText jetzt voraus —
          // ein Viewer-Remount muss frisch rekonvertieren.
          viewerModelTextStale: true,
        };
      }),
    );
    logAction(
      result.ok
        ? `viewer.mirrorApplied({ label: ${JSON.stringify(result.label)} });`
        : `viewer.mirrorFailed({ label: ${JSON.stringify(result.label)}, reason: ${JSON.stringify(result.reason ?? "unknown")} });`,
    );
  };

  // Frisch serialisierter viewerModelText enthält alle committeten Änderungen
  // bereits — noch nicht angewendete Mirror-Ops dieser Sessions verfallen,
  // sonst würden sie nach der Rekonvertierung doppelt angewendet.
  const dropQueuedMirrorRequests = (documentIds: Iterable<string>) => {
    const ids = new Set(documentIds);
    setViewerMirrorRequests((current) =>
      current.filter((request) => !ids.has(request.documentId)),
    );
  };

  // "Modell neu berechnen": alle ausstehenden Geometrie-Änderungen in einem
  // Rutsch übernehmen — Viewer-Quelle auf den aktuellen IFC-Text setzen und
  // per Revision-Bump die Re-Konvertierung des aktiven Dokuments auslösen.
  const recalculateViewerModel = () => {
    const sessionId = activeSession.id;
    const pendingCount = activeSession.pendingViewerChanges.length;
    if (!pendingCount) {
      return;
    }
    dropQueuedMirrorRequests([sessionId]);
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        return refreshDocumentViewer(session);
      }),
    );
    logAction(
      `viewer.recalculate({ file: '${activeSession.document.fileName}', pending: ${pendingCount} });`,
    );
  };

  // Beim (Re-)Mount des Viewers: Sessions, deren Anzeige per Live-Mirror
  // weiter war als ihr viewerModelText, frisch serialisieren und per
  // Revision-Bump rekonvertieren — sonst zeigt der neue Viewer den Stand
  // vor den gespiegelten Edits, und "Modell neu berechnen" hätte mangels
  // Pending-Einträgen nichts anzubieten.
  const recalculateStaleViewerSessions = () => {
    const staleIds = documentSessions
      .filter((session) => session.viewerModelTextStale)
      .map((session) => session.id);
    if (!staleIds.length) {
      return;
    }
    dropQueuedMirrorRequests(staleIds);
    setDocumentSessions((current) =>
      current.map((session) => {
        if (!session.viewerModelTextStale) {
          return session;
        }
        return refreshDocumentViewer(session);
      }),
    );
    logAction("viewer.staleRemountRecalc();");
  };

  const restoreDocumentHistory = (direction: "undo" | "redo") => {
    const entry = (direction === "undo" ? undoStack : redoStack).at(-1);
    if (!entry) return;
    setDeleteRequest(null);
    if (entry.affectsGeometry) dropQueuedMirrorRequests([activeSession.id]);
    setDocumentSessions((current) =>
      current.map((session) =>
        session.id === activeSession.id
          ? restoreDocumentTransaction(session, direction)
          : session,
      ),
    );
    logAction(
      `history.${direction}({ summary: ${JSON.stringify(entry.summary)} });`,
    );
  };

  const undoDocument = () => restoreDocumentHistory("undo");
  const redoDocument = () => restoreDocumentHistory("redo");

  const selectEntity = (
    id: number,
    source = "ui",
    globalId?: string,
    documentId = activeSession.id,
    additive = false,
  ) => {
    const selectionSession = documentSessions.find(
      (session) => session.id === documentId,
    );
    if (!selectionSession) {
      return;
    }
    // "thatopen": Linksklick im Viewer; "thatopen-context": Rechtsklick, der
    // das Rotary-Menü öffnet — löst die Mehrfachauswahl nicht auf, wenn das
    // Ziel dazugehört (Voraussetzung für "Kombinieren" im Rotary-Menü).
    const fromViewer = source === "thatopen" || source === "thatopen-context";
    const selectionDocument = selectionSession.document;
    const resolvedId = fromViewer
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
    if (
      attributionPick &&
      attributionPick.sessionIds.includes(documentId) &&
      documentId !== activeSession.id
    ) {
      const componentId = readBauteilId(selectionDocument, resolvedId);
      if (componentId) {
        const next = writeBauteilReference(
          document,
          attributionPick.entityId,
          componentId,
          attributionPick.importart,
        );
        if (next !== document) {
          commitDocument(
            next,
            selectedId,
            `BauteilID ${componentId} auf #${attributionPick.entityId}`,
            `attribution.pickBauteil({ id: ${attributionPick.entityId}, bauteil: ${JSON.stringify(componentId)} });`,
          );
        }
        setAttributionPick(null);
        setAttributionMode("open");
        return;
      }
    }
    if (fromViewer) {
      setStructureMode("tree");
      setSearch("");
      setTreeRevealNonce((current) => current + 1);
    }
    if (documentId !== activeSession.id) {
      // Auch beim Dokumentwechsel gelten additive-Toggle und der
      // Auswahl-Erhalt des Kontextmenü-Klicks — sonst zerstört ein
      // Strg-/Rechtsklick die gemerkte Mehrfachauswahl des Zieldokuments.
      setDocumentSessions((current) =>
        current.map((session) => {
          if (session.id !== documentId) {
            return session;
          }
          if (additive) {
            const nextIds = new Set(
              session.selectedIds.size
                ? session.selectedIds
                : [session.selectedId],
            );
            if (nextIds.has(resolvedId) && nextIds.size > 1) {
              nextIds.delete(resolvedId);
            } else {
              nextIds.add(resolvedId);
            }
            const nextPrimary = nextIds.has(resolvedId)
              ? resolvedId
              : ([...nextIds].at(-1) ?? resolvedId);
            return {
              ...session,
              selectedId: nextPrimary,
              selectedIds: nextIds,
            };
          }
          if (
            source === "thatopen-context" &&
            session.selectedIds.has(resolvedId) &&
            session.selectedIds.size > 1
          ) {
            return { ...session, selectedId: resolvedId };
          }
          return {
            ...session,
            selectedId: resolvedId,
            selectedIds: new Set([resolvedId]),
          };
        }),
      );
      setActiveDocumentId(documentId);
    } else if (additive) {
      // Strg-/Umschalt-Klick: Objekt in der Mehrfachauswahl umschalten; das
      // letzte verbleibende Objekt bleibt ausgewählt.
      updateActiveSession((session) => {
        const nextIds = new Set(
          session.selectedIds.size ? session.selectedIds : [session.selectedId],
        );
        if (nextIds.has(resolvedId) && nextIds.size > 1) {
          nextIds.delete(resolvedId);
        } else {
          nextIds.add(resolvedId);
        }
        const nextPrimary = nextIds.has(resolvedId)
          ? resolvedId
          : ([...nextIds].at(-1) ?? resolvedId);
        return { ...session, selectedId: nextPrimary, selectedIds: nextIds };
      });
    } else if (source === "thatopen-context") {
      updateActiveSession((session) => ({
        ...session,
        selectedId: resolvedId,
        selectedIds:
          session.selectedIds.has(resolvedId) && session.selectedIds.size > 1
            ? session.selectedIds
            : new Set([resolvedId]),
      }));
    } else {
      setSelectedId(resolvedId);
      setSelectedIds(new Set([resolvedId]));
    }
    if (source === "graph") {
      setGraphAnchorId(resolvedId);
      setGraphFocusRequest(null);
    }
    const entity = selectionDocument.entityById.get(resolvedId);
    logAction(
      `${source}.selectEntity({ file: '${selectionDocument.fileName}', id: ${resolvedId}, class: '${entity?.type ?? "UNKNOWN"}' });`,
    );
  };

  // Multi-selection from the tree (Ctrl/Shift-click). Keeps the active object
  // when it is still part of the selection so the inspector does not jump.
  const selectEntities = (ids: number[]) => {
    const valid = ids.filter((id) => activeSession.document.entityById.has(id));
    if (valid.length === 0) {
      return;
    }
    const nextPrimary = valid.includes(selectedId)
      ? selectedId
      : valid[valid.length - 1];
    updateActiveSession((session) => ({
      ...session,
      selectedId: nextPrimary,
      selectedIds: new Set(valid),
    }));
    if (valid.length > 1) {
      logAction(`tree.selectMany({ count: ${valid.length} });`);
    }
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

  const openIfcAsset = async (
    asset: { file: File; name: string },
    source: "desktop" | "picker",
  ) => {
    // "Öffnen" ersetzt ALLE offenen Dokumente (anders als "Hinzufügen") —
    // gleiche Rückfrage wie beim Tab-Schließen, sonst sind nicht exportierte
    // Stände samt Recovery nach dem nächsten Autosave-Lauf verloren.
    const unexported = documentSessions.filter(
      (session) => session.hasUnexportedChanges,
    );
    if (
      unexported.length &&
      !globalThis.confirm(
        `Öffnen ersetzt die aktuell geöffneten Dokumente. ${unexported
          .map((session) => `"${session.document.fileName}"`)
          .join(
            ", ",
          )} ${unexported.length === 1 ? "hat" : "haben"} nicht exportierte Änderungen. Trotzdem öffnen?`,
      )
    ) {
      logAction(`ui.openIfc.cancelled({ file: '${asset.name}' });`);
      return;
    }
    setLoadingIfcName(asset.name);
    logAction(
      `ui.openIfc.start({ file: '${asset.name}', source: '${source}', parser: 'worker' });`,
    );
    const parsed = await parseNativeIfcFileInWorker(asset.file, asset.name);
    const session = replaceDocument(
      parsed.document,
      undefined,
      `ui.openIfc({ file: '${asset.name}', source: '${source}', parser: 'worker', ms: ${Math.round(parsed.elapsedMs)} });`,
      undefined,
      undefined,
      parsed.bytes,
      asset.file,
    );
    rememberRecentIfc(session, "opened", asset.file);
    setStatusAlert({
      message: `${asset.name} geöffnet.`,
      tone: "success",
    });
  };

  const openIfc = async () => {
    if (loadingIfcName) {
      return;
    }
    try {
      const asset = await pickIfcFile();
      if (!asset) {
        return;
      }
      await openIfcAsset(asset, "picker");
    } catch (error) {
      reportFailure("IFC konnte nicht geöffnet werden", error);
    } finally {
      setLoadingIfcName("");
    }
  };

  useEffect(() => {
    if (startupIfcHandledRef.current) {
      return;
    }
    startupIfcHandledRef.current = true;
    void readDesktopStartupIfcAssets()
      .then(async (assets) => {
        const asset = assets[0];
        if (!asset) {
          return;
        }
        try {
          await openIfcAsset(asset, "desktop");
        } catch (error) {
          reportFailure(
            `Per Windows übergebene IFC-Datei ${asset.name} konnte nicht geöffnet werden`,
            error,
          );
        } finally {
          setLoadingIfcName("");
        }
      })
      .catch((error) => {
        reportFailure(
          "Windows-Dateiübergabe konnte nicht gelesen werden",
          error,
        );
      });
  }, []);

  const addIfcFiles = async () => {
    if (loadingIfcName) {
      return;
    }
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
      const loaded = await loadWorkspaceDocuments(assets);
      const nextSessions = loaded.map(({ session }) => session);
      for (const { session, elapsedMs } of loaded) {
        rememberRecentIfc(session, "added", session.sourceIfcFile);
        logAction(
          "ui.addIfc.file({ file: '" +
            session.document.fileName +
            "', parser: 'worker', ms: " +
            Math.round(elapsedMs) +
            " });",
        );
      }
      startTransition(() => {
        setDocumentSessions((current) => [...current, ...nextSessions]);
        setActiveDocumentId(nextSessions[0].id);
      });
      logAction(`ui.addIfc({ files: ${nextSessions.length} });`);
    } catch (error) {
      reportFailure("IFC-Dateien konnten nicht hinzugefügt werden", error);
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
      logAction(
        `ui.importCatalog.start({ file: '${asset.name}', kind: '${catalogKind}' });`,
      );
      const { parseCatalogWorkbook } = await import("@/ifc/catalogExcel");
      const parsed = parseCatalogWorkbook(
        await asset.file.arrayBuffer(),
        asset.name,
        catalogKind,
      );
      setCatalogKind(parsed.kind);
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
        `ui.importCatalog({ file: '${asset.name}', kind: '${parsed.kind}', classes: ${parsed.objectTypes.length} });`,
      );
    } catch (error) {
      reportFailure("Katalogimport fehlgeschlagen", error);
    } finally {
      setCatalogImporting(false);
    }
  };

  const importIds = async () => {
    try {
      const asset = await pickIdsFile();
      if (!asset) {
        return;
      }
      setIdsImporting(true);
      const parsed = parseIdsXml(await asset.file.text(), asset.name);
      setIdsModel(parsed);
      setMosaicValue((current) => addMosaicView(current, "check"));
      logAction(
        `ui.importIds({ file: '${asset.name}', specifications: ${parsed.specifications.length} });`,
      );
    } catch (error) {
      reportFailure("IDS-Import fehlgeschlagen", error);
    } finally {
      setIdsImporting(false);
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
    const next = batchNativeDocument(sourceDocument, (draft) =>
      fixes.reduce(
        (currentDocument, finding) =>
          applyCatalogQuickFix(currentDocument, selectedId, finding),
        draft,
      ),
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

  const applyDiagnosticObjectInfoDraft = (draft: DiagnosticObjectInfoDraft) => {
    const next = applyDiagnosticObjectInfo(document, selectedId, draft);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Apply diagnostics object information to #${selectedId}`,
      `diagnostics.objectInfo({ id: ${selectedId}, role: '${draft.role}' });`,
    );
  };

  const applyDiagnosticProcedure = (objectType: CatalogObjectType) => {
    const next = applyDiagnosticProcedureFromCatalog(
      document,
      selectedId,
      objectType,
    );
    if (next === document) {
      return;
    }
    setSelectedCatalogObjectId(objectType.id);
    commitDocument(
      next,
      selectedId,
      `Apply diagnostics procedure ${objectType.code || objectType.name} to #${selectedId}`,
      `diagnostics.procedure({ id: ${selectedId}, catalogObject: '${objectType.id}' });`,
    );
  };

  const setDiagnosticObjectiveReferences = (
    setId: number,
    objectiveIds: string[],
  ) => {
    const next = setNativeDiagnosticObjectiveReferences(
      document,
      selectedId,
      setId,
      objectiveIds,
    );
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Set investigation objectives on #${setId}`,
      `diagnostics.objectives({ setId: ${setId}, values: ${JSON.stringify(objectiveIds)} });`,
    );
  };

  // Der Export ist der einzige Weg, Arbeit aus der App herauszubekommen —
  // er darf niemals stumm scheitern. Jeder Fehler (Serialisierung, Blob-Größe,
  // blockierter Download) landet sichtbar im Header und in der Diagnose.
  const exportIfc = async (): Promise<boolean> => {
    if (saveInFlight.current) return false;
    saveInFlight.current = true;
    const fileName =
      (document.fileName.replace(/\.ifc$/i, "") || "IFCnative") + ".ifc";
    try {
      const snapshot = captureDocumentSave(activeSession);
      const result = await saveIfcFile(fileName, snapshot.text);
      if (result.status === "cancelled") return false;
      if (result.status === "saved") {
        setDocumentSessions((current) =>
          current.map((session) => acknowledgeDocumentSave(session, snapshot)),
        );
      }
      setStatusAlert({
        message:
          result.status === "saved"
            ? `${fileName} gespeichert.`
            : `Download von ${fileName} gestartet. Die Wiederherstellung bleibt erhalten, bis eine Speicherung bestätigt werden kann.`,
        tone: "success",
      });
      logAction(
        `ui.exportIfc({ file: ${JSON.stringify(fileName)}, status: '${result.status}' });`,
      );
      return true;
    } catch (error) {
      reportFailure(`Export von ${fileName} fehlgeschlagen`, error);
      return false;
    } finally {
      saveInFlight.current = false;
    }
  };

  // Aktueller Stand als IFC-Text für die IFC-Ablage (gleiche Cache-Regel wie
  // exportIfc: frisch serialisieren nur, wenn der Text-Cache veraltet ist).
  const getVcsIfcText = (): string => captureDocumentSave(activeSession).text;

  // Ein Versionsstand aus der IFC-Ablage wird als ZUSÄTZLICHER Tab geöffnet
  // (wie "Hinzufügen"), damit der aktuelle Arbeitsstand erhalten bleibt.
  const openIfcTextFromVcs = async (
    text: string,
    fileName: string,
    origin?: VcsDocumentOrigin,
  ) => {
    setLoadingIfcName(fileName);
    try {
      const { session } = await loadWorkspaceDocument({
        text,
        fileName,
        origin,
      });
      startTransition(() => {
        setDocumentSessions((current) => [...current, session]);
        setActiveDocumentId(session.id);
      });
      rememberRecentIfc(session, "added", session.sourceIfcFile);
      logAction(`ui.vcs.open({ file: '${fileName}' });`);
    } finally {
      setLoadingIfcName("");
    }
  };

  // Startseite: per Drag-&-Drop übergebene IFC-Dateien öffnen. Ersetzt die
  // Sessions komplett — die Startseite ist nur sichtbar, solange lediglich
  // das unberührte Beispieldokument offen ist.
  const openDroppedIfcFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      setLoadingIfcName(
        files.length === 1 ? files[0].name : `${files.length} IFC-Dateien`,
      );
      const loaded = await loadWorkspaceDocuments(
        files.map((file) => ({ file })),
      );
      const nextSessions = loaded.map(({ session }) => session);
      for (const session of nextSessions)
        rememberRecentIfc(session, "opened", session.sourceIfcFile);
      startTransition(() => {
        setDocumentSessions(nextSessions);
        setActiveDocumentId(nextSessions[0].id);
      });
      setStatusAlert({
        message:
          files.length === 1
            ? `${files[0].name} geöffnet.`
            : `${files.length} IFC-Dateien geöffnet.`,
        tone: "success",
      });
      logAction(`ui.startPage.drop({ files: ${files.length} });`);
    } catch (error) {
      reportFailure("IFC-Dateien konnten nicht geöffnet werden", error);
    } finally {
      setLoadingIfcName("");
    }
  };

  // Startseite: kürzlich verwendete Datei erneut öffnen. Nur im Desktop-Build
  // mit gespeichertem Pfad direkt lesbar — sonst bleibt der Datei-Picker.
  const openRecentIfcFile = async (entry: RecentIfcFileEntry) => {
    if (loadingIfcName) return;
    if (!entry.path || !("__TAURI_INTERNALS__" in globalThis)) {
      void openIfc();
      return;
    }
    try {
      setLoadingIfcName(entry.name);
      const asset = await readDesktopIfcAsset(entry.path);
      await openIfcAsset(asset, "desktop");
    } catch (error) {
      reportFailure(`${entry.name} konnte nicht erneut geöffnet werden`, error);
    } finally {
      setLoadingIfcName("");
    }
  };

  // "Vom IFC Hub hinzufügen"-Dialog: Stände als ZUSÄTZLICHE Tabs öffnen,
  // offene Dokumente bleiben erhalten.
  const loadHubDocuments = async (
    hubDocuments: StartPageHubDocument[],
    append: boolean,
  ) => {
    if (!hubDocuments.length) return;
    setLoadingIfcName(
      hubDocuments.length === 1
        ? hubDocuments[0].fileName
        : hubDocuments.length + " Modelle vom IFC Hub",
    );
    try {
      const loaded = await loadWorkspaceDocuments(hubDocuments);
      const nextSessions = loaded.map(({ session }) => session);
      startTransition(() => {
        setDocumentSessions((current) =>
          append ? [...current, ...nextSessions] : nextSessions,
        );
        setActiveDocumentId(
          nextSessions[append ? nextSessions.length - 1 : 0].id,
        );
      });
      for (const session of nextSessions)
        rememberRecentIfc(
          session,
          append ? "added" : "opened",
          session.sourceIfcFile,
        );
      if (append) setHubAddOpen(false);
      const label =
        hubDocuments.length === 1
          ? hubDocuments[0].fileName
          : hubDocuments.length + " Modelle";
      setStatusAlert({
        message:
          label + " vom IFC Hub " + (append ? "hinzugefügt." : "geladen."),
        tone: "success",
      });
      logAction(
        "ui." +
          (append ? "menubar.hubAdd" : "startPage.hubOpen") +
          "({ files: " +
          hubDocuments.length +
          " });",
      );
    } finally {
      setLoadingIfcName("");
    }
  };

  const addHubDocuments = (documents: StartPageHubDocument[]) =>
    loadHubDocuments(documents, true);
  const openHubDocuments = async (documents: StartPageHubDocument[]) => {
    try {
      await loadHubDocuments(documents, false);
    } catch (error) {
      reportFailure("Laden vom IFC Hub fehlgeschlagen", error);
    }
  };

  // Startseite: neue IFC-Datei aus den abgefragten Startwerten erstellen —
  // frische GlobalIds, wahlweise mit Beispielobjekt oder nur der Struktur.
  const createNewIfcDocument = async (draft: NewIfcDraft) => {
    try {
      setLoadingIfcName(draft.fileName);
      const text = createMinimalIfcProjectWithFreshGuids({
        author: draft.author || undefined,
        buildingName: draft.buildingName,
        name: draft.projectName,
        organization: draft.organization || undefined,
        products: draft.includeSampleProduct ? undefined : [],
        siteName: draft.siteName,
        storeyName: draft.storeyName,
      });
      const { session: loaded } = await loadWorkspaceDocument({
        text,
        fileName: draft.fileName,
      });
      const session: WorkspaceDocumentSession = {
        ...loaded,
        // Die frische Datei existiert noch nirgendwo auf der Platte —
        // Autosave/Recovery und Tab-Punkt sollen sie sofort schützen.
        hasUnexportedChanges: true,
      };
      startTransition(() => {
        setDocumentSessions([session]);
        setActiveDocumentId(session.id);
      });
      rememberRecentIfc(session, "sample", session.sourceIfcFile);
      setStatusAlert({
        message: `${draft.fileName} erstellt.`,
        tone: "success",
      });
      logAction(
        `ui.startPage.newIfc({ file: '${draft.fileName}', sampleProduct: ${draft.includeSampleProduct} });`,
      );
    } catch (error) {
      reportFailure("Neue IFC konnte nicht erstellt werden", error);
    } finally {
      setLoadingIfcName("");
    }
  };

  // "Raumstruktur anlegen": fehlende Ebenen Projekt → Standort → Gebäude →
  // Geschoss im aktiven Dokument ergänzen — der Weg, leere Modelle (z. B.
  // frisch vom Hub) befüllbar zu machen. Läuft über commitDocument und ist
  // damit rückgängig machbar.
  const applySpatialStructure = (draft: NativeSpatialStructureDraft) => {
    const result = ensureNativeSpatialStructure(document, draft);
    if (result.document === document) {
      setStatusAlert({
        message: "Die Raumstruktur ist bereits vollständig.",
        tone: "success",
      });
      return;
    }
    const parts = [...result.createdLabels];
    if (result.adoptedCount) {
      parts.push(
        `${result.adoptedCount} Bauteil${result.adoptedCount === 1 ? "" : "e"} zugeordnet`,
      );
    }
    commitDocument(
      result.document,
      result.storeyId,
      `Raumstruktur anlegen (${parts.join(", ")})`,
      `structure.ensure({ created: ${JSON.stringify(result.createdLabels)}, adopted: ${result.adoptedCount} });`,
    );
    setStatusAlert({
      message: `Raumstruktur angelegt: ${parts.join(", ")}.`,
      tone: "success",
    });
  };

  // Speichern: Hub-Dokumente bekommen den Dialog (lokal ODER committen),
  // rein lokale Dokumente exportieren wie bisher direkt.
  const saveActiveDocument = () => {
    if (activeSession.vcsOrigin) {
      setSaveDialogOpen(true);
    } else {
      void exportIfc();
    }
  };

  // Aktiven Stand mit Nachricht auf den Herkunfts-Branch des IFC Hub
  // committen. Wirft bei Fehlern — der Speichern-Dialog zeigt sie an und
  // bleibt offen, statt sie hinter dem Overlay zu verstecken.
  const commitActiveDocumentToHub = async (message: string) => {
    const origin = activeSession.vcsOrigin;
    if (!origin) {
      return;
    }
    if (!vcsAuth) {
      throw new Error("Nicht am IFC Hub angemeldet.");
    }
    if (saveInFlight.current)
      throw new Error("Eine Speicherung läuft bereits.");
    saveInFlight.current = true;
    try {
      const snapshot = captureDocumentSave(activeSession);
      const client = new VcsApiClient(vcsSettings, vcsAuth);
      const ifcText = snapshot.text;
      const result = await client.createCommit(
        origin.projectSlug,
        origin.modelSlug,
        { branch: origin.branch, message, ifcText },
      );
      setDocumentSessions((current) =>
        current.map((session) =>
          session.id === snapshot.sessionId
            ? {
                ...acknowledgeDocumentSave(session, snapshot),
                vcsOrigin: session.vcsOrigin
                  ? { ...session.vcsOrigin, commitId: result.commit.id }
                  : null,
              }
            : session,
        ),
      );
      setSaveDialogOpen(false);
      setStatusAlert({
        message: result.diff.identical
          ? `Commit ${result.commit.id.slice(0, 8)} auf ${origin.branch} angelegt (Stand identisch mit dem Branch-Kopf).`
          : `Commit ${result.commit.id.slice(0, 8)} auf ${origin.branch} angelegt: ${result.diff.added.length} neu, ${result.diff.modified.length} geändert, ${result.diff.removed.length} entfernt.`,
        tone: "success",
      });
      logAction(
        `ui.saveDialog.commit({ project: '${origin.projectSlug}', model: '${origin.modelSlug}', branch: '${origin.branch}', commit: '${result.commit.id.slice(0, 8)}' });`,
      );
    } finally {
      saveInFlight.current = false;
    }
  };

  // Erfolgsmeldungen verschwinden von selbst; Fehler bleiben stehen, bis sie
  // gelesen und weggeklickt wurden.
  useEffect(() => {
    if (statusAlert?.tone !== "success") {
      return;
    }
    const handle = window.setTimeout(() => setStatusAlert(null), 6_000);
    return () => window.clearTimeout(handle);
  }, [statusAlert]);

  // Die gespeicherte Ebenen-Position ist an das Modell gebunden, auf dem sie
  // gespawnt wurde — beim Wechsel der aktiven IFC deaktivieren, statt sie mit
  // den Matrizen des neuen Modells falsch zu platzieren.
  useEffect(() => {
    setViewerCutPlane((current) =>
      current.active
        ? { ...current, active: false, mode: "translate", position: undefined }
        : current,
    );
  }, [activeDocumentId]);

  const reportFailure = (context: string, error: unknown) => {
    captureTelemetryError(error, "application");
    const message = error instanceof Error ? error.message : String(error);
    setStatusAlert({ message: `${context}: ${message}`, tone: "danger" });
    recordDiagnostic("error", `${context}: ${message}`);
    logAction(`ui.error(${JSON.stringify(`${context}: ${message}`)});`);
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

  useEffect(() => {
    savePortalSettings(portalSettings);
  }, [portalSettings]);

  useEffect(() => {
    saveAttributionSettings(attributionSettings);
  }, [attributionSettings]);

  useEffect(() => {
    savePortalTokens(portalTokens);
  }, [portalTokens]);

  useEffect(() => {
    saveVcsSettings(vcsSettings);
  }, [vcsSettings]);

  useEffect(() => {
    saveVcsAuth(vcsAuth);
  }, [vcsAuth]);

  // Portal-Importe laufen asynchron (Netz-Roundtrip) und übernehmen ihr
  // Ergebnis gegen den zum Anwendungszeitpunkt aktuellen Stand statt gegen
  // den Klick-Zeitpunkt — sonst gingen zwischenzeitliche Änderungen verloren.
  const portalApplyTargetRef = useRef({ document, selectedId });
  portalApplyTargetRef.current = { document, selectedId };

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
        // Die IFC-Dokumente selbst gehen sonst verloren: der Error-Boundary
        // hängt den Baum ab und React verwirft dessen kompletten State.
        autosaveRef.current(true);
      }),
    [],
  );

  // --- Absturzsicherung der Dokumente -------------------------------------
  //
  // Bearbeitete Dokumente lebten bisher ausschließlich im React-State. Der
  // Autosave schreibt den serialisierten Stand jedes geänderten Dokuments nach
  // IndexedDB; beim nächsten Start wird er zur Wiederherstellung angeboten.
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  /**
   * Zuletzt persistierter Stand je Session. Dokumente sind unveränderlich, ein
   * Identitätsvergleich genügt also, um die teure Serialisierung (O(Dokument))
   * nur bei echten Änderungen zu bezahlen.
   */
  const persistedDocumentsRef = useRef(
    new Map<string, { document: NativeIfcDocument; ifcText: string }>(),
  );
  const autosaveSessionsRef = useRef(documentSessions);
  autosaveSessionsRef.current = documentSessions;
  const recoveredDocumentsRef = useRef(recoveredDocuments);
  recoveredDocumentsRef.current = recoveredDocuments;
  const loadingIfcRef = useRef(loadingIfcName);
  loadingIfcRef.current = loadingIfcName;
  useUpdateScheduler();
  useEffect(() => {
    editorUpdates.setInstallGuard(
      () =>
        !autosaveSessionsRef.current.some(
          (session) => session.hasUnexportedChanges,
        ) &&
        !saveInFlight.current &&
        !loadingIfcRef.current,
    );
    editorUpdates.setBeforeInstall(async () => {
      // The guard guarantees no dirty sessions, so a stale autosave snapshot
      // would only produce a misleading recovery banner after the restart.
      // A recovery the user has not decided on yet must survive.
      if (recoveredDocumentsRef.current.length) return;
      await clearRecoveryDocuments();
      persistedDocumentsRef.current = new Map();
    });
    return () => {
      editorUpdates.setInstallGuard(() => false);
      editorUpdates.setBeforeInstall(() => {});
    };
  }, []);
  const autosaveBlockedRef = useRef(true);
  autosaveBlockedRef.current =
    !recoveryChecked || recoveredDocuments.length > 0;

  const autosaveRef = useRef<(force?: boolean) => void>(() => {});
  autosaveRef.current = (force = false) => {
    // Solange ein wiederherstellbarer Stand aussteht, darf nicht geschrieben
    // werden — sonst überschreibt die leere Startsitzung die Rettung.
    if (autosaveBlockedRef.current && !force) {
      return;
    }
    const dirty = autosaveSessionsRef.current.filter(
      (session) => session.hasUnexportedChanges,
    );
    // Im Notfall-Pfad nichts schreiben, wenn es nichts zu retten gibt: sonst
    // löscht ein Absturz einen noch nicht zurückgeholten Stand.
    if (force && !dirty.length) {
      return;
    }
    const cache = persistedDocumentsRef.current;
    const unchanged =
      dirty.length === cache.size &&
      dirty.every(
        (session) => cache.get(session.id)?.document === session.document,
      );
    if (unchanged) {
      return;
    }
    const nextCache = new Map<
      string,
      { document: NativeIfcDocument; ifcText: string }
    >();
    const entries: RecoveredDocument[] = [];
    try {
      for (const session of dirty) {
        const cached = cache.get(session.id);
        const ifcText =
          cached?.document === session.document
            ? cached.ifcText
            : readDocumentText(session);
        nextCache.set(session.id, { document: session.document, ifcText });
        entries.push({
          entityCount: session.document.entities.length,
          fileName: session.document.fileName,
          id: session.id,
          ifcText,
          savedAt: new Date().toISOString(),
          schema: session.document.schema,
          selectedId: session.selectedId,
        });
      }
    } catch (error) {
      recordDiagnostic(
        "error",
        `Autosave-Serialisierung fehlgeschlagen: ${String(error)}`,
      );
      return;
    }
    void writeRecoveryDocuments(entries)
      .then(() => {
        persistedDocumentsRef.current = nextCache;
      })
      .catch((error: unknown) => {
        recordDiagnostic("error", `Autosave fehlgeschlagen: ${String(error)}`);
      });
  };

  useEffect(() => {
    let cancelled = false;
    readRecoveryDocuments()
      .then((entries) => {
        if (cancelled) {
          return;
        }
        if (entries.length) {
          recordDiagnostic(
            "note",
            `Wiederherstellbare Dokumente gefunden: ${entries.length}`,
          );
          setRecoveredDocuments(entries);
        }
      })
      .catch((error: unknown) => {
        recordDiagnostic(
          "error",
          `Wiederherstellung nicht lesbar: ${String(error)}`,
        );
      })
      .finally(() => {
        if (!cancelled) {
          setRecoveryChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce nach der letzten Änderung plus ein periodischer Rückfall, damit
  // auch durchgehendes Arbeiten regelmäßig gesichert wird. Der
  // Identitätsvergleich macht den periodischen Lauf im Leerlauf kostenlos.
  useEffect(() => {
    const debounce = window.setTimeout(() => autosaveRef.current(), 4_000);
    return () => window.clearTimeout(debounce);
  }, [documentSessions, recoveryChecked, recoveredDocuments.length]);

  useEffect(() => {
    const interval = window.setInterval(() => autosaveRef.current(), 30_000);
    const flushOnHide = () => autosaveRef.current();
    window.addEventListener("pagehide", flushOnHide);
    globalThis.document.addEventListener("visibilitychange", flushOnHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", flushOnHide);
      globalThis.document.removeEventListener("visibilitychange", flushOnHide);
    };
  }, []);

  const restoreRecoveredDocuments = async () => {
    setRecoveryBusy(true);
    try {
      const restored: WorkspaceDocumentSession[] = [];
      for (const entry of recoveredDocuments) {
        // Über den Worker parsen: bei großen Dokumenten blockiert das sonst
        // den Main-Thread für Sekunden.
        const file = new File([entry.ifcText], entry.fileName, {
          type: "application/x-step",
        });
        const parsed = await parseNativeIfcFileInWorker(file, entry.fileName);
        restored.push({
          ...createWorkspaceDocumentSession(parsed.document, {
            selectedId: entry.selectedId,
            text: entry.ifcText,
          }),
          // Der Stand ist weiterhin nicht exportiert — Kennzeichnung und
          // Autosave müssen das widerspiegeln.
          hasUnexportedChanges: true,
        });
      }
      if (!restored.length) {
        return;
      }
      setDocumentSessions((current) => [...current, ...restored]);
      setActiveDocumentId(restored[0].id);
      setRecoveredDocuments([]);
      setStatusAlert({
        message: `${restored.length} Dokument(e) wiederhergestellt. Bitte exportieren, um sie dauerhaft zu sichern.`,
        tone: "success",
      });
      logAction(`recovery.restore({ documents: ${restored.length} });`);
    } catch (error) {
      reportFailure("Wiederherstellung fehlgeschlagen", error);
    } finally {
      setRecoveryBusy(false);
    }
  };

  const discardRecoveredDocuments = async () => {
    setRecoveryBusy(true);
    try {
      await clearRecoveryDocuments();
      setRecoveredDocuments([]);
      logAction(`recovery.discard();`);
    } catch (error) {
      reportFailure("Wiederherstellung konnte nicht verworfen werden", error);
    } finally {
      setRecoveryBusy(false);
    }
  };

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
    );
  };

  const addChildElement = (parentId: number, type: string, name: string) => {
    if (!document.entityById.has(parentId)) {
      return;
    }
    const addedId = getNextNativeEntityId(document);
    const next = addNativeElement(document, parentId, type, name);
    // Auch geometrielose Elemente per Subset spiegeln: der Erfolg räumt den
    // Pending-Eintrag ab — kein manuelles "Modell neu berechnen" nötig.
    const subset = extractNativeSubsetIfc(next, [addedId]);
    commitDocument(
      next,
      addedId,
      `Create ${type} '${name}' under #${parentId}`,
      `tree.addChildElement({ parentId: ${parentId}, class: '${type}', name: ${JSON.stringify(name)}, id: ${addedId} });`,
      undefined,
      {
        pendingKey: `body:${addedId}`,

        viewerMirror: subset
          ? {
              entityIds: [addedId],
              kind: "reconvert-subset",
              replacedEntityIds: [],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
    );
  };

  // Freies Objekt ohne räumliche Zuordnung anlegen (Kontextmenü des
  // Ordners "Freie Objekte"): wie addChildElement, nur bewusst ohne
  // Parent-Beziehung — nach IFC-Schema zulässig.
  const addFreeElement = (type: string, name: string) => {
    const addedId = getNextNativeEntityId(document);
    const next = addNativeElement(document, undefined, type, name);
    const subset = extractNativeSubsetIfc(next, [addedId]);
    commitDocument(
      next,
      addedId,
      `Create free ${type} '${name}'`,
      `tree.addFreeElement({ class: '${type}', name: ${JSON.stringify(name)}, id: ${addedId} });`,
      undefined,
      {
        pendingKey: `body:${addedId}`,

        viewerMirror: subset
          ? {
              entityIds: [addedId],
              kind: "reconvert-subset",
              replacedEntityIds: [],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
    );
  };

  // Der Viewer stellt die Szene in echten IFC-Weltkoordinaten dar (Meter,
  // Y-up; die Koordinationsmatrix der Fragments-Konvertierung wird beim Laden
  // wieder angewendet). Ein Weltmodus-Punkt ist damit direkt eine
  // IFC-Weltkoordinate: nur Achsen tauschen und in Modell-Einheiten skalieren.
  // Die Projektion in die (georeferenzierte) Platzierungskette des Parents —
  // kleine lokale Koordinaten statt riesiger Absolutwerte — übernimmt
  // addNativeBodyElement.
  const addBodyElement = (options: BodyElementDraft) => {
    const parentId = options.parentId ?? selectedId;
    const addedId = getNextNativeEntityId(document);
    const scale = getNativeLengthUnitScale(document);
    const ifcPoint = viewerWorldPointToIfcPlacementPoint(
      {
        x: readBodyCoordinate(options.x),
        y: readBodyCoordinate(options.y),
        z: readBodyCoordinate(options.z),
      },
      scale,
    );
    const next = addNativeBodyElement(document, {
      ...options,
      parentId,
      positionInModelUnits: true,
      x: formatCoordinate(ifcPoint.x),
      y: formatCoordinate(ifcPoint.y),
      z: formatCoordinate(ifcPoint.z),
    });
    const createdWorld = getNativePlacementWorld(next, addedId);
    // Instant-Anzeige: exakte IFC-Geometrie des neuen Körpers als Mini-IFC
    // rekonvertieren statt einer Fragments-Näherung — kein manueller Refresh.
    const subset = extractNativeSubsetIfc(next, [addedId]);
    commitDocument(
      next,
      addedId,
      `Create ${options.type} '${options.name}' under #${parentId}`,
      `builder.createBodyElement({ class: '${options.type}', name: ${JSON.stringify(options.name)}, parentId: ${parentId}, id: ${addedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      {
        pendingKey: `body:${addedId}`,

        viewerMirror: subset
          ? {
              entityIds: [addedId],
              kind: "reconvert-subset",
              replacedEntityIds: [],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
    );
    logAction(
      `builder.bodyDiagnostics({ id: ${addedId}, mode: '${options.placementMode ?? "parent"}', unitScale: ${scale}, inputViewer: { x: ${options.x}, y: ${options.y}, z: ${options.z} }, ifcInput: { x: ${formatCoordinate(ifcPoint.x)}, y: ${formatCoordinate(ifcPoint.y)}, z: ${formatCoordinate(ifcPoint.z)} }, ifcWorld: { x: ${createdWorld?.worldX ?? "?"}, y: ${createdWorld?.worldY ?? "?"}, z: ${createdWorld?.worldZ ?? "?"} } });`,
    );
  };

  const removeBodyFromSelected = () => {
    const next = removeNativeBodyRepresentation(document, selectedId);
    if (next === document) {
      logAction(
        `builder.removeBodyRepresentation.skip({ id: ${selectedId}, reason: 'no-representation' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Remove geometry of #${selectedId}`,
      `builder.removeBodyRepresentation({ id: ${selectedId} });`,
      undefined,
      {
        pendingKey: `hide:${selectedId}`,

        viewerMirror: { entityId: selectedId, kind: "remove" },
      },
    );
  };

  // Rotary-Menü: Körper löschen — nur die Geometrie (Objekt bleibt) oder
  // über den bestehenden Bestätigungsdialog samt IFC-Objekt/Kaskade.
  const deleteBodyForEntity = (entityId: number, withEntity: boolean) => {
    if (!document.entityById.has(entityId)) {
      return;
    }
    if (withEntity) {
      requestDeleteEntity(entityId, "viewer");
      return;
    }
    const next = removeNativeBodyRepresentation(document, entityId);
    if (next === document) {
      setStatusAlert({
        message: `Objekt #${entityId} hat keine löschbare Körper-Geometrie.`,
        tone: "danger",
      });
      return;
    }
    commitDocument(
      next,
      entityId,
      `Remove geometry of #${entityId}`,
      `viewer.rotary.removeBody({ id: ${entityId} });`,
      undefined,
      {
        pendingKey: `hide:${entityId}`,

        viewerMirror: { entityId, kind: "remove" },
      },
    );
  };

  // Rotary-Menü: Duplikat mit geteilter Repräsentation, sofort per
  // partieller Rekonvertierung sichtbar.
  const duplicateBodyForEntity = (entityId: number) => {
    const result = duplicateNativeBodyElement(document, entityId);
    if (!result) {
      setStatusAlert({
        message: `Objekt #${entityId} hat kein editierbares IFCLOCALPLACEMENT und kann nicht dupliziert werden.`,
        tone: "danger",
      });
      return;
    }
    const subset = extractNativeSubsetIfc(result.document, [result.productId]);
    commitDocument(
      result.document,
      result.productId,
      `Duplicate #${entityId} as #${result.productId}`,
      `viewer.rotary.duplicateBody({ sourceId: ${entityId}, id: ${result.productId} });`,
      undefined,
      {
        pendingKey: `body:${result.productId}`,

        viewerMirror: subset
          ? {
              entityIds: [result.productId],
              kind: "reconvert-subset",
              replacedEntityIds: [],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
    );
  };

  // Rotary-Menü: neuen Körper am Rechtsklick-Punkt anlegen — räumlich im
  // Container des getroffenen Elements, platziert relativ zu dessen
  // (georeferenzierter) Kette.
  const addBodyAtViewerPoint = (
    profile: NativeBodyProfile,
    target: ViewerContextMenuTarget,
  ) => {
    const containment = document.relationshipsByEntity
      .get(target.entityId)
      ?.find(
        (relationship) =>
          relationship.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" &&
          relationship.targetIds.includes(target.entityId),
      );
    const parentId =
      containment?.sourceIds[0] ??
      document.entitiesByType.get("IFCBUILDINGSTOREY")?.[0]?.id ??
      selectedId;
    const labels: Record<NativeBodyProfile, string> = {
      cylinder: "Zylinder",
      ellipse: "Ellipse",
      marker: "Marker",
      rectangle: "Quader",
      triangle: "Dreieck",
    };
    addBodyElement({
      depth: "1",
      height: "1",
      name: `${labels[profile]} ${getNextNativeEntityId(document)}`,
      parentId,
      placementMode: "world",
      placementRelativeToId: target.entityId,
      profile,
      type: "IFCBUILDINGELEMENTPROXY",
      width: "1",
      x: String(target.point.x),
      y: String(target.point.y),
      z: String(target.point.z),
    });
  };

  // Schnittachse zyklisch drehen (Y → X → Z); Position bleibt erhalten.
  const cycleCutPlaneAxis = () => {
    setViewerCutPlane((current) => {
      const presets = [
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ];
      const index = presets.findIndex(
        (preset) =>
          Math.abs(preset.x - current.normal.x) < 0.01 &&
          Math.abs(preset.y - current.normal.y) < 0.01 &&
          Math.abs(preset.z - current.normal.z) < 0.01,
      );
      const normal = presets[(index + 1) % presets.length];
      return { ...current, active: true, normal };
    });
    logAction("viewer.cutPlane.cycleAxis();");
  };

  const setCutPlaneActive = (active: boolean) => {
    setViewerCutPlane((current) => ({
      ...current,
      active,
      mode: active ? current.mode : "translate",
      position: active ? undefined : current.position,
      resetNonce: active ? current.resetNonce + 1 : current.resetNonce,
    }));
  };

  const setCutPlaneMode = (mode: ViewerCutPlaneMode) => {
    setViewerCutPlane((current) => ({ ...current, mode }));
  };

  const applyViewerCutPlaneChange = (change: ViewerCutPlaneChange) => {
    setViewerCutPlane((current) => ({
      ...current,
      normal: change.normal,
      position: change.position,
    }));
  };

  const updateCutPlane = (
    change: Pick<ViewerCutPlaneState, "normal" | "position">,
  ) => {
    setViewerCutPlane((current) => ({
      ...current,
      active: true,
      normal: change.normal,
      position: change.position,
    }));
  };

  const resetCutPlane = () => {
    setViewerCutPlane((current) => ({
      ...current,
      active: true,
      position: undefined,
      resetNonce: current.resetNonce + 1,
    }));
  };

  const splitSelectedBody = () => {
    if (!viewerCutPlane.active || !viewerCutPlane.position) {
      setStatusAlert({
        message: "Schnittebene zuerst im 3D-Viewer positionieren.",
        tone: "danger",
      });
      return;
    }
    const metersPerUnit = getNativeLengthUnitScale(document);
    const point = viewerWorldPointToIfcPlacementPoint(
      viewerCutPlane.position,
      metersPerUnit,
    );
    const normal = viewerWorldDirectionToIfcPlacementDirection(
      viewerCutPlane.normal,
    );
    const result = splitNativeBodyByPlane(document, selectedId, {
      normal,
      point,
    });
    if (!result) {
      logAction(
        `builder.splitBody.skip({ id: ${selectedId}, reason: 'unsupported-geometry' });`,
      );
      setStatusAlert({
        message:
          "Die ausgewählte Body-Repräsentation enthält Geometrie, die nicht als IFC-Boolean-Operand geschnitten werden kann.",
        tone: "danger",
      });
      return;
    }
    // Beide Hälften zusammen mit vorhandenen Live-Edits aus demselben IFC-Stand
    // laden. So bleiben keine alten Subset-/Delta-Geometrien im Viewer zurück.
    commitDocument(
      result.document,
      result.partIds[0],
      `Cut #${selectedId} with plane into ${result.partIds.length} parts`,
      `builder.splitBodyByPlane({ id: ${selectedId}, parts: [${result.partIds.join(", ")}], point: ${JSON.stringify(point)}, normal: ${JSON.stringify(normal)} });`,
      undefined,
      {
        pendingKey: `split:${selectedId}`,
        refreshViewer: true,
      },
    );
    setSelectedIds(new Set(result.partIds));
    setViewerCutPlane((current) => ({ ...current, active: false }));
    setStatusAlert({
      message: `Objekt #${selectedId} wurde an der Schnittebene in zwei IFC-Objekte geteilt.`,
      tone: "success",
    });
  };

  const combineSelectedBodies = (name: string, removeSources: boolean) => {
    // Nur die validierte (Mehrfach-)Auswahl kombinieren: selectedId kann
    // z. B. nach Duplizieren außerhalb von selectedIds stehen und würde
    // sonst als unsichtbares N+1-Objekt mitkombiniert (und mit entfernt).
    const sourceIds = batchSelectionIds.includes(selectedId)
      ? [selectedId, ...batchSelectionIds.filter((id) => id !== selectedId)]
      : [...batchSelectionIds];
    const result = combineNativeBodyElements(document, sourceIds, {
      name,
      removeSources,
    });
    if (!result) {
      logAction(
        `builder.combineBodies.skip({ ids: [${sourceIds.join(", ")}], reason: 'unsupported-selection' });`,
      );
      return;
    }
    const subset = extractNativeSubsetIfc(result.document, [result.productId]);
    commitDocument(
      result.document,
      result.productId,
      `Combine ${result.sourceIds.length} objects as #${result.productId}`,
      `builder.combineBodies({ ids: [${result.sourceIds.join(", ")}], resultId: ${result.productId}, name: ${JSON.stringify(name)}, removeSources: ${removeSources} });`,
      undefined,
      {
        pendingKey: `combine:${result.productId}`,

        viewerMirror: subset
          ? {
              entityIds: [result.productId],
              kind: "reconvert-subset",
              replacedEntityIds: removeSources ? result.sourceIds : [],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
    );
    setSelectedIds(new Set([result.productId]));
  };

  // Dual-Write statt Fragments-first: die Geometrie wird im nativen Dokument
  // (Source of Truth) zugewiesen und nur zur Anzeige in das Fragments-Modell
  // gespiegelt. Vorher lief dieser Pfad umgekehrt (Fragments-Edit + Rebuild
  // des nativen Dokuments aus den Fragments) und verlor dabei STEP-Details.
  const assignBodyToSelected = (options: BodyElementDraft) => {
    const next = assignNativeBodyRepresentation(document, selectedId, options);
    if (next === document) {
      logAction(
        `builder.assignBodyRepresentation.skip({ id: ${selectedId}, reason: 'not-assignable' });`,
      );
      return;
    }
    // Instant-Anzeige: die neue/geänderte Repräsentation exakt als Mini-IFC
    // rekonvertieren; das bisherige Element wird im Basismodell ausgeblendet.
    const subset = extractNativeSubsetIfc(next, [selectedId]);
    commitDocument(
      next,
      selectedId,
      `Assign geometry to #${selectedId}`,
      `builder.assignBodyRepresentation({ id: ${selectedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
      undefined,
      {
        pendingKey: `body:${selectedId}`,

        viewerMirror: subset
          ? {
              entityIds: [selectedId],
              kind: "reconvert-subset",
              replacedEntityIds: [selectedId],
              subsetIfcText: subset.text,
            }
          : undefined,
      },
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

  const addEmptyPset = (psetName: string) => {
    const next = addNativeEmptyPropertySet(document, selectedId, psetName);
    commitDocument(
      next,
      selectedId,
      `Add empty Pset '${psetName}' to #${selectedId}`,
      `addEmptyPset({ objectId: ${selectedId}, name: '${psetName}' });`,
    );
  };

  const findEntityPsetByName = (
    sourceDocument: NativeIfcDocument,
    entityId: number,
    psetName: string,
  ) => {
    const token = psetName.trim().toLowerCase();
    return (sourceDocument.propertySetsByEntity.get(entityId) ?? []).find(
      (set) => set.name.trim().toLowerCase() === token,
    );
  };

  const addPsetToSelection = (psetName: string) => {
    const name = psetName.trim();
    if (!name || batchSelectionIds.length === 0) {
      return;
    }
    let added = 0;
    const next = batchNativeDocument(document, (draft) => {
      let next = draft;
      for (const id of batchSelectionIds) {
        if (findEntityPsetByName(next, id, name)) {
          continue;
        }
        next = addNativeEmptyPropertySet(next, id, name);
        added += 1;
      }
      return next;
    });
    if (next === document) {
      logAction(
        `psetBatch.addPset.skip({ name: ${JSON.stringify(name)}, reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Add Pset '${name}' to ${added.toLocaleString()} objects`,
      `psetBatch.addPset({ name: ${JSON.stringify(name)}, added: ${added}, selected: ${batchSelectionIds.length} });`,
    );
  };

  // Add the catalog class currently selected in the Objektkatalog window to the
  // batch selection: one pset per Merkmalsgruppe (with its catalog properties)
  // on each selected object.
  const addCatalogObjectToSelection = () => {
    if (!activeCatalogObject || batchSelectionIds.length === 0) {
      return;
    }
    const groups = new Map<
      string,
      {
        name: string;
        properties: Map<string, { name: string; valueType: string }>;
      }
    >();
    for (const rule of activeCatalogObject.propertyRules) {
      const key = rule.psetName.trim().toLowerCase();
      if (!key) {
        continue;
      }
      let group = groups.get(key);
      if (!group) {
        group = { name: rule.psetName, properties: new Map() };
        groups.set(key, group);
      }
      if (!group.properties.has(rule.propertyName)) {
        group.properties.set(rule.propertyName, {
          name: rule.propertyName,
          valueType: rule.valueType,
        });
      }
    }
    if (groups.size === 0) {
      return;
    }
    let addedPsets = 0;
    let addedProperties = 0;
    const next = batchNativeDocument(document, (draft) => {
      let next = draft;
      for (const id of batchSelectionIds) {
        for (const group of groups.values()) {
          const existingSet = findEntityPsetByName(next, id, group.name);
          const existingNames = new Set(
            (existingSet?.values ?? []).map((property) =>
              property.name.trim().toLowerCase(),
            ),
          );
          const missingProperties = [...group.properties.values()].filter(
            (property) =>
              !existingNames.has(property.name.trim().toLowerCase()),
          );
          if (missingProperties.length === 0) {
            continue;
          }
          next = mergeNativePropertySetValues(
            next,
            id,
            group.name,
            missingProperties.map((property) => ({
              name: property.name,
              value: "",
              valueType: property.valueType,
            })),
          );
          addedProperties += missingProperties.length;
          if (!existingSet) {
            addedPsets += 1;
          }
        }
      }
      return next;
    });
    if (next === document) {
      logAction(
        `psetBatch.addCatalogObject.skip({ object: '${activeCatalogObject.id}', reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Apply catalog class '${catalogObjectLabel(activeCatalogObject)}' (${addedProperties.toLocaleString()} properties) to ${batchSelectionIds.length.toLocaleString()} objects`,
      `psetBatch.addCatalogObject({ object: '${activeCatalogObject.id}', psets: ${groups.size}, addedPsets: ${addedPsets}, addedProperties: ${addedProperties} });`,
    );
  };

  // Neue Property auf allen ausgewählten Objekten anlegen; fehlt das Pset auf
  // einem Objekt, wird es dort mitsamt der Property erzeugt (Coverage-Ziel).
  const addPropertyToSelection = (
    psetName: string,
    propertyName: string,
    valueType: string,
    value: string,
  ) => {
    const name = propertyName.trim();
    if (!name || batchSelectionIds.length === 0) {
      return;
    }
    let added = 0;
    const next = batchNativeDocument(document, (draft) => {
      let next = draft;
      for (const id of batchSelectionIds) {
        const set = findEntityPsetByName(next, id, psetName);
        if (set) {
          const exists = set.values.some(
            (item) => item.name.trim().toLowerCase() === name.toLowerCase(),
          );
          if (exists) {
            continue;
          }
          next = addNativePropertyToSet(next, set.id, name, value, valueType);
        } else {
          next = addNativePropertySetValues(next, id, psetName, [
            { name, value, valueType },
          ]);
        }
        added += 1;
      }
      return next;
    });
    if (next === document) {
      logAction(
        `psetBatch.addProperty.skip({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(name)}, reason: 'all-present' });`,
      );
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Add property '${name}' to ${added.toLocaleString()} objects`,
      `psetBatch.addProperty({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(name)}, type: '${valueType}', objects: ${added} });`,
    );
  };

  // Datentyp einer Property zentral für alle ausgewählten Objekte setzen.
  // updateNativePropertyValue wendet valueType nur zusammen mit einem Wert an,
  // daher wird der aktuelle Wert mitgereicht (und dabei neu typisiert).
  const setPropertyTypeForSelection = (
    psetName: string,
    propertyName: string,
    valueType: string,
  ) => {
    if (batchSelectionIds.length === 0) {
      return;
    }
    const token = propertyName.trim().toLowerCase();
    let changed = 0;
    const next = batchNativeDocument(document, (draft) => {
      let next = draft;
      for (const id of batchSelectionIds) {
        const set = findEntityPsetByName(next, id, psetName);
        const property = set?.values.find(
          (item) => item.name.trim().toLowerCase() === token,
        );
        if (!property) {
          continue;
        }
        const updated = updateNativePropertyValue(next, property.id, {
          value: readSimplePropertyValueText(next.entityById.get(property.id)),
          valueType,
        });
        if (updated !== next) {
          next = updated;
          changed += 1;
        }
      }
      return next;
    });
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Set type '${valueType}' for '${propertyName}' on ${changed.toLocaleString()} objects`,
      `psetBatch.setPropertyType({ pset: ${JSON.stringify(psetName)}, name: ${JSON.stringify(propertyName)}, type: '${valueType}', objects: ${changed} });`,
    );
  };

  const editPsetCellValue = (
    entityId: number,
    setId: number,
    propertyId: number | undefined,
    propertyName: string,
    value: string,
  ) => {
    const next =
      propertyId != null
        ? updateNativePropertyValue(document, propertyId, { value })
        : addNativePropertyToSet(document, setId, propertyName, value);
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Edit ${propertyName} on #${entityId}`,
      `psetBatch.editValue({ id: ${entityId}, set: ${setId}, property: ${JSON.stringify(propertyName)} });`,
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

  const createLibraryMaterial = (draft: NativeMaterialDraft) => {
    const result = createNativeMaterial(document, draft);
    commitDocument(result.document, undefined, `Material '${draft.name}' anlegen`);
    setStatusAlert({ message: `Material „${draft.name}“ angelegt.`, tone: "success" });
    return result.materialId;
  };

  const editLibraryMaterial = (id: number, draft: NativeMaterialDraft) => {
    commitDocument(updateNativeMaterial(document, id, draft), undefined, `Material #${id} bearbeiten`);
    setStatusAlert({ message: `Material „${draft.name}“ gespeichert.`, tone: "success" });
  };

  const assignLibraryMaterial = (id: number) => {
    const targets = batchSelectionIds.filter((entityId) => canAssignNativeMaterial(document, entityId));
    if (!targets.length) return;
    const next = assignMaterialWithAppearance(document, targets, id);
    commitDocument(next, undefined, `Material #${id} an ${targets.length} Objekte zuordnen`, undefined, undefined, { refreshViewer: true });
    setStatusAlert({ message: `Material „${document.entityById.get(id)?.name}“ ${targets.length} Objekten zugeordnet.`, tone: "success" });
  };

  const editMaterialAppearance = (id: number, styleId: number | undefined, draft: MaterialAppearanceDraft) => {
    const next = updateMaterialAppearance(document, id, styleId, draft);
    commitDocument(next, undefined, `Materialdarstellung #${id} ändern`, undefined, undefined, { refreshViewer: true });
    setStatusAlert({ message: "Materialdarstellung gespeichert.", tone: "success" });
  };

  const editMaterialProperty = (id: number, draft: MaterialPropertyDraft) => {
    commitDocument(saveMaterialProperty(document, id, draft), undefined, `Materialeigenschaft ${draft.name} speichern`);
    setStatusAlert({ message: `Materialeigenschaft „${draft.name}“ gespeichert.`, tone: "success" });
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

  const requestDeleteEntity = (
    entityId: number,
    source: "tree" | "graph" | "groups" | "viewer" | "keyboard",
  ) => {
    const entity = document.entityById.get(entityId);
    if (!entity || entity.type === "IFCPROJECT") {
      return;
    }
    const plan = planNativeEntityRemoval(document, entityId);
    if (!plan) {
      return;
    }
    setDeleteRequest({
      documentId: activeSession.id,
      entity,
      plan,
      source,
      sourceDocument: document,
    });
  };

  const confirmDeleteEntity = () => {
    const request = deleteRequest;
    if (!request || request.documentId !== activeSession.id) {
      setDeleteRequest(null);
      return;
    }
    const currentEntity = document.entityById.get(request.entity.id);
    const currentPlan =
      request.sourceDocument === document
        ? request.plan
        : planNativeEntityRemoval(document, request.entity.id);
    if (!currentEntity || !currentPlan) {
      setDeleteRequest(null);
      return;
    }
    const entityId = currentEntity.id;
    const next = currentPlan.document;
    // Kaskadiert mitgelöschte Produkte mit eigener Geometrie (Inhalt einer
    // Site/eines Buildings) — der Mirror muss sie mit ausblenden, sonst
    // bleibt ihre Geometrie im Viewer stehen.
    const cascadeEntityIds = currentPlan.removedEntityIds.filter(
      (id) =>
        id !== entityId &&
        getNativeBodyRepresentation(document, id).hasRepresentation,
    );

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

    setGraphPinned((current) => filterEntitySet(current, next));
    setGraphExpanded((current) => filterEntitySet(current, next));
    setGraphCollapsed((current) => filterEntitySet(current, next));
    setGraphAnchorId(nextAnchor);
    setDeleteRequest(null);

    commitDocument(
      next,
      nextSelection,
      `Delete #${entityId} ${currentEntity.type}`,
      `${request.source}.deleteEntity({ id: ${entityId}, class: '${currentEntity.type}' });`,
      nextPositions,
      {
        pendingKey: `hide:${entityId}`,

        viewerMirror: { cascadeEntityIds, entityId, kind: "remove" },
      },
    );
  };

  // Weist ein Objekt einer bestehenden Gruppe zu (keine Geometrie-Änderung).
  const assignEntityToGroup = (entityId: number, groupId: number) => {
    const next = addNativeEntityToGroup(document, entityId, groupId);
    if (next === document) {
      return;
    }
    const group = document.entityById.get(groupId);
    commitDocument(
      next,
      selectedId,
      `Assign #${entityId} to ${group?.name || `#${groupId}`}`,
      `groups.assignToGroup({ entityId: ${entityId}, groupId: ${groupId} });`,
    );
  };

  // Legt eine neue Gruppe an und weist das Objekt direkt zu.
  const createGroupForEntity = (
    entityId: number,
    groupType: string,
    groupName: string,
  ) => {
    const next = addNativeGroupAssignment(
      document,
      entityId,
      groupType,
      groupName,
    );
    if (next === document) {
      return;
    }
    commitDocument(
      next,
      selectedId,
      `Create group '${groupName || groupType}' for #${entityId}`,
      `groups.createGroup({ entityId: ${entityId}, type: ${JSON.stringify(groupType)}, name: ${JSON.stringify(groupName)} });`,
    );
  };

  // Löst nur die Gruppenmitgliedschaft (IFCRELASSIGNSTOGROUP-Eintrag) —
  // Objekt und Gruppe bleiben bestehen, keine Geometrie-Änderung.
  const removeGroupMembership = (memberId: number, groupId: number) => {
    const next = removeNativeGroupMembership(document, memberId, groupId);
    if (next === document) {
      return;
    }
    const member = document.entityById.get(memberId);
    const group = document.entityById.get(groupId);
    commitDocument(
      next,
      selectedId,
      `Remove #${memberId} from ${group?.name || `#${groupId}`}`,
      `groups.removeMembership({ memberId: ${memberId}, class: '${member?.type ?? "?"}', groupId: ${groupId} });`,
    );
  };

  const moveSelectedPlacement = (x: string, y: string, z: string) => {
    const sourceDocument = document;
    const beforeWorld = getNativePlacementWorld(sourceDocument, selectedId);
    const next = updateNativePlacement(sourceDocument, selectedId, { x, y, z });
    const afterWorld = getNativePlacementWorld(next, selectedId);
    // Live-Mirror: Verschiebung als Szenen-Delta (Viewer-Achsen, Meter).
    const scale = getNativeLengthUnitScale(sourceDocument);
    const viewerDelta =
      beforeWorld && afterWorld
        ? ifcPlacementPointToViewerWorldPoint(
            {
              x: afterWorld.worldX - beforeWorld.worldX,
              y: afterWorld.worldY - beforeWorld.worldY,
              z: afterWorld.worldZ - beforeWorld.worldZ,
            },
            scale,
          )
        : null;
    commitDocument(
      next,
      selectedId,
      `Move #${selectedId} placement to (${x}, ${y}, ${z})`,
      `movePlacement({ id: ${selectedId}, x: ${JSON.stringify(x)}, y: ${JSON.stringify(y)}, z: ${JSON.stringify(z)} });`,
      undefined,
      {
        pendingKey: `transform:${selectedId}`,

        viewerMirror: viewerDelta
          ? {
              delta: viewerDelta,
              entityId: selectedId,
              kind: "move",
            }
          : undefined,
      },
    );
  };

  const nudgeSelectedPlacement = (
    entityId: number,
    delta: {
      x?: number;
      y?: number;
      z?: number;
    },
  ) => {
    const failNative = (reason: string) => {
      logAction(
        `fragments.viewerDeltaSkipped({ id: ${entityId}, reason: '${reason}' });`,
      );
    };
    if (entityId !== selectedId || !document.entityById.has(entityId)) {
      failNative("selection-changed");
      return null;
    }
    const placement = getNativePlacementWorld(document, entityId);
    if (!placement) {
      failNative("no-native-placement");
      return null;
    }
    // Gizmo-Deltas kommen in Metern (Viewer-Welt) — in Modelleinheiten
    // umrechnen (mm-Modelle!).
    const ifcDelta = viewerWorldDeltaToIfcPlacementDelta(
      delta,
      getNativeLengthUnitScale(document),
    );
    const next = updateNativePlacementWorld(document, entityId, {
      x: placement.worldX + ifcDelta.x,
      y: placement.worldY + ifcDelta.y,
      z: placement.worldZ + ifcDelta.z,
    });
    if (next === document) {
      failNative("placement-update-failed");
      return null;
    }
    const label = `Move #${entityId} placement by viewer delta`;
    const pendingKey = `transform:${entityId}`;
    commitDocument(
      next,
      entityId,
      label,
      `fragments.viewerDeltaCommit({ id: ${entityId}, dx: ${delta.x ?? 0}, dy: ${delta.y ?? 0}, dz: ${delta.z ?? 0} });`,
      undefined,
      {
        pendingKey,
      },
    );
    return { label, pendingKey };
  };

  const rotateSelectedPlacement = (
    entityId: number,
    rotation: ViewerRotationChange,
  ) => {
    if (entityId !== selectedId || !document.entityById.has(entityId)) {
      return null;
    }
    const worldAxis = viewerWorldDirectionToIfcPlacementDirection(
      rotation.axis,
    );
    const worldRefDirection = viewerWorldDirectionToIfcPlacementDirection(
      rotation.refDirection,
    );
    const axis = nativeWorldDirectionInPlacementParentFrame(
      document,
      entityId,
      worldAxis,
    );
    const refDirection = nativeWorldDirectionInPlacementParentFrame(
      document,
      entityId,
      worldRefDirection,
    );
    if (!axis || !refDirection) {
      return null;
    }
    const next = updateNativePlacementRotation(document, entityId, {
      axis,
      refDirection,
    });
    if (next === document) {
      logAction(
        `fragments.viewerRotateSkipped({ id: ${entityId}, reason: 'placement-update-failed' });`,
      );
      return null;
    }
    const label = `Rotate #${entityId} placement with viewer gizmo`;
    const pendingKey = `transform:${entityId}`;
    commitDocument(
      next,
      entityId,
      label,
      `fragments.viewerRotateCommit({ id: ${entityId}, rx: ${rotation.rotation.x ?? 0}, ry: ${rotation.rotation.y ?? 0}, rz: ${rotation.rotation.z ?? 0} });`,
      undefined,
      {
        pendingKey,
      },
    );
    return { label, pendingKey };
  };

  useEffect(() => {
    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoDocument();
        else undoDocument();
        return;
      }
      if (commandKey && key === "y") {
        event.preventDefault();
        redoDocument();
        return;
      }
      if (commandKey && key === "o") {
        event.preventDefault();
        void openIfc();
        return;
      }
      if (commandKey && key === "s") {
        event.preventDefault();
        if (!loadingIfcName) {
          saveActiveDocument();
        }
        return;
      }
      if (commandKey && key === ",") {
        event.preventDefault();
        openSettings();
        return;
      }
      if (!commandKey && !event.shiftKey && event.key === "Delete") {
        event.preventDefault();
        requestDeleteEntity(selectedId, "keyboard");
      }
    };
    window.addEventListener("keydown", handleEditorKeyDown);
    return () => window.removeEventListener("keydown", handleEditorKeyDown);
  }, [activeSession, document, selectedId, loadingIfcName]);

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
    dropQueuedMirrorRequests([sessionId]);
    setDocumentSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) {
          return session;
        }
        return requestDocumentViewerLoad(session);
      }),
    );
    logAction(
      `viewer.loadRequested({ file: '${activeSession.document.fileName}' });`,
    );
  };

  const renderStructure = () => (
    <TileContent className="gap-1.5">
      <div className="shrink-0 [&_[role=tablist]]:rounded-md [&_[role=tablist]]:bg-transparent [&_[role=tablist]]:p-0 [&_[role=tab]]:h-6 [&_[role=tab]]:rounded-sm">
        <SegmentedControl
          options={[
            { value: "tree", label: "Baum" },
            { value: "graph", label: "Graph" },
            { value: "groups", label: "Gruppen" },
          ]}
          value={structureMode}
          onChange={(value) => setStructureMode(value as StructureMode)}
        />
      </div>
      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 z-10 size-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          aria-label="Struktur durchsuchen: ID, Klasse, Name, GlobalId"
          placeholder="Struktur durchsuchen …"
          className="h-7 rounded-md pl-6 pr-6 text-[11px] md:text-[11px]"
        />
        {search ? (
          <button
            type="button"
            aria-label="Suche zurücksetzen"
            title="Suche zurücksetzen"
            onClick={() => setSearch("")}
            className="absolute right-0.5 top-0.5 flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-3" />
          </button>
        ) : null}
      </div>
      {structureMode === "tree" ? (
        <StructurePanel
          document={document}
          filteredEntities={filteredEntities}
          revealSelectionNonce={treeRevealNonce}
          search={search}
          selectedId={selectedId}
          selectedIds={batchSelectionIds}
          onAddChild={addChildElement}
          onAddFree={addFreeElement}
          onCenterCamera={(id) => centerViewerCamera(id, "tree")}
          onCreateStructure={() => setStructureDialogOpen(true)}
          onManageGroups={setGroupManagerEntityId}
          onRemove={(id) => requestDeleteEntity(id, "tree")}
          onSelect={selectEntity}
          onSelectMany={selectEntities}
        />
      ) : structureMode === "groups" ? (
        <GroupsPanel
          document={document}
          revealSelectionNonce={treeRevealNonce}
          search={search}
          selectedId={selectedId}
          selectedIds={batchSelectionIds}
          onCenterCamera={(id) => centerViewerCamera(id, "groups")}
          onManageGroups={setGroupManagerEntityId}
          onRemove={(id) => requestDeleteEntity(id, "groups")}
          onRemoveMembership={removeGroupMembership}
          onSelect={selectEntity}
          onSelectMany={selectEntities}
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
          onRemoveNode={(id) => requestDeleteEntity(id, "graph")}
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
        options={INSPECTOR_MODES}
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
        onModeChange={setInspectorMode}
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
        aria-label={`${MOSAIC_TITLES[id]} als eigenes Fenster öffnen`}
        className="mosaic-default-control detach-button"
        title="Als eigenes Fenster öffnen"
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
            <PersistentViewerSlot host={viewerHost} />
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
              cutPlane={viewerCutPlane}
              document={document}
              selectedId={selectedId}
              selectedIds={batchSelectionIds}
              onAddBodyElement={addBodyElement}
              onCombineSelected={combineSelectedBodies}
              onCutPlaneActiveChange={setCutPlaneActive}
              onCutPlaneChange={updateCutPlane}
              onCutPlaneModeChange={setCutPlaneMode}
              onCutPlaneReset={resetCutPlane}
              onLoadSystemCoordinates={loadSystemCoordinateClipboard}
              onRemoveBodyFromSelected={removeBodyFromSelected}
              onSplitSelected={splitSelectedBody}
            />
          </TileContent>
        );
      case "materials":
        return <TileContent><MaterialsPanel key={activeSession.id} document={document} selectedIds={batchSelectionIds}
          onCreate={createLibraryMaterial} onUpdate={editLibraryMaterial} onAssign={assignLibraryMaterial}
          onAppearance={editMaterialAppearance} onProperty={editMaterialProperty} /></TileContent>;
      case "catalog":
        return (
          <TileContent>
            <CatalogPanel
              catalog={catalog}
              catalogKind={catalogKind}
              document={viewerDocument}
              importing={catalogImporting}
              selectedCatalogObjectId={activeCatalogObjectId}
              selectedId={selectedId}
              onChangeCatalogKind={setCatalogKind}
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
      case "pset-batch":
        return (
          <TileContent>
            <PsetBatchPanel
              document={document}
              selectedIds={batchSelectionIds}
              catalogObjectLabel={
                activeCatalogObject
                  ? catalogObjectLabel(activeCatalogObject)
                  : null
              }
              onAddEmptyPset={addPsetToSelection}
              onAddCatalogObject={addCatalogObjectToSelection}
              onAddProperty={addPropertyToSelection}
              onEditValue={editPsetCellValue}
              onSetPropertyType={setPropertyTypeForSelection}
            />
          </TileContent>
        );
      case "attribution":
        return (
          <TileContent>
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
              <p>
                Die IFC-Attribuierung läuft als großes Fenster über dem Layout.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAttributionMode("open")}
              >
                Fenster öffnen
              </Button>
            </div>
          </TileContent>
        );
      case "check":
        return (
          <TileContent>
            <CheckPanel
              document={viewerDocument}
              ids={idsModel}
              idsImporting={idsImporting}
              objectInfoFindings={objectInfoFindings}
              objectInfoIndex={objectInfoIndex}
              selectedId={selectedId}
              onImportIds={importIds}
              onRemoveIds={() => {
                setIdsModel(null);
                logAction("ui.removeIds();");
              }}
              onSelectEntity={selectEntity}
            />
          </TileContent>
        );
      case "diagnostics":
        return (
          <TileContent>
            <DiagnosticsAssistantPanel
              catalog={catalog}
              document={viewerDocument}
              selectedId={selectedId}
              onSetObjectiveReferences={setDiagnosticObjectiveReferences}
              onAddPropertyToSet={addPropertyToSet}
              onApplyObjectInfo={applyDiagnosticObjectInfoDraft}
              onApplyProcedure={applyDiagnosticProcedure}
              onDuplicatePropertySet={duplicatePset}
              onRemovePropertyFromSet={deletePsetProperty}
              onRemovePropertySet={deletePset}
              onRenamePropertySet={renamePset}
              onUpdateProperty={updatePsetProperty}
            />
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
      case "portal":
        return (
          <TileContent>
            <PortalPanel
              document={document}
              getApplyTarget={() => portalApplyTargetRef.current}
              selectedId={selectedId}
              settings={portalSettings}
              tokens={portalTokens}
              onApplyImport={(nextDocument, summary) =>
                commitDocument(
                  nextDocument,
                  portalApplyTargetRef.current.selectedId,
                  summary,
                  `portal.applyImport({ summary: '${summary.replace(/'/g, "\\'")}' });`,
                  undefined,
                )
              }
              onSelectEntity={(id) => selectEntity(id, "portal")}
              onSettingsChange={setPortalSettings}
              onTokensChange={setPortalTokens}
            />
          </TileContent>
        );
      case "vcs":
        return (
          <TileContent>
            <VcsPanel
              auth={vcsAuth}
              documentFileName={activeSession ? document.fileName : null}
              getIfcText={getVcsIfcText}
              hasDocument={Boolean(activeSession)}
              origin={activeSession?.vcsOrigin ?? null}
              settings={vcsSettings}
              onAddFromHub={() => setHubAddOpen(true)}
              onAuthChange={setVcsAuth}
              onLoadIfc={openIfcTextFromVcs}
              onSelectGuids={(guids) => {
                // Issue-Verortung: Objekte per GlobalId im aktiven Dokument
                // auswählen (Mehrfachauswahl, wie Strg-Klick im Viewer).
                if (!activeSession) {
                  return 0;
                }
                const wanted = new Set(guids);
                const ids = activeSession.document.entities
                  .filter(
                    (entity) => entity.globalId && wanted.has(entity.globalId),
                  )
                  .map((entity) => entity.id);
                if (ids.length) {
                  updateActiveSession((session) => ({
                    ...session,
                    selectedId: ids[0],
                    selectedIds: new Set(ids),
                  }));
                }
                return ids.length;
              }}
              onOpenSettings={() => openSettings("hub")}
            />
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
              {MOSAIC_TITLES[id]} ist in einem eigenen Fenster geöffnet.
            </div>
            <Button onClick={() => reattachMosaicView(id)}>
              Zurück ins Hauptfenster
            </Button>
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
      title={MOSAIC_TITLES[id]}
      toolbarControls={renderToolbarControls(id)}
    >
      {renderTileContent(id)}
    </MosaicWindow>
  );

  const closeDocumentSession = (sessionId: string) => {
    const session = documentSessions.find((item) => item.id === sessionId);
    if (!session || documentSessions.length <= 1) {
      return;
    }
    if (
      session.hasUnexportedChanges &&
      !globalThis.confirm(
        `"${session.document.fileName}" hat nicht exportierte Änderungen. Trotzdem schließen?`,
      )
    ) {
      return;
    }
    const remaining = documentSessions.filter((item) => item.id !== sessionId);
    setDocumentSessions(remaining);
    if (activeDocumentId === sessionId && remaining.length) {
      setActiveDocumentId(remaining[0].id);
    }
    logAction(
      `workspace.closeDocument({ file: '${session.document.fileName}' });`,
    );
  };

  const renderDocumentTabs = () => {
    const closable = documentSessions.length > 1;
    return (
      <Tabs
        value={activeSession.id}
        onValueChange={(nextValue) => {
          if (nextValue) {
            setActiveDocumentId(nextValue);
          }
        }}
        className="min-w-0 flex-1"
      >
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 overflow-x-auto overflow-y-hidden">
            <TabsList className="h-7 min-w-max justify-start gap-0.5 bg-transparent p-0">
              {documentSessions.map((session) => (
                // Wrapper statt Button-im-Button: der Schließen-Button liegt
                // als Geschwister absolut über dem Tab (valides HTML, eigener
                // Fokus).
                <span
                  key={session.id}
                  className="group/tab relative inline-flex"
                >
                  <TabsTrigger
                    value={session.id}
                    title={`${session.document.fileName} · ${session.document.schema} · ${session.document.entities.length.toLocaleString("de-DE")} Entitäten`}
                    className={`group h-7 max-w-96 flex-none justify-start gap-1.5 rounded-md pl-2.5 text-xs font-medium transition-colors hover:bg-background/60 data-active:bg-card dark:hover:bg-input/20 ${closable ? "pr-7" : "pr-2.5"}`}
                  >
                    <FileText
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground/60 group-data-active:text-primary"
                    />
                    <span className="min-w-0 truncate">
                      {session.document.fileName}
                    </span>
                    {session.hasUnexportedChanges ? (
                      <span
                        aria-label="Nicht exportierte Änderungen"
                        className="size-1.5 shrink-0 rounded-full bg-warning"
                        title="Nicht exportierte Änderungen"
                      />
                    ) : null}
                  </TabsTrigger>
                  {closable ? (
                    <button
                      aria-label={`${session.document.fileName} schließen`}
                      className="absolute top-1/2 right-1.5 grid size-4.5 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                      title="Schließen"
                      type="button"
                      onClick={() => closeDocumentSession(session.id)}
                    >
                      <X aria-hidden className="size-3" />
                    </button>
                  ) : null}
                </span>
              ))}
            </TabsList>
          </div>
          <IconButton
            aria-label="Weitere IFC-Dateien hinzufügen"
            className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={Boolean(loadingIfcName)}
            size="icon-sm"
            title="Weitere IFC-Dateien hinzufügen"
            variant="ghost"
            onClick={() => void addIfcFiles()}
          >
            <Plus aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </Tabs>
    );
  };

  // Von Startseite UND Arbeitsansicht geteilt: Recovery-Angebot und
  // Statusmeldungen müssen auch auf der Startseite sichtbar sein.
  const recoveryBanner = recoveredDocuments.length ? (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
      <span className="font-medium">
        Nicht exportierte Änderungen aus einer früheren Sitzung gefunden:
      </span>
      <span className="text-muted-foreground">
        {recoveredDocuments
          .map(
            (entry) =>
              `${entry.fileName} (${entry.entityCount.toLocaleString("de-DE")} Entitäten, ${new Date(entry.savedAt).toLocaleString("de-DE")})`,
          )
          .join(" · ")}
      </span>
      <Button
        disabled={recoveryBusy}
        variant="default"
        onClick={() => void restoreRecoveredDocuments()}
      >
        {recoveryBusy ? "Stellt wieder her…" : "Wiederherstellen"}
      </Button>
      <Button
        disabled={recoveryBusy}
        onClick={() => void discardRecoveredDocuments()}
      >
        Verwerfen
      </Button>
    </div>
  ) : null;

  const statusAlertBar = statusAlert ? (
    <div
      className={`flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs ${
        statusAlert.tone === "danger"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border/70 bg-muted/40 text-muted-foreground"
      }`}
      role={statusAlert.tone === "danger" ? "alert" : "status"}
    >
      <span className="min-w-0 flex-1 break-words">{statusAlert.message}</span>
      <button
        aria-label="Meldung schließen"
        className="shrink-0 rounded-sm p-0.5 hover:bg-foreground/10"
        type="button"
        onClick={() => setStatusAlert(null)}
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  ) : null;

  if (showStartPage) {
    return (
      <div className="start-page-workspace relative isolate flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
        <UpdateNotification
          hidden={settingsOpen}
          onOpenSettings={() => openSettings("updates")}
        />
        <WindowTitlebar>
          <div data-tauri-drag-region className="min-w-8 flex-1 self-stretch" />
          <IconButton
            aria-label="Einstellungen"
            size="icon-sm"
            title="Einstellungen · Strg+,"
            variant="ghost"
            onClick={() => openSettings()}
          >
            <Settings aria-hidden className="size-4" />
          </IconButton>
        </WindowTitlebar>
        {recoveryBanner}
        {statusAlertBar}
        {settingsOpen ? (
          <Suspense fallback={null}>
            <SettingsDialog
              defaultSection={settingsSection}
              open={settingsOpen}
              portalSettings={portalSettings}
              vcsAuth={vcsAuth}
              vcsSettings={vcsSettings}
              onOpenChange={setSettingsOpen}
              onPortalSettingsChange={setPortalSettings}
              onVcsAuthChange={setVcsAuth}
              attributionSettings={attributionSettings}
              onAttributionSettingsChange={setAttributionSettings}
              onVcsSettingsChange={setVcsSettings}
            />
          </Suspense>
        ) : null}
        <StartPage
          auth={vcsAuth}
          loadingName={loadingIfcName}
          settings={vcsSettings}
          onAuthChange={setVcsAuth}
          onCreateNewIfc={(draft) => void createNewIfcDocument(draft)}
          onOpenDroppedFiles={(files) => void openDroppedIfcFiles(files)}
          recentFiles={recentIfcFiles}
          onOpenFilePicker={() => void openIfc()}
          onOpenHubDocuments={openHubDocuments}
          onOpenRecentFile={(entry) => void openRecentIfcFile(entry)}
          onSettingsChange={setVcsSettings}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <UpdateNotification
        hidden={settingsOpen}
        onOpenSettings={() => openSettings("updates")}
      />
      <header className="relative z-20 flex shrink-0 flex-col border-b border-border/70 bg-card/95 shadow-sm backdrop-blur">
        <WindowTitlebar>
          <img
            alt=""
            aria-hidden
            data-tauri-drag-region
            className="size-5 shrink-0 rounded-[5px] select-none"
            draggable={false}
            src="/brand/ifcnative-icon-03-blueprint.svg"
          />
          <WorkspaceMenubar
            activeFileName={activeSession.document.fileName}
            activeWorkspaceId={activeWorkspace?.id ?? DEFAULT_WORKSPACE_ID}
            canCloseActiveDocument={documentSessions.length > 1}
            closedViewIds={closedMosaicIds}
            customWorkspaces={customWorkspaces}
            loading={Boolean(loadingIfcName)}
            redoSummary={redoStack.at(-1)?.summary}
            undoSummary={undoStack.at(-1)?.summary}
            onAddIfcFiles={() => void addIfcFiles()}
            onAddIfcFromHub={() => setHubAddOpen(true)}
            onCloseActiveDocument={() => closeDocumentSession(activeSession.id)}
            onCreateWorkspace={createWorkspaceFromCurrentLayout}
            onDeleteWorkspace={deleteActiveWorkspace}
            onExportIfc={saveActiveDocument}
            onOpenIfc={() => void openIfc()}
            onOpenSettings={() => openSettings()}
            onRedo={redoDocument}
            onResetLayout={resetMosaicLayout}
            onSaveWorkspace={saveActiveWorkspace}
            onSelectWorkspace={selectWorkspace}
            onToggleView={toggleMosaicView}
            onUndo={undoDocument}
          />
          <div data-tauri-drag-region className="min-w-8 flex-1 self-stretch" />
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              aria-label="Rückgängig"
              disabled={!undoStack.length}
              size="icon-sm"
              title={
                undoStack.length
                  ? `Rückgängig: ${undoStack.at(-1)?.summary} · Strg+Z`
                  : "Nichts rückgängig zu machen"
              }
              variant="ghost"
              onClick={undoDocument}
            >
              <Undo2 aria-hidden className="size-3.5" />
            </IconButton>
            <IconButton
              aria-label="Wiederholen"
              disabled={!redoStack.length}
              size="icon-sm"
              title={
                redoStack.length
                  ? `Wiederholen: ${redoStack.at(-1)?.summary} · Strg+Umschalt+Z`
                  : "Nichts zu wiederholen"
              }
              variant="ghost"
              onClick={redoDocument}
            >
              <Redo2 aria-hidden className="size-3.5" />
            </IconButton>
            <div className="mx-1 h-4 w-px bg-border/70" />
            <IconButton
              aria-label="Einstellungen"
              size="icon-sm"
              title="Einstellungen · Strg+,"
              variant="ghost"
              onClick={() => openSettings()}
            >
              <Settings aria-hidden className="size-4" />
            </IconButton>
          </div>
        </WindowTitlebar>
        <div className="flex items-center bg-muted/50 px-1.5 py-1">
          {renderDocumentTabs()}
          <AttributionHeaderChip
            mode={attributionMode}
            status={
              attributionStatus && attributionStatus.document !== document
                ? { ...attributionStatus, pending: true }
                : attributionStatus
            }
            onToggle={() =>
              setAttributionMode((current) =>
                current === "open" ? "collapsed" : "open",
              )
            }
          />
        </div>
      </header>

      {recoveryBanner}

      {statusAlertBar}

      <main className="min-h-0 flex-1 overflow-hidden p-1">
        <Mosaic<MosaicViewId>
          className="ifcnative-mosaic"
          renderTile={renderMosaicTile}
          resize={{ minimumPaneSizePercentage: 12 }}
          value={mosaicValue}
          zeroStateView={
            <div className="flex h-full items-center justify-center">
              <Button variant="default" onClick={resetMosaicLayout}>
                Layout wiederherstellen
              </Button>
            </div>
          }
          onChange={setMosaicValue}
        />
      </main>

      {/* Viewer dauerhaft gemountet; die Mosaic-Kachel zeigt nur den Host. */}
      {createPortal(
        <Suspense
          fallback={
            <div className="p-4 text-xs text-muted-foreground">
              3D-Viewer lädt…
            </div>
          }
        >
          <ThatOpenViewer
            activeDocumentId={activeSession.id}
            activeModelDeferredReason={activeSession.viewerModelDeferredReason}
            activeModelFileName={activeSession.document.fileName}
            activeModelLoaded={activeSession.viewerModelLoadRequested}
            combineSelectionCount={viewerCombineCount}
            cutPlane={viewerCutPlane}
            editCapabilities={viewerEditCapabilities}
            focusRequest={viewerFocusRequest}
            mirrorRequests={viewerMirrorRequests}
            models={viewerModels}
            pendingViewerChanges={activeSession.pendingViewerChanges.map(
              (change) => change.label,
            )}
            selectedEntityIds={batchSelectionIds}
            onLog={logAction}
            onAddBodyAt={addBodyAtViewerPoint}
            onCombineSelected={() =>
              combineSelectedBodies("Kombiniertes Teil", true)
            }
            onCutPlaneActiveChange={setCutPlaneActive}
            onCutPlaneAxisCycle={cycleCutPlaneAxis}
            onCutPlaneChange={applyViewerCutPlaneChange}
            onCutPlaneModeChange={setCutPlaneMode}
            onDeleteBody={deleteBodyForEntity}
            onDuplicateBody={duplicateBodyForEntity}
            onChangeMaterial={() => restoreMosaicView("materials")}
            onLoadActiveModel={requestActiveViewerLoad}
            onMirrorApplied={applyViewerMirrorResult}
            onMoveSelected={nudgeSelectedPlacement}
            onPickCoordinates={storePickedCoordinates}
            onRecalculateModel={recalculateViewerModel}
            onRotateSelected={rotateSelectedPlacement}
            onViewerMounted={recalculateStaleViewerSessions}
            onSelect={selectEntity}
            onSplitSelected={splitSelectedBody}
          />
        </Suspense>,
        viewerHost.element,
      )}

      {attributionMode !== "closed" ? (
        <Suspense
          fallback={
            <div className="fixed bottom-4 right-4 rounded bg-card p-3">
              Attribuierung lädt…
            </div>
          }
        >
          <AttributionOverlay
            collapsed={attributionMode === "collapsed"}
            status={
              attributionStatus && attributionStatus.document !== document
                ? { ...attributionStatus, pending: true }
                : attributionStatus
            }
            onCollapse={() => setAttributionMode("collapsed")}
            onClose={() => setAttributionMode("closed")}
          >
            <AttributionPanel
              activeSessionId={activeSession.id}
              coordinateClipboard={coordinateClipboard}
              document={viewerDocument}
              selectedId={selectedId}
              sessions={documentSessions.map((session) => ({
                id: session.id,
                fileName: session.document.fileName,
                document: session.document,
              }))}
              onSelectEntity={selectEntity}
              bauteilPick={attributionPick}
              onStartBauteilPick={(pick) => {
                setAttributionPick(pick);
                // Zum Klicken im Viewer muss das Fenster aus dem Weg; nach dem Treffer öffnet es sich wieder.
                if (pick) setAttributionMode("collapsed");
              }}
              onShowInViewer={(id) => {
                selectEntity(id);
                setAttributionMode("collapsed");
              }}
              onStatus={setAttributionStatus}
              onOpenSchemaSettings={() => openSettings("attribution-schema")}
              schemaFileName={attributionSettings.schemaFile?.name ?? null}
              schemaRevision={schemaRevision}
              onCommit={(mutate, summary, log) => {
                const {
                  document: next,
                  createdEntityIds: created,
                  movedEntityIds: moved,
                } = unwrapMutation(batchNativeDocument(document, mutate));
                if (next === document) return;
                if (!created.length && !moved.length) {
                  commitDocument(next, selectedId, summary, log);
                  return;
                }
                // Neue oder verschobene Marker sofort im Viewer zeigen: exakte Geometrie als Mini-IFC nachkonvertieren (wie der Baukasten).
                const affected = [...created, ...moved];
                const subset = extractNativeSubsetIfc(next, affected);
                commitDocument(
                  next,
                  created[0] ?? selectedId,
                  summary,
                  log,
                  undefined,
                  {
                    viewerMirror: subset
                      ? {
                          entityIds: affected,
                          kind: "reconvert-subset",
                          replacedEntityIds: moved,
                          subsetIfcText: subset.text,
                        }
                      : undefined,
                  },
                );
              }}
            />
          </AttributionOverlay>
        </Suspense>
      ) : null}

      <DeleteEntityDialog
        entity={deleteRequest?.entity ?? null}
        plan={deleteRequest?.plan ?? null}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={confirmDeleteEntity}
      />

      {structureDialogOpen ? (
        <Suspense fallback={null}>
          <SpatialStructureDialog
            defaultProjectName={
              document.fileName.replace(/\.ifc$/i, "") || "Projekt"
            }
            hasProject={Boolean(
              document.entitiesByType.get("IFCPROJECT")?.length,
            )}
            open={structureDialogOpen}
            orphanCount={
              structureDialogOpen
                ? listNativeUnassignedProductIds(document).length
                : 0
            }
            onCreate={applySpatialStructure}
            onOpenChange={setStructureDialogOpen}
          />
        </Suspense>
      ) : null}

      <SaveDialog
        canCommit={Boolean(vcsAuth)}
        fileName={document.fileName}
        open={saveDialogOpen}
        origin={activeSession.vcsOrigin}
        onCommit={commitActiveDocumentToHub}
        onExportLocal={exportIfc}
        onOpenChange={setSaveDialogOpen}
      />

      <SettingsDialog
        defaultSection={settingsSection}
        open={settingsOpen}
        portalSettings={portalSettings}
        vcsAuth={vcsAuth}
        vcsSettings={vcsSettings}
        onOpenChange={setSettingsOpen}
        onPortalSettingsChange={setPortalSettings}
        onVcsAuthChange={setVcsAuth}
        attributionSettings={attributionSettings}
        onAttributionSettingsChange={setAttributionSettings}
        onVcsSettingsChange={setVcsSettings}
      />

      {hubAddOpen ? (
        <Suspense fallback={null}>
          <HubAddDialog
            auth={vcsAuth}
            busy={Boolean(loadingIfcName)}
            open={hubAddOpen}
            settings={vcsSettings}
            onAddDocuments={addHubDocuments}
            onAuthChange={setVcsAuth}
            onOpenChange={setHubAddOpen}
            onSettingsChange={setVcsSettings}
          />
        </Suspense>
      ) : null}

      {groupManagerEntityId != null ? (
        <Suspense fallback={null}>
          <GroupManagerDialog
            document={document}
            entity={
              groupManagerEntityId != null
                ? (document.entityById.get(groupManagerEntityId) ?? null)
                : null
            }
            onAssignToGroup={assignEntityToGroup}
            onClose={() => setGroupManagerEntityId(null)}
            onCreateGroup={createGroupForEntity}
            onRemoveMembership={removeGroupMembership}
          />
        </Suspense>
      ) : null}

      <footer className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border/70 bg-card px-3 text-[11px] text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground/80">
          {document.schema}
        </span>
        <span className="shrink-0">
          {document.entities.length.toLocaleString("de-DE")} Entitäten
        </span>
        {selectedIds.size > 1 ? (
          <span className="shrink-0 text-primary">
            {selectedIds.size.toLocaleString("de-DE")} ausgewählt
          </span>
        ) : selectedEntity ? (
          <span className="min-w-0 truncate">
            #{selectedEntity.id} {selectedEntity.type}
            {selectedEntity.name ? ` · ${selectedEntity.name}` : ""}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {loadingIfcName ? (
            <span className="text-primary">Lädt {loadingIfcName}…</span>
          ) : null}
          {activeSession.vcsOrigin ? (
            <VcsOriginStatus
              auth={vcsAuth}
              origin={activeSession.vcsOrigin}
              settings={vcsSettings}
            />
          ) : null}
          {hasUnexportedChanges ? (
            <span className="flex items-center gap-1 text-warning-foreground dark:text-warning">
              <span className="size-1.5 rounded-full bg-warning" />
              Nicht exportiert
            </span>
          ) : (
            <span>Exportiert</span>
          )}
          <Select
            value={String(uiScale)}
            onValueChange={(next) => {
              if (next) {
                setUiScale(Number(next) as UiScale);
              }
            }}
          >
            <SelectTrigger
              aria-label="Schriftgröße"
              title="Globale Schriftgröße"
              className="h-5 min-w-0 gap-1 rounded border-transparent bg-transparent px-1 py-0 text-[11px] text-muted-foreground shadow-none hover:border-input hover:text-foreground [&_svg]:size-3"
            >
              <SelectValue>{uiScale} %</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" className="w-auto min-w-24">
              {UI_SCALE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} %
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      </footer>
      {[...detachedViews].map((id) => (
        <ChildWindow
          key={id}
          title={`IFCnative – ${MOSAIC_TITLES[id]}`}
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

function TileContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <Suspense
        fallback={
          <div className="p-4 text-xs text-muted-foreground">Lädt…</div>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}

type PersistentViewerHost = {
  element: HTMLDivElement;
  park: () => void;
  dispose: () => void;
};

/**
 * Dauerhafter DOM-Knoten für den 3D-Viewer. Solange keine Kachel ihn zeigt,
 * steht er außerhalb des sichtbaren Bereichs in einem Parkplatz mit echter
 * Größe (kein display:none), damit Renderer und ResizeObserver nie mit 0×0
 * arbeiten und der WebGL-Kontext erhalten bleibt.
 */
function createPersistentViewerHost(): PersistentViewerHost {
  const element = globalThis.document.createElement("div");
  element.className = "ifcnative-viewer-host";
  const parking = globalThis.document.createElement("div");
  parking.className = "ifcnative-viewer-parking";
  parking.setAttribute("aria-hidden", "true");
  parking.append(element);
  globalThis.document.body.append(parking);
  return {
    element,
    park: () => {
      if (element.parentElement !== parking) {
        parking.append(element);
      }
    },
    dispose: () => {
      parking.remove();
    },
  };
}

function PersistentViewerSlot({ host }: { host: PersistentViewerHost }) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) {
      return;
    }
    slot.append(host.element);
    return () => {
      host.park();
    };
  }, [host]);
  return <div ref={slotRef} className="flex min-h-0 flex-1 flex-col" />;
}

function pickIfcFile() {
  return pickIfcFiles(false).then((files) => files[0]);
}

function pickIfcFiles(multiple: boolean) {
  if ("__TAURI_INTERNALS__" in globalThis) return pickDesktopIfcAssets(multiple);
  return pickFiles(
    ".ifc,application/x-step,text/plain,application/octet-stream",
    multiple,
  ).then((files) => files.map((file) => ({ file, name: file.name })));
}

async function pickCatalogFile() {
  const [file] = await pickFiles(
    ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
  );
  return file ? { file, name: file.name } : undefined;
}

async function pickIdsFile() {
  const [file] = await pickFiles(".ids,.xml,application/xml,text/xml");
  return file ? { file, name: file.name } : undefined;
}

function removeFromSet<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

/** Lesbaren Wert einer einfachen Property/Quantity aus dem Entity ziehen. */
function readSimplePropertyValueText(entity?: NativeIfcEntity) {
  if (!entity) {
    return "";
  }
  if (entity.type.startsWith("IFCQUANTITY")) {
    const raw = (entity.args[3] ?? "").trim();
    return raw === "$" ? "" : raw;
  }
  const raw = (entity.args[2] ?? "").trim();
  if (!raw || raw === "$") {
    return "";
  }
  const match = raw.match(/^[A-Za-z0-9_]+\(([\s\S]*)\)$/);
  const inner = match ? match[1].trim() : raw;
  if (/^\.[TF]\.$/i.test(inner)) {
    return inner.toUpperCase() === ".T." ? "True" : "False";
  }
  return inner.replace(/^'([\s\S]*)'$/, "$1");
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

function removeMosaicView<T extends string | number>(
  node: MosaicNode<T> | null,
  id: T,
): MosaicNode<T> | null {
  if (node == null) {
    return null;
  }
  if (typeof node !== "object") {
    return node === id ? null : node;
  }
  const first = removeMosaicView(node.first, id);
  const second = removeMosaicView(node.second, id);
  if (first == null) {
    return second;
  }
  if (second == null) {
    return first;
  }
  if (first === node.first && second === node.second) {
    return node;
  }
  return { ...node, first, second };
}

function formatCoordinate(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function readBodyCoordinate(value: string | undefined) {
  return parseDecimalInput(value);
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
