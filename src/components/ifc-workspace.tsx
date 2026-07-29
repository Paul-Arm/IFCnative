import { Input } from "@/components/ui/input";
import { PanelTopOpen } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_CONTROLS_WITHOUT_CREATION,
  Mosaic,
  MosaicWindow,
  type MosaicPath,
} from "react-mosaic-component";

import {
  buildObjectInfoIndex,
  catalogObjectLabel,
  getNativePlacement,
  resolveNativeMovableProductId,
  validateObjectInfoIndex,
} from "@/ifc";
import { type NativeGraphPreset } from "@/ifc/nativeGraph";

import { Button, SegmentedControl, typeOption } from "@/components/ifc-workspace/ui";
import { useUiScale } from "@/hooks/use-ui-scale";
import { ChildWindow } from "./child-window";
import { BuilderPanel } from "./ifc-workspace/BuilderPanel";
import { CatalogPanel, CatalogReviewPanel } from "./ifc-workspace/CatalogPanel";
import {
  ENTITY_TYPES,
  MOSAIC_TITLES,
  RELATION_TYPES,
} from "./ifc-workspace/constants";
import { DiagnosticsAssistantPanel } from "./ifc-workspace/DiagnosticsAssistantPanel";
import { DeleteEntityDialog } from "./ifc-workspace/DeleteEntityDialog";
import { GraphPanel } from "./ifc-workspace/GraphPanel";
import {
  INSPECTOR_MODES,
  InspectorPanel,
  ResourceControlsPanel,
  ResourceReferencesPanel,
} from "./ifc-workspace/InspectorPanel";
import { ObjectInfoPanel } from "./ifc-workspace/ObjectInfoPanel";
import { PortalPanel } from "./ifc-workspace/PortalPanel";
import { PortalSettingsPanel } from "./ifc-workspace/PortalSettingsPanel";
import { PsetBatchPanel } from "./ifc-workspace/PsetBatchPanel";
import { StructurePanel } from "./ifc-workspace/StructurePanel";
import { NotesPanel, RecentFilesPanel } from "./ifc-workspace/WorkspacePanels";

import { useBatchPsetActions } from "./ifc-workspace/actions/useBatchPsetActions";
import { useCatalogActions } from "./ifc-workspace/actions/useCatalogActions";
import { useEntityDeletion } from "./ifc-workspace/actions/useEntityDeletion";
import { useGeometryActions } from "./ifc-workspace/actions/useGeometryActions";
import { usePropertyActions } from "./ifc-workspace/actions/usePropertyActions";
import { useRelationshipActions } from "./ifc-workspace/actions/useRelationshipActions";
import { useResourceActions } from "./ifc-workspace/actions/useResourceActions";
import { WorkspaceHeader } from "./ifc-workspace/components/WorkspaceHeader";
import { WorkspaceStatusBar } from "./ifc-workspace/components/WorkspaceStatusBar";
import { useCatalog } from "./ifc-workspace/hooks/useCatalog";
import { useDesktopIntegration } from "./ifc-workspace/hooks/useDesktopIntegration";
import { useIfcFileActions } from "./ifc-workspace/hooks/useIfcFileActions";
import { useWorkspaceLayout } from "./ifc-workspace/hooks/useWorkspaceLayout";
import { useWorkspacePersistence } from "./ifc-workspace/hooks/useWorkspacePersistence";
import { addToSet, removeFromSet } from "./ifc-workspace/lib/collections";
import { formatCoordinate, parseCoordinateClipboardText } from "./ifc-workspace/lib/coordinates";
import { isEditableShortcutTarget } from "./ifc-workspace/lib/dom";
import { matchesEntitySearch } from "./ifc-workspace/lib/entities";
import { useDocumentSessions } from "./ifc-workspace/session/useDocumentSessions";
import type {
  CoordinateClipboard,
  InspectorMode,
  MosaicViewId,
  StructureMode,
} from "./ifc-workspace/types";
import ThatOpenViewer from "./that-open-viewer";
import type { ViewerCoordinatePick } from "./that-open-viewer.types";

