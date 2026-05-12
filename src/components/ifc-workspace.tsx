import { useMemo, useState } from "react";
import {
  Mosaic,
  MosaicWindow,
  type MosaicNode,
  type MosaicPath,
} from "react-mosaic-component";
import { SafeAreaView, Text, TextInput, View } from "react-native";

import {
  addNativeBodyElement,
  addNativeClassification,
  addNativeDocumentReference,
  addNativeElement,
  addNativeMaterial,
  addNativePropertySet,
  addNativeQuantitySet,
  addNativeRelationship,
  addNativeSiUnit,
  addNativeTypeAssignment,
  assignNativeBodyRepresentation,
  createNativeSampleDocument,
  getNativePlacement,
  parseNativeIfcFileInWorker,
  removeNativeRelationship,
  resolveNativeMovableProductId,
  serializeNativeIfcDocument,
  splitTopLevel,
  updateNativeEntity,
  updateNativePlacement,
  updateNativePropertyValue,
  updateNativeRelationship,
  viewerWorldDeltaToIfcPlacementDelta,
  type NativeIfcDocument,
} from "@/ifc";
import { type NativeGraphPreset } from "@/ifc/nativeGraph";

import { BuilderPanel } from "./ifc-workspace/BuilderPanel";
import {
  DEFAULT_MOSAIC_LAYOUT,
  ENTITY_TYPES,
  MOSAIC_TITLES,
  MOSAIC_VIEW_IDS,
  RELATION_TYPES,
} from "./ifc-workspace/constants";
import { GraphPanel } from "./ifc-workspace/GraphPanel";
import { InspectorPanel } from "./ifc-workspace/InspectorPanel";
import {
  ConsolePanel,
  DiagnosticsPanel,
  DiffPanel,
} from "./ifc-workspace/ReviewPanels";
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

function createInitialWorkspaceDocument() {
  const document = createNativeSampleDocument();
  return {
    document,
    selectedId: document.spatialRoots[0]?.id ?? 1,
    text: serializeNativeIfcDocument(document),
  };
}