export default function IfcWorkspace() {
  const logAction = (code: string) => {
    if (import.meta.env.DEV) {
      console.debug(`${new Date().toLocaleTimeString()}  ${code}`);
    }
  };

  const layout = useWorkspaceLayout(logAction);
  const persistence = useWorkspacePersistence({
    activeWorkspaceId: layout.activeWorkspaceId,
    customWorkspaces: layout.customWorkspaces,
  });

  const [structureMode, setStructureMode] = useState<StructureMode>("tree");
  const [treeRevealNonce, setTreeRevealNonce] = useState(0);
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("overview");
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
  const [coordinateClipboard, setCoordinateClipboard] =
    useState<CoordinateClipboard | null>(null);
  const { scale: uiScale, setScale: setUiScale } = useUiScale();

  const sessions = useDocumentSessions({
    logAction,
    onBeforeHistoryRestore: () => cancelDeleteEntity(),
  });
  const {
    activeSession,
    batchSelectionIds,
    commitDocument,
    document,
    documentSessions,
    selectedId,
    selectedIds,
  } = sessions;
  const graphAnchorId = activeSession.graphAnchorId;
  const graphPositions = activeSession.graphPositions;
  const undoStack = activeSession.undoStack ?? [];
  const redoStack = activeSession.redoStack ?? [];

  const catalogState = useCatalog({
    document,
    selectedId,
    logAction,
    onCatalogImported: () => layout.showMosaicViews(["catalog", "catalog-review"]),
  });
  const { activeCatalogObject, activeCatalogObjectId, catalog, catalogFindings } =
    catalogState;

  // Gemeinsamer Kontext aller Edit-Aktionen (siehe actions/context.ts).
  const editContext = { commitDocument, document, logAction, selectedId };
  const geometryActions = useGeometryActions(editContext);
  const propertyActions = usePropertyActions(editContext);
  const resourceActions = useResourceActions(editContext);
  const relationshipActions = useRelationshipActions({
    ...editContext,
    graphPositions,
    setGraphCollapsed: sessions.setGraphCollapsed,
    setGraphExpanded: sessions.setGraphExpanded,
    setGraphPinned: sessions.setGraphPinned,
  });
  const batchPsetActions = useBatchPsetActions({
    ...editContext,
    activeCatalogObject,
    batchSelectionIds,
  });
  const catalogActions = useCatalogActions({
    ...editContext,
    setSelectedCatalogObjectId: catalogState.setSelectedCatalogObjectId,
  });
  const {
    cancelDeleteEntity,
    confirmDeleteEntity,
    deleteRequest,
    requestDeleteEntity,
  } = useEntityDeletion({
    ...editContext,
    activeSessionId: activeSession.id,
    graphAnchorId,
    graphPositions,
    setGraphAnchorId: sessions.setGraphAnchorId,
    setGraphCollapsed: sessions.setGraphCollapsed,
    setGraphExpanded: sessions.setGraphExpanded,
    setGraphPinned: sessions.setGraphPinned,
  });

  const fileActions = useIfcFileActions({
    activeSession,
    appendSessions: sessions.appendSessions,
    logAction,
    rememberRecentIfc: persistence.rememberRecentIfc,
    replaceDocument: sessions.replaceDocument,
  });
  const { loadingIfcName } = fileActions;

  useDesktopIntegration({
    catalogImporting: catalogState.catalogImporting,
    closedMosaicIds: layout.closedMosaicIds,
    hasCatalog: Boolean(catalog),
    loadingIfcName,
    onAddIfc: () => void fileActions.addIfcFiles(),
    onExportIfc: () => void fileActions.exportIfc(),
    onImportCatalog: () => void catalogState.importCatalog(),
    onLoadSample: fileActions.loadSample,
    onOpenIfc: () => void fileActions.openIfc(),
    onResetLayout: layout.resetMosaicLayout,
    onRestoreWindow: layout.restoreMosaicView,
  });

  const selectedEntity =
    document.entityById.get(selectedId) ?? document.entities[0];
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
  const objectInfoIndex = useMemo(
    () => buildObjectInfoIndex(document),
    [document],
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
    if (!normalizedSearch) {
      return document.entities.slice(0, 120);
    }
    return searchMatchedEntities.slice(0, 160);
  }, [document.entities, normalizedSearch, searchMatchedEntities]);

  const selectEntity = (
    id: number,
    source = "ui",
    globalId?: string,
    documentId = activeSession.id,
  ) => {
    const selectionSession = documentSessions.find(
      (session) => session.id === documentId,
    );
    if (!selectionSession) {
      return;
    }
    const selectionDocument = selectionSession.document;
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
    if (source === "thatopen") {
      setStructureMode("tree");
      setSearch("");
      setTreeRevealNonce((current) => current + 1);
    }
    if (documentId !== activeSession.id) {
      sessions.setDocumentSessions((current) =>
        current.map((session) =>
          session.id === documentId
            ? {
                ...session,
                selectedId: resolvedId,
                selectedIds: new Set([resolvedId]),
              }
            : session,
        ),
      );
      sessions.setActiveDocumentId(documentId);
    } else {
      sessions.setSelectedId(resolvedId);
      sessions.setSelectedIds(new Set([resolvedId]));
    }
    if (source === "graph") {
      sessions.setGraphAnchorId(resolvedId);
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
    const valid = ids.filter((id) => document.entityById.has(id));
    if (valid.length === 0) {
      return;
    }
    const nextPrimary = valid.includes(selectedId)
      ? selectedId
      : valid[valid.length - 1];
    sessions.updateActiveSession((session) => ({
      ...session,
      selectedId: nextPrimary,
      selectedIds: new Set(valid),
    }));
    if (valid.length > 1) {
      logAction(`tree.selectMany({ count: ${valid.length} });`);
    }
  };

  const revealGraphWarningEntity = (id: number) => {
    const entity = document.entityById.get(id);
    if (!entity) {
      return;
    }
    sessions.setSelectedId(id);
    sessions.setGraphAnchorId(id);
    sessions.setGraphCollapsed((current) => removeFromSet(current, id));
    sessions.setGraphExpanded((current) => addToSet(current, id));
    setGraphFocusRequest({
      entityId: id,
      nonce: Date.now(),
    });
    logAction(`graph.warning.reveal({ id: ${id}, class: '${entity.type}' });`);
  };

  const centerViewerCamera = (id = selectedId, source = "ui") => {
    const entity = document.entityById.get(id);
    if (!entity) {
      return;
    }
    sessions.setSelectedId(id);
    if (!activeSession.viewerModelLoadRequested) {
      sessions.requestActiveViewerLoad();
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

  // Punkt-Taste: Kamera auf die aktuelle Auswahl zentrieren.
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

  // Strg+Z / Strg(+Umschalt)+Z / Strg+Y / Entf auf Dokument-Ebene.
  useEffect(() => {
    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) sessions.redoDocument();
        else sessions.undoDocument();
        return;
      }
      if (commandKey && key === "y") {
        event.preventDefault();
        sessions.redoDocument();
        return;
      }
      if (!commandKey && !event.shiftKey && event.key === "Delete") {
        event.preventDefault();
        requestDeleteEntity(selectedId, "keyboard");
      }
    };
    window.addEventListener("keydown", handleEditorKeyDown);
    return () => window.removeEventListener("keydown", handleEditorKeyDown);
  }, [activeSession, document, selectedId]);

  // Portal-Importe laufen asynchron (Netz-Roundtrip) und übernehmen ihr
  // Ergebnis gegen den zum Anwendungszeitpunkt aktuellen Stand statt gegen
  // den Klick-Zeitpunkt — sonst gingen zwischenzeitliche Änderungen verloren.
  const portalApplyTargetRef = useRef({ document, selectedId });
  portalApplyTargetRef.current = { document, selectedId };

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

  const renderStructure = () => (
    <TileContent>
      <SegmentedControl
        options={[
          { value: "tree", label: "Baum" },
          { value: "graph", label: "Graph" },
        ]}
        value={structureMode}
        onChange={(value) => setStructureMode(value as StructureMode)}
      />
      <Input
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        placeholder="Suche: ID, Klasse, Name, GlobalId"
        className="h-8 shrink-0"
      />
      {structureMode === "tree" ? (
        <StructurePanel
          document={document}
          filteredEntities={filteredEntities}
          revealSelectionNonce={treeRevealNonce}
          search={search}
          selectedId={selectedId}
          onAddChild={geometryActions.addChildElement}
          onCenterCamera={(id) => centerViewerCamera(id, "tree")}
          onRemove={(id) => requestDeleteEntity(id, "tree")}
          onSelect={selectEntity}
          onSelectMany={selectEntities}
        />
      ) : (
        <GraphPanel
          anchorId={graphAnchorId}
          classOptions={ENTITY_TYPES.map(typeOption)}
          collapsed={activeSession.graphCollapsed}
          depth={graphDepth}
          document={document}
          expanded={activeSession.graphExpanded}
          focusRequest={graphFocusRequest}
          pinned={activeSession.graphPinned}
          positions={graphPositions}
          preset={graphPreset}
          relationshipOptions={RELATION_TYPES.map(typeOption)}
          relationshipTypeFilters={graphRelationshipTypes}
          search={search}
          searchMatches={searchMatchedEntities}
          selectedId={selectedId}
          onConnectNodes={relationshipActions.connectGraphNodes}
          onCreateNodeFromConnection={relationshipActions.addGraphConnectedNode}
          onDepth={setGraphDepth}
          onLog={logAction}
          onPasteNodes={relationshipActions.pasteGraphNodes}
          onPreset={setGraphPreset}
          onPositions={sessions.setGraphPositions}
          onRemoveNode={(id) => requestDeleteEntity(id, "graph")}
          onRemoveRelationship={relationshipActions.deleteRelationship}
          onRelationshipTypeFilters={(filters) =>
            setGraphRelationshipTypes(new Set(filters))
          }
          onRevealWarningEntity={revealGraphWarningEntity}
          onSelect={selectEntity}
          onToggleChildren={(id, loaded) => {
            if (loaded) {
              sessions.setGraphExpanded((current) => removeFromSet(current, id));
              sessions.setGraphCollapsed((current) => addToSet(current, id));
            } else {
              sessions.setGraphCollapsed((current) => removeFromSet(current, id));
              sessions.setGraphExpanded((current) => addToSet(current, id));
            }
            logAction(`graph.children({ id: ${id}, loaded: ${!loaded} });`);
          }}
          onTogglePin={(id, point) => {
            sessions.setGraphPinned((current) => {
              const pinning = !current.has(id);
              const next = current.has(id)
                ? removeFromSet(current, id)
                : addToSet(current, id);
              if (pinning && point) {
                sessions.setGraphPositions((currentPositions) => {
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
              editCapabilities={viewerEditCapabilities}
              focusRequest={viewerFocusRequest}
              mirrorRequest={sessions.viewerMirrorRequest}
              models={viewerModels}
              pendingViewerChanges={activeSession.pendingViewerChanges.map(
                (change) => change.label,
              )}
              onLog={logAction}
              onLoadActiveModel={sessions.requestActiveViewerLoad}
              onMirrorApplied={sessions.applyViewerMirrorResult}
              onMoveSelected={geometryActions.nudgeSelectedPlacement}
              onPickCoordinates={storePickedCoordinates}
              onRecalculateModel={sessions.recalculateViewerModel}
              onRotateSelected={geometryActions.rotateSelectedPlacement}
              onSelect={selectEntity}
            />
          </TileContent>
        );
      case "inspector":
        return (
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
              document={document}
              mode={inspectorMode}
              objectInfoFindings={objectInfoFindings}
              objectInfoIndex={objectInfoIndex}
              selectedId={selectedId}
              onAddGroupAssignment={resourceActions.addGroupAssignment}
              onAddMaterial={resourceActions.addMaterial}
              onAddMaterialConstituentSet={
                resourceActions.addMaterialConstituentSet
              }
              onAddMaterialLayerSet={resourceActions.addMaterialLayerSet}
              onAddMaterialLayerSetUsage={
                resourceActions.addMaterialLayerSetUsage
              }
              onAddMaterialProfileSet={resourceActions.addMaterialProfileSet}
              onAddMaterialProfileSetUsage={
                resourceActions.addMaterialProfileSetUsage
              }
              onAddMaterialStyle={resourceActions.addMaterialStyle}
              onAddMaterialWithProperties={
                resourceActions.addMaterialWithProperties
              }
              onAssignType={resourceActions.assignType}
              onAssignBodyToSelected={geometryActions.assignBodyToSelected}
              onAddEmptyPset={propertyActions.addEmptyPset}
              onAddPropertyToSet={propertyActions.addPropertyToSet}
              onAddQuantity={propertyActions.addQuantity}
              onAddUnit={propertyActions.addUnit}
              onApplyCatalogFindings={catalogActions.applyCatalogFindings}
              onAddRelationship={relationshipActions.addRelationship}
              onDuplicatePropertySet={propertyActions.duplicatePset}
              onRemoveRelationship={relationshipActions.deleteRelationship}
              onRemovePropertyFromSet={propertyActions.deletePsetProperty}
              onRemovePropertySet={propertyActions.deletePset}
              onSaveEdit={geometryActions.saveSelectedEdit}
              onMovePlacement={geometryActions.moveSelectedPlacement}
              onRenamePropertySet={propertyActions.renamePset}
              onSelectEntity={selectEntity}
              onUpdateProperty={propertyActions.updatePsetProperty}
              onUpdateRelationship={relationshipActions.editRelationship}
            />
          </TileContent>
        );
      case "resource-references":
        return (
          <TileContent>
            <ResourceReferencesPanel
              document={document}
              selectedId={selectedId}
              onAddClassification={resourceActions.addClassification}
              onAddDocumentReference={resourceActions.addDocumentReference}
              onAddLibraryReference={resourceActions.addLibraryReference}
              onRemoveAssociation={resourceActions.removeResourceAssociation}
              onUpdateEntityArgs={resourceActions.updateResourceEntityArgs}
            />
          </TileContent>
        );
      case "resource-controls":
        return (
          <TileContent>
            <ResourceControlsPanel
              document={document}
              selectedId={selectedId}
              onAddApproval={resourceActions.addApproval}
              onAddConstraint={resourceActions.addConstraint}
              onRemoveAssociation={resourceActions.removeResourceAssociation}
              onUpdateEntityArgs={resourceActions.updateResourceEntityArgs}
            />
          </TileContent>
        );
      case "builder":
        return (
          <TileContent>
            <BuilderPanel
              coordinateClipboard={coordinateClipboard}
              document={document}
              selectedId={selectedId}
              onAddBodyElement={geometryActions.addBodyElement}
              onLoadSystemCoordinates={loadSystemCoordinateClipboard}
              onRemoveBodyFromSelected={geometryActions.removeBodyFromSelected}
            />
          </TileContent>
        );
      case "catalog":
        return (
          <TileContent>
            <CatalogPanel
              catalog={catalog}
              catalogKind={catalogState.catalogKind}
              document={document}
              importing={catalogState.catalogImporting}
              selectedCatalogObjectId={activeCatalogObjectId}
              selectedId={selectedId}
              onChangeCatalogKind={catalogState.setCatalogKind}
              onImportCatalog={catalogState.importCatalog}
              onSelectCatalogObject={catalogState.setSelectedCatalogObjectId}
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
              onApplyFinding={catalogActions.applyCatalogFinding}
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
              onAddEmptyPset={batchPsetActions.addPsetToSelection}
              onAddCatalogObject={batchPsetActions.addCatalogObjectToSelection}
              onAddProperty={batchPsetActions.addPropertyToSelection}
              onEditValue={batchPsetActions.editPsetCellValue}
              onSetPropertyType={batchPsetActions.setPropertyTypeForSelection}
            />
          </TileContent>
        );
      case "object-info":
        return (
          <TileContent>
            <ObjectInfoPanel
              document={document}
              findings={objectInfoFindings}
              index={objectInfoIndex}
              selectedId={selectedId}
              onSelectEntity={selectEntity}
            />
          </TileContent>
        );
      case "diagnostics":
        return (
          <TileContent>
            <DiagnosticsAssistantPanel
              catalog={catalog}
              document={document}
              selectedId={selectedId}
              onSetObjectiveReferences={
                catalogActions.setDiagnosticObjectiveReferences
              }
              onAddPropertyToSet={propertyActions.addPropertyToSet}
              onApplyObjectInfo={catalogActions.applyDiagnosticObjectInfoDraft}
              onApplyProcedure={catalogActions.applyDiagnosticProcedure}
              onDuplicatePropertySet={propertyActions.duplicatePset}
              onRemovePropertyFromSet={propertyActions.deletePsetProperty}
              onRemovePropertySet={propertyActions.deletePset}
              onRenamePropertySet={propertyActions.renamePset}
              onUpdateProperty={propertyActions.updatePsetProperty}
            />
          </TileContent>
        );
      case "recent":
        return (
          <TileContent>
            <RecentFilesPanel
              activeDocumentId={activeSession.id}
              entries={persistence.recentIfcFiles}
              onClear={() => persistence.setRecentIfcFiles([])}
              onSelectDocument={(documentId) => {
                if (
                  documentSessions.some((session) => session.id === documentId)
                ) {
                  sessions.setActiveDocumentId(documentId);
                }
              }}
            />
          </TileContent>
        );
      case "notes":
        return (
          <TileContent>
            <NotesPanel
              notes={persistence.notes}
              onNotesChange={persistence.setNotes}
            />
          </TileContent>
        );
      case "portal":
        return (
          <TileContent>
            <PortalPanel
              document={document}
              getApplyTarget={() => portalApplyTargetRef.current}
              selectedId={selectedId}
              settings={persistence.portalSettings}
              tokens={persistence.portalTokens}
              onApplyImport={(nextDocument, summary) =>
                commitDocument(
                  nextDocument,
                  portalApplyTargetRef.current.selectedId,
                  summary,
                  `portal.applyImport({ summary: '${summary.replace(/'/g, "\\'")}' });`,
                  undefined,
                  { reloadViewer: true },
                )
              }
              onSelectEntity={(id) => selectEntity(id, "portal")}
              onSettingsChange={persistence.setPortalSettings}
              onTokensChange={persistence.setPortalTokens}
            />
          </TileContent>
        );
      case "portal-settings":
        return (
          <TileContent>
            <PortalSettingsPanel
              settings={persistence.portalSettings}
              onSettingsChange={persistence.setPortalSettings}
            />
          </TileContent>
        );
    }
  };

  const renderTileContent = (id: MosaicViewId) => {
    if (layout.detachedViews.has(id)) {
      return (
        <TileContent>
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <PanelTopOpen aria-hidden className="size-6 opacity-60" />
            <div>
              {MOSAIC_TITLES[id]} ist in einem eigenen Fenster geöffnet.
            </div>
            <Button onClick={() => layout.reattachMosaicView(id)}>
              Zurück ins Hauptfenster
            </Button>
          </div>
        </TileContent>
      );
    }
    return renderViewContent(id);
  };

  const renderToolbarControls = (id: MosaicViewId) => [
    id !== "viewer" && !layout.detachedViews.has(id) ? (
      <button
        key="detach"
        aria-label={`${MOSAIC_TITLES[id]} als eigenes Fenster öffnen`}
        className="mosaic-default-control detach-button"
        title="Als eigenes Fenster öffnen"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          layout.detachMosaicView(id);
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

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <WorkspaceHeader
        activeSessionId={activeSession.id}
        activeWorkspace={layout.activeWorkspace}
        closedMosaicIds={layout.closedMosaicIds}
        customWorkspaces={layout.customWorkspaces}
        documentSessions={documentSessions}
        loadingIfcName={loadingIfcName}
        redoStack={redoStack}
        undoStack={undoStack}
        onAddIfcFiles={() => void fileActions.addIfcFiles()}
        onCloseSession={sessions.closeDocumentSession}
        onCreateWorkspace={layout.createWorkspaceFromCurrentLayout}
        onDeleteWorkspace={layout.deleteActiveWorkspace}
        onExportIfc={() => void fileActions.exportIfc()}
        onOpenIfc={() => void fileActions.openIfc()}
        onRedo={sessions.redoDocument}
        onRestoreView={layout.restoreMosaicView}
        onSaveWorkspace={layout.saveActiveWorkspace}
        onSelectSession={sessions.setActiveDocumentId}
        onSelectWorkspace={layout.selectWorkspace}
        onUndo={sessions.undoDocument}
      />

      <main className="min-h-0 flex-1 p-1.5">
        <div className="h-full overflow-hidden rounded-lg border border-border/60 bg-muted/30">
          <Mosaic<MosaicViewId>
            className="ifcnative-mosaic"
            renderTile={renderMosaicTile}
            resize={{ minimumPaneSizePercentage: 12 }}
            value={layout.mosaicValue}
            zeroStateView={
              <div className="flex h-full items-center justify-center">
                <Button variant="default" onClick={layout.resetMosaicLayout}>
                  Layout wiederherstellen
                </Button>
              </div>
            }
            onChange={layout.setMosaicValue}
          />
        </div>
      </main>

      <DeleteEntityDialog
        entity={deleteRequest?.entity ?? null}
        plan={deleteRequest?.plan ?? null}
        onCancel={cancelDeleteEntity}
        onConfirm={confirmDeleteEntity}
      />

      <WorkspaceStatusBar
        document={document}
        documentTextDirty={activeSession.documentTextDirty}
        loadingIfcName={loadingIfcName}
        selectedEntity={selectedEntity}
        selectedIds={selectedIds}
        uiScale={uiScale}
        onUiScaleChange={setUiScale}
      />
      {[...layout.detachedViews].map((id) => (
        <ChildWindow
          key={id}
          title={`IFCnative – ${MOSAIC_TITLES[id]}`}
          onClose={() => layout.reattachMosaicView(id)}
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