export default function IfcWorkspace() {
  const [initialDocument] = useState(createInitialWorkspaceDocument);
  const [document, setDocument] = useState<NativeIfcDocument>(
    initialDocument.document,
  );
  const [selectedId, setSelectedId] = useState(initialDocument.selectedId);
  const [graphAnchorId, setGraphAnchorId] = useState(
    initialDocument.selectedId,
  );
  const [structureMode, setStructureMode] = useState<StructureMode>("tree");
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>("info");
  const [treeExpanded, setTreeExpanded] = useState<Set<number>>(
    () => new Set(),
  );
  const [mosaicValue, setMosaicValue] =
    useState<MosaicNode<MosaicViewId> | null>(DEFAULT_MOSAIC_LAYOUT);
  const [search, setSearch] = useState("");
  const [graphDepth, setGraphDepth] = useState(1);
  const [graphPreset, setGraphPreset] = useState<NativeGraphPreset>("all");
  const [graphRelationshipTypes, setGraphRelationshipTypes] = useState<
    Set<string>
  >(() => new Set());
  const [graphPinned, setGraphPinned] = useState<Set<number>>(() => new Set());
  const [graphExpanded, setGraphExpanded] = useState<Set<number>>(
    () => new Set(),
  );
  const [graphCollapsed, setGraphCollapsed] = useState<Set<number>>(
    () => new Set(),
  );
  const [graphPositions, setGraphPositions] = useState<Map<number, Point>>(
    () => new Map(),
  );
  const [pendingDocument, setPendingDocument] =
    useState<NativeIfcDocument | null>(null);
  const [pendingIfcText, setPendingIfcText] = useState("");
  const [pendingSummary, setPendingSummary] = useState("");
  const [documentText, setDocumentText] = useState(initialDocument.text);
  const [documentBytes, setDocumentBytes] = useState<ArrayBuffer | null>(null);
  const [loadingIfcName, setLoadingIfcName] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>(() => [
    `${new Date().toLocaleTimeString()}  ui.boot({ shell: 'vite-react' });`,
  ]);
  const [coordinateClipboard, setCoordinateClipboard] =
    useState<CoordinateClipboard | null>(null);

  const viewerDocument = pendingDocument ?? document;
  const viewerIfcText = pendingIfcText || documentText;
  const viewerIfcBytes = pendingIfcText ? null : documentBytes;
  const selectedEntity =
    viewerDocument.entityById.get(selectedId) ??
    document.entityById.get(selectedId) ??
    document.entities[0];
  const closedMosaicIds = useMemo(() => {
    const visibleIds = new Set(getMosaicLeaves(mosaicValue));
    return MOSAIC_VIEW_IDS.filter((id) => !visibleIds.has(id));
  }, [mosaicValue]);

  const filteredEntities = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return document.entities.slice(0, 120);
    }
    return document.entities
      .filter((entity) =>
        [String(entity.id), entity.type, entity.name, entity.globalId].some(
          (value) => value.toLowerCase().includes(query),
        ),
      )
      .slice(0, 160);
  }, [document.entities, search]);

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
  ) => {
    setDocument(next);
    setPendingDocument(null);
    setPendingIfcText("");
    setPendingSummary("");
    setDocumentText(nextText ?? serializeNativeIfcDocument(next));
    setDocumentBytes(nextBytes ?? null);
    setTreeExpanded(new Set());
    const fallbackId = next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? 0;
    const resolvedSelectedId = next.entityById.has(nextSelectedId ?? 0)
      ? (nextSelectedId as number)
      : fallbackId;
    setSelectedId(resolvedSelectedId);
    setGraphAnchorId(resolvedSelectedId);
    setGraphPositions(nextGraphPositions ?? new Map());
    if (log) {
      logAction(log);
    }
  };

  const stageDocument = (
    next: NativeIfcDocument,
    nextSelectedId: number | undefined,
    summary: string,
    log?: string,
    nextGraphPositions?: Map<number, Point>,
  ) => {
    setPendingDocument(next);
    setPendingIfcText(serializeNativeIfcDocument(next));
    setPendingSummary(summary);
    const fallbackId =
      next.spatialRoots[0]?.id ?? next.entities[0]?.id ?? selectedId;
    setSelectedId(
      next.entityById.has(nextSelectedId ?? 0)
        ? (nextSelectedId as number)
        : fallbackId,
    );
    if (nextGraphPositions) {
      setGraphPositions(nextGraphPositions);
    }
    if (log) {
      logAction(`draft.${log}`);
    }
  };

  const applyPendingDocument = () => {
    if (!pendingDocument) {
      return;
    }
    const appliedSummary = pendingSummary;
    setDocument(pendingDocument);
    setPendingDocument(null);
    setDocumentText(pendingIfcText);
    setDocumentBytes(null);
    setPendingIfcText("");
    setPendingSummary("");
    logAction(`draft.apply(${JSON.stringify(appliedSummary)});`);
  };

  const discardPendingDocument = () => {
    const discardedSummary = pendingSummary;
    setPendingDocument(null);
    setPendingIfcText("");
    setPendingSummary("");
    if (!document.entityById.has(selectedId)) {
      const fallbackId =
        document.spatialRoots[0]?.id ?? document.entities[0]?.id ?? 0;
      setSelectedId(fallbackId);
      setGraphAnchorId(fallbackId);
    }
    logAction(`draft.discard(${JSON.stringify(discardedSummary)});`);
  };

  const selectEntity = (id: number, source = "ui", globalId?: string) => {
    const selectionDocument = pendingDocument ?? document;
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
        parsed.text,
        parsed.bytes,
      );
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setLoadingIfcName("");
    }
  };

  const loadSample = () => {
    replaceDocument(
      createNativeSampleDocument(),
      undefined,
      "ui.loadSample('IFCnative Builder Sample.ifc');",
    );
  };

  const exportIfc = async () => {
    const text = documentText;
    const fileName = document.fileName.replace(/\.ifc$/i, "") || "IFCnative";
    const blob = new Blob([text], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName}.ifc`;
    anchor.click();
    URL.revokeObjectURL(url);
    logAction(`ui.exportIfc({ file: '${fileName}.ifc' });`);
  };

  const saveSelectedEdit = (draft: EntityEditDraft) => {
    const next = updateNativeEntity(document, selectedId, {
      args: splitTopLevel(draft.rawArgs),
      description: draft.description,
      name: draft.name,
      type: draft.type,
    });
    stageDocument(
      next,
      selectedId,
      `Edit #${selectedId} ${draft.type}`,
      `saveEdit({ id: ${selectedId}, class: '${draft.type}' });`,
    );
  };

  const addElement = (type: string, name: string, parentId?: number) => {
    const previousMaxId = Math.max(
      ...document.entities.map((entity) => entity.id),
      0,
    );
    const next = addNativeElement(document, parentId, type, name);
    const added = next.entityById.get(previousMaxId + 1);
    stageDocument(
      next,
      added?.id,
      `Add ${type} '${name}'${parentId ? ` under #${parentId}` : ""}`,
      `addElement({ class: '${type}', name: '${name}' });`,
    );
  };

  const addBodyElement = (options: BodyElementDraft) => {
    const previousMaxId = Math.max(
      ...document.entities.map((entity) => entity.id),
      0,
    );
    const next = addNativeBodyElement(document, options);
    const added = next.entityById.get(previousMaxId + 1);
    stageDocument(
      next,
      added?.id,
      `Add ${options.type} body '${options.name}'${options.parentId ? ` under #${options.parentId}` : ""}`,
      `addBodyElement({ class: '${options.type}', name: '${options.name}', profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
    );
  };

  const assignBodyToSelected = (options: BodyElementDraft) => {
    const next = assignNativeBodyRepresentation(document, selectedId, options);
    stageDocument(
      next,
      selectedId,
      `Assign ${options.profile ?? "rectangle"} body representation to #${selectedId}`,
      `assignBodyRepresentation({ id: ${selectedId}, profile: '${options.profile ?? "rectangle"}', width: ${options.width}, depth: ${options.depth}, height: ${options.height} });`,
    );
  };

  const addRelationship = (
    type: string,
    sourceId: number,
    targetId: number,
  ) => {
    const next = addNativeRelationship(document, type, sourceId, targetId);
    stageDocument(
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
    const previousMaxId = Math.max(
      ...document.entities.map((entity) => entity.id),
      0,
    );
    const withElement = addNativeElement(document, undefined, type, name);
    const addedId = previousMaxId + 1;
    const next = addNativeRelationship(
      withElement,
      relationshipType,
      sourceId,
      addedId,
    );
    const nextPositions = new Map(graphPositions);
    nextPositions.set(addedId, position);
    stageDocument(
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
    stageDocument(
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
    stageDocument(
      next,
      selectedId,
      `Add Pset '${psetName}' to #${selectedId}`,
      `addPset({ objectId: ${selectedId}, name: '${psetName}' });`,
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
    stageDocument(
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
    stageDocument(
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
    stageDocument(
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
    stageDocument(
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
    stageDocument(
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
    const next = updateNativePropertyValue(document, propertyId, {
      name: propertyName,
      value: propertyValue,
      valueType: propertyValueType,
    });
    stageDocument(
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
    stageDocument(
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
    stageDocument(
      next,
      nextSelection && next.entityById.has(nextSelection)
        ? nextSelection
        : selectedId,
      `Delete relationship #${relationshipId}${relationship ? ` ${relationship.type}` : ""}`,
      `deleteRelationship({ id: ${relationshipId} });`,
    );
  };

  const moveSelectedPlacement = (x: string, y: string, z: string) => {
    const sourceDocument = pendingDocument ?? document;
    const next = updateNativePlacement(sourceDocument, selectedId, { x, y, z });
    stageDocument(
      next,
      selectedId,
      `Move #${selectedId} placement to (${x}, ${y}, ${z})`,
      `movePlacement({ id: ${selectedId}, x: ${JSON.stringify(x)}, y: ${JSON.stringify(y)}, z: ${JSON.stringify(z)} });`,
    );
  };

  const nudgeSelectedPlacement = (delta: {
    x?: number;
    y?: number;
    z?: number;
  }) => {
    const sourceDocument = pendingDocument ?? document;
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
    stageDocument(
      next,
      moveTargetId,
      `Move #${moveTargetId} placement by viewer delta (${formatCoordinate(delta.x ?? 0)}, ${formatCoordinate(delta.y ?? 0)}, ${formatCoordinate(delta.z ?? 0)}) to IFC (${x}, ${y}, ${z})`,
      `movePlacement.viewerDelta({ id: ${moveTargetId}, selectedId: ${selectedId}, dx: ${delta.x ?? 0}, dy: ${delta.y ?? 0}, dz: ${delta.z ?? 0} });`,
    );
  };

  const storePickedCoordinates = (pick: ViewerCoordinatePick) => {
    const copiedAt = new Date().toLocaleTimeString();
    const nextClipboard = {
      copiedAt,
      entityId: pick.entityId,
      localId: pick.localId,
      source: pick.source,
      x: formatCoordinate(pick.x),
      y: formatCoordinate(pick.y),
      z: formatCoordinate(pick.z),
    } satisfies CoordinateClipboard;
    setCoordinateClipboard(nextClipboard);
    logAction(
      `viewer.coordinates.clipboard({ x: ${nextClipboard.x}, y: ${nextClipboard.y}, z: ${nextClipboard.z}${pick.entityId ? `, entityId: ${pick.entityId}` : ""} });`,
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
    stageDocument(
      next,
      selectedId,
      `Add unit ${unitType} ${unitName}`,
      `addUnit({ unitType: '${unitType}', name: '${unitName}' });`,
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
        document={viewerDocument}
        mode={inspectorMode}
        selectedId={selectedId}
        onAddClassification={addClassification}
        onAddDocumentReference={addDocumentReference}
        onAddMaterial={addMaterial}
        onAssignType={assignType}
        onAddPset={addPset}
        onAddQuantity={addQuantity}
        onAddUnit={addUnit}
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
              fileName={document.fileName}
              ifcBytes={viewerIfcBytes}
              ifcText={viewerIfcText}
              isDraftPreview={Boolean(pendingIfcText)}
              selectedId={selectedId}
              selectedName={selectedEntity?.name}
              onLog={logAction}
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
      case "diff":
        return (
          <View style={styles.tileContent}>
            <DiffPanel
              currentText={documentText}
              pendingSummary={pendingSummary}
              pendingText={pendingIfcText}
              onApply={applyPendingDocument}
              onDiscard={discardPendingDocument}
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topbar}>
        <View>
          <Text style={styles.appTitle}>IFCnative</Text>
        </View>
        <View style={styles.actions}>
          <Button
            disabled={Boolean(loadingIfcName)}
            label={loadingIfcName ? "Loading IFC..." : "Open IFC"}
            primary
            onPress={() => void openIfc()}
          />
          <Button label="Sample" onPress={loadSample} />
          <Button
            disabled={Boolean(pendingDocument) || Boolean(loadingIfcName)}
            label="Export IFC"
            onPress={() => void exportIfc()}
          />
          <Button
            disabled={!pendingDocument}
            label="Apply Draft"
            primary
            onPress={applyPendingDocument}
          />
          <Button
            disabled={!pendingDocument}
            label="Discard Draft"
            onPress={discardPendingDocument}
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
  return new Promise<{ file: File; name: string } | undefined>(
    (resolve, reject) => {
      const input = globalThis.document.createElement("input");
      input.type = "file";
      input.accept =
        ".ifc,application/x-step,text/plain,application/octet-stream";
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
      return toParsedCoordinates(x, y, z);
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

function normalizeCoordinateText(value: string) {
  const normalized = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(normalized)) {
    return undefined;
  }
  return formatCoordinate(normalized);
}
