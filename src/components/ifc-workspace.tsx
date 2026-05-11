import React, { useEffect, useMemo, useState } from "react";
import {
    Mosaic,
    MosaicWindow,
    type MosaicNode,
    type MosaicPath,
} from "react-mosaic-component";
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

import {
    previewEntityAwareDiffLines,
    summarizeEntityAwareDiff,
} from "@/ifc/entityDiff";

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
    serializeNativeIfcDocument,
    splitTopLevel,
    updateNativeEntity,
    updateNativePlacement,
    updateNativePropertyValue,
    updateNativeRelationship,
    type NativeIfcDocument,
    type NativeIfcEntity,
    type NativeIfcRelationship,
    type NativeIfcTreeNode,
} from "@/ifc";
import {
    buildNativeGraphNeighborhood,
    type NativeGraphEdge,
    type NativeGraphPreset,
} from "@/ifc/nativeGraph";

import RelationshipFlow from "./relationship-flow";
import type {
    RelationshipFlowEdge,
    RelationshipFlowLayoutMode,
    RelationshipFlowMove,
    RelationshipFlowNode,
} from "./relationship-flow.types";
import ThatOpenViewer from "./that-open-viewer";

type StructureMode = "tree" | "graph";
type InspectorMode =
  | "info"
  | "edit"
  | "placement"
  | "psets"
  | "relations"
  | "resources"
  | "refs"
  | "units";
type MosaicViewId =
  | "structure"
  | "viewer"
  | "inspector"
  | "builder"
  | "diff"
  | "console"
  | "diagnostics";

const MOSAIC_VIEW_IDS: MosaicViewId[] = [
  "structure",
  "viewer",
  "inspector",
  "builder",
  "diff",
  "console",
  "diagnostics",
];

const DEFAULT_MOSAIC_LAYOUT: MosaicNode<MosaicViewId> = {
  direction: "row",
  first: {
    direction: "column",
    first: "structure",
    second: "builder",
    splitPercentage: 62,
  },
  second: {
    direction: "column",
    first: {
      direction: "row",
      first: "viewer",
      second: "inspector",
      splitPercentage: 66,
    },
    second: {
      direction: "row",
      first: "diff",
      second: {
        direction: "row",
        first: "console",
        second: "diagnostics",
        splitPercentage: 52,
      },
      splitPercentage: 42,
    },
    splitPercentage: 72,
  },
  splitPercentage: 27,
};

const MOSAIC_TITLES: Record<MosaicViewId, string> = {
  builder: "Builder",
  console: "JS Console",
  diagnostics: "Diagnostics",
  diff: "IFC Diff / Review",
  inspector: "Inspector",
  structure: "Structure",
  viewer: "3D Viewer",
};

const ENTITY_TYPES = [
  "IFCBUILDINGELEMENTPROXY",
  "IFCBUILTELEMENT",
  "IFCWALL",
  "IFCSLAB",
  "IFCBEAM",
  "IFCCOLUMN",
  "IFCDOOR",
  "IFCWINDOW",
  "IFCSPACE",
  "IFCSENSOR",
  "IFCACTUATOR",
  "IFCTASK",
  "IFCEVENT",
  "IFCPROCEDURE",
  "IFCGROUP",
  "IFCSYSTEM",
  "IFCASSET",
  "IFCBUILDINGSTOREY",
  "IFCBUILDING",
  "IFCSITE",
];

const RELATION_TYPES = [
  "IFCRELAGGREGATES",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  "IFCRELDEFINESBYPROPERTIES",
  "IFCRELDEFINESBYTYPE",
  "IFCRELREFERENCEDINSPATIALSTRUCTURE",
  "IFCRELASSOCIATESMATERIAL",
  "IFCRELASSOCIATESCLASSIFICATION",
  "IFCRELASSOCIATESDOCUMENT",
  "IFCRELASSOCIATESLIBRARY",
  "IFCRELASSOCIATESCONSTRAINT",
  "IFCRELASSOCIATESAPPROVAL",
  "IFCRELASSIGNSTOGROUP",
  "IFCRELASSIGNSTOPROCESS",
  "IFCRELASSIGNSTOCONTROL",
  "IFCRELASSIGNSTOPRODUCT",
  "IFCRELCONNECTSELEMENTS",
  "IFCRELCONNECTSPORTS",
  "IFCRELCONNECTSPORTTOELEMENT",
  "IFCRELVOIDSELEMENT",
  "IFCRELFILLSELEMENT",
  "IFCRELSEQUENCE",
  "IFCRELSERVICESBUILDINGS",
];

const UNIT_TYPES = [
  "LENGTHUNIT",
  "AREAUNIT",
  "VOLUMEUNIT",
  "MASSUNIT",
  "TIMEUNIT",
];
const UNIT_NAMES = ["METRE", "SQUARE_METRE", "CUBIC_METRE", "GRAM", "SECOND"];
const PROPERTY_VALUE_TYPES = [
  "IFCLABEL",
  "IFCTEXT",
  "IFCREAL",
  "IFCINTEGER",
  "IFCBOOLEAN",
];
const QUANTITY_TYPES = [
  "IFCQUANTITYLENGTH",
  "IFCQUANTITYAREA",
  "IFCQUANTITYVOLUME",
  "IFCQUANTITYCOUNT",
  "IFCQUANTITYWEIGHT",
  "IFCQUANTITYTIME",
];

const TYPE_CLASSES = [
  "IFCTYPEOBJECT",
  "IFCELEMENTTYPE",
  "IFCBUILDINGELEMENTPROXYTYPE",
  "IFCWALLTYPE",
  "IFCSLABTYPE",
  "IFCDOORTYPE",
  "IFCWINDOWTYPE",
  "IFCBEAMTYPE",
  "IFCCOLUMNTYPE",
];

const GRAPH_PRESETS: Array<{
  value: NativeGraphPreset;
  label: string;
  detail: string;
}> = [
  { value: "all", label: "All", detail: "Every indexed relationship type" },
  {
    value: "spatial",
    label: "Spatial",
    detail: "Aggregation, nesting and containment",
  },
  {
    value: "properties",
    label: "Properties",
    detail: "Psets, quantities and type definitions",
  },
  {
    value: "resources",
    label: "Resources",
    detail: "Groups, materials, classification and documents",
  },
  {
    value: "geometry",
    label: "Geometry",
    detail: "Placement and representation references when indexed",
  },
];

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

  const selectedEntity =
    document.entityById.get(selectedId) ?? document.entities[0];
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
    setSelectedId(
      next.entityById.has(nextSelectedId ?? 0)
        ? (nextSelectedId as number)
        : fallbackId,
    );
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
    logAction(`draft.discard(${JSON.stringify(discardedSummary)});`);
  };

  const selectEntity = (id: number, source = "ui") => {
    if (!document.entityById.has(id)) {
      return;
    }
    setSelectedId(id);
    const entity = document.entityById.get(id);
    logAction(
      `${source}.selectEntity({ id: ${id}, class: '${entity?.type ?? "UNKNOWN"}' });`,
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
    const next = updateNativePlacement(document, selectedId, { x, y, z });
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
    const placement = getNativePlacement(document, selectedId);
    if (!placement) {
      logAction(
        `movePlacement.nudgeSkipped({ id: ${selectedId}, reason: 'no-placement' });`,
      );
      return;
    }
    const x = formatCoordinate(placement.x + (delta.x ?? 0));
    const y = formatCoordinate(placement.y + (delta.y ?? 0));
    const z = formatCoordinate(placement.z + (delta.z ?? 0));
    const next = updateNativePlacement(document, selectedId, { x, y, z });
    stageDocument(
      next,
      selectedId,
      `Nudge #${selectedId} placement by (${formatCoordinate(delta.x ?? 0)}, ${formatCoordinate(delta.y ?? 0)}, ${formatCoordinate(delta.z ?? 0)}) to (${x}, ${y}, ${z})`,
      `movePlacement.nudge({ id: ${selectedId}, dx: ${delta.x ?? 0}, dy: ${delta.y ?? 0}, dz: ${delta.z ?? 0} });`,
    );
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
        document={document}
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
              ifcBytes={documentBytes}
              ifcText={documentText}
              selectedId={selectedId}
              selectedName={selectedEntity?.name}
              onLog={logAction}
              onMoveSelected={nudgeSelectedPlacement}
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

function Button({
  disabled,
  label,
  onPress,
  primary,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  primary?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonPrimaryText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function MosaicWindowMenu({
  closedIds,
  onRestore,
}: {
  closedIds: MosaicViewId[];
  onRestore(id: MosaicViewId): void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.windowMenu}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [
          styles.button,
          styles.windowMenuButton,
          (open || pressed) && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>
          Windows{closedIds.length ? ` (${closedIds.length})` : ""}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.windowMenuPanel}>
          {closedIds.length ? (
            closedIds.map((id) => (
              <Pressable
                key={id}
                onPress={() => {
                  onRestore(id);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.windowMenuOption,
                  pressed && styles.windowMenuOptionPressed,
                ]}
              >
                <Text style={styles.windowMenuOptionText} numberOfLines={1}>
                  {MOSAIC_TITLES[id]}
                </Text>
                <Text style={styles.windowMenuOptionMeta}>Open</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.windowMenuEmpty}>All windows are open</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange(value: string): void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.segment, value === option && styles.segmentActive]}
        >
          <Text
            style={[
              styles.segmentText,
              value === option && styles.segmentTextActive,
            ]}
          >
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function StructurePanel({
  document,
  expanded,
  filteredEntities,
  search,
  selectedId,
  onSelect,
  onToggle,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  filteredEntities: NativeIfcEntity[];
  search: string;
  selectedId: number;
  onSelect(id: number, source?: string): void;
  onToggle(id: number): void;
}) {
  return (
    <ScrollView style={styles.panelScroll}>
      {search.trim() ? (
        filteredEntities.map((entity) => (
          <EntityRow
            entity={entity}
            key={entity.id}
            selected={entity.id === selectedId}
            onPress={() => onSelect(entity.id, "tree")}
          />
        ))
      ) : document.spatialRoots.length ? (
        document.spatialRoots.map((node) => (
          <TreeNode
            document={document}
            expanded={expanded}
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))
      ) : (
        <Text style={styles.empty}>No spatial roots indexed.</Text>
      )}
    </ScrollView>
  );
}

function TreeNode({
  document,
  expanded,
  node,
  selectedId,
  onSelect,
  onToggle,
  depth = 0,
}: {
  document: NativeIfcDocument;
  expanded: Set<number>;
  node: NativeIfcTreeNode;
  selectedId: number;
  onSelect(id: number, source?: string): void;
  onToggle(id: number): void;
  depth?: number;
}) {
  const entity = document.entityById.get(node.id);
  if (!entity) {
    return null;
  }
  const childCount = node.children.length;
  const isExpanded = expanded.has(node.id);
  return (
    <View>
      <Pressable
        onPress={() => {
          onSelect(entity.id, "tree");
          if (childCount > 0) {
            onToggle(entity.id);
          }
        }}
        style={[
          styles.treeItem,
          { marginLeft: depth * 12 },
          selectedId === entity.id && styles.treeItemSelected,
        ]}
      >
        <View style={styles.treeTitleRow}>
          {childCount > 0 ? (
            <Text style={styles.treeToggle}>{isExpanded ? "-" : "+"}</Text>
          ) : null}
          <Text style={styles.treeTitle} numberOfLines={1}>
            {entity.name || `#${entity.id}`}
          </Text>
        </View>
        <Text style={styles.treeMeta}>
          #{entity.id} {entity.type} - {node.relation}
          {childCount ? ` - ${childCount.toLocaleString()} children` : ""}
        </Text>
      </Pressable>
      {isExpanded
        ? node.children.map((child) => (
            <TreeNode
              depth={depth + 1}
              document={document}
              expanded={expanded}
              key={`${node.id}-${child.id}`}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </View>
  );
}

function EntityRow({
  entity,
  selected,
  onPress,
}: {
  entity: NativeIfcEntity;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.treeItem, selected && styles.treeItemSelected]}
    >
      <Text style={styles.treeTitle} numberOfLines={1}>
        {entity.name || `#${entity.id}`}
      </Text>
      <Text style={styles.treeMeta}>
        #{entity.id} {entity.type}
      </Text>
    </Pressable>
  );
}

interface Point {
  x: number;
  y: number;
}

function GraphPanel({
  classOptions,
  collapsed,
  depth,
  document,
  expanded,
  pinned,
  positions,
  preset,
  relationshipOptions,
  relationshipTypeFilters,
  selectedId,
  onConnectNodes,
  onCreateNodeFromConnection,
  onDepth,
  onLog,
  onPositions,
  onPreset,
  onRelationshipTypeFilters,
  onSelect,
  onToggleChildren,
  onTogglePin,
}: {
  classOptions: DropdownOption[];
  collapsed: Set<number>;
  depth: number;
  document: NativeIfcDocument;
  expanded: Set<number>;
  pinned: Set<number>;
  positions: Map<number, Point>;
  preset: NativeGraphPreset;
  relationshipOptions: DropdownOption[];
  relationshipTypeFilters: Set<string>;
  selectedId: number;
  onConnectNodes(
    sourceId: number,
    targetId: number,
    relationshipType: string,
  ): void;
  onCreateNodeFromConnection(
    sourceId: number,
    type: string,
    name: string,
    relationshipType: string,
    position: Point,
  ): void;
  onDepth(depth: number): void;
  onLog(code: string): void;
  onPositions(positions: Map<number, Point>): void;
  onPreset(preset: NativeGraphPreset): void;
  onRelationshipTypeFilters(filters: string[]): void;
  onSelect(id: number, source?: string): void;
  onToggleChildren(id: number, loaded: boolean): void;
  onTogglePin(id: number, point?: Point): void;
}) {
  const [layoutMode, setLayoutMode] =
    useState<RelationshipFlowLayoutMode>("tension");
  const graph = useMemo(
    () =>
      buildGraph(
        document,
        selectedId,
        pinned,
        expanded,
        collapsed,
        depth,
        preset,
        relationshipTypeFilters,
      ),
    [
      collapsed,
      depth,
      document,
      expanded,
      pinned,
      preset,
      relationshipTypeFilters,
      selectedId,
    ],
  );
  const layout = useMemo(
    () =>
      layoutGraph(
        graph.nodeIds,
        graph.levels,
        graph.edges,
        positions,
        pinned,
        layoutMode,
      ),
    [graph.edges, graph.levels, graph.nodeIds, layoutMode, pinned, positions],
  );
  const flowNodes = useMemo<RelationshipFlowNode[]>(
    () =>
      layout.flatMap((node) => {
        const entity = document.entityById.get(node.id);
        if (!entity) {
          return [];
        }
        return [
          {
            childCount: graph.childCounts.get(node.id) ?? 0,
            childrenLoaded: graph.loadedSources.has(node.id),
            entity: {
              description: entity.description,
              globalId: entity.globalId,
              id: entity.id,
              name: entity.name,
              type: entity.type,
            },
            id: node.id,
            pinned: pinned.has(node.id),
            selected: node.id === selectedId,
            x: node.x,
            y: node.y,
          },
        ];
      }),
    [
      document.entityById,
      graph.childCounts,
      graph.loadedSources,
      layout,
      pinned,
      selectedId,
    ],
  );
  const flowEdges = useMemo<RelationshipFlowEdge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: `${edge.rel}-${edge.source}-${edge.target}`,
        label: edge.label,
        rel: edge.rel,
        relationshipType: edge.type,
        source: edge.source,
        target: edge.target,
      })),
    [graph.edges],
  );

  const moveNodes = (moves: RelationshipFlowMove[]) => {
    if (!moves.length) {
      return;
    }
    const next = new Map(positions);
    for (const move of moves) {
      next.set(move.id, move.point);
    }
    onPositions(next);
  };

  const moveNode = (id: number, point: Point) => {
    moveNodes([{ id, point }]);
  };

  return (
    <RelationshipFlow
      capped={graph.capped}
      classOptions={classOptions}
      depth={depth}
      edges={flowEdges}
      layoutMode={layoutMode}
      nodes={flowNodes}
      preset={preset}
      presetOptions={GRAPH_PRESETS}
      relationshipOptions={relationshipOptions}
      relationshipCount={graph.edges.length}
      relationshipTypeFilters={[...relationshipTypeFilters]}
      relationshipTypes={graph.relationshipTypes}
      onClearPositions={() => {
        onPositions(retainPinnedPositions(positions, pinned));
        onLog(`graph.autoLayout({ mode: '${layoutMode}' });`);
      }}
      onConnectNodes={onConnectNodes}
      onCreateNodeFromConnection={onCreateNodeFromConnection}
      onDepth={(value) => {
        onDepth(value);
        onLog(`graph.depth(${value});`);
      }}
      onLayoutMode={(value) => {
        setLayoutMode(value);
        onPositions(retainPinnedPositions(positions, pinned));
      }}
      onLog={onLog}
      onMoveEnd={(id, point) =>
        onLog(
          `graph.moveNode({ id: ${id}, x: ${point.x.toFixed(1)}, y: ${point.y.toFixed(1)} });`,
        )
      }
      onMoveNode={moveNode}
      onMoveNodes={moveNodes}
      onMoveNodesEnd={(moves) => {
        const ids = moves
          .map((move) => move.id)
          .slice(0, 12)
          .join(", ");
        onLog(`graph.moveNodes({ count: ${moves.length}, ids: [${ids}] });`);
      }}
      onPreset={(value) => onPreset(value as NativeGraphPreset)}
      onRelationshipTypeFilters={onRelationshipTypeFilters}
      onSelect={(id) => onSelect(id, "graph")}
      onToggleChildren={(id, loaded) => onToggleChildren(id, loaded)}
      onTogglePin={onTogglePin}
    />
  );
}

interface EntityEditDraft {
  type: string;
  name: string;
  description: string;
  rawArgs: string;
}

interface BodyElementDraft {
  type: string;
  name: string;
  parentId?: number;
  width: string;
  depth: string;
  height: string;
  profile?: "rectangle" | "cylinder";
  x: string;
  y: string;
  z: string;
  tag?: string;
}

function InspectorPanel({
  document,
  mode,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddMaterial,
  onAssignType,
  onAddPset,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
  onMovePlacement,
  onRemoveRelationship,
  onSaveEdit,
  onUpdateProperty,
  onUpdateRelationship,
}: {
  document: NativeIfcDocument;
  mode: InspectorMode;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddPset(
    psetName: string,
    propertyName: string,
    propertyValue: string,
    propertyValueType?: string,
  ): void;
  onAddQuantity(
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType?: string,
  ): void;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onAddUnit(unitType: string, unitName: string): void;
  onMovePlacement(x: string, y: string, z: string): void;
  onRemoveRelationship(relationshipId: number): void;
  onSaveEdit(draft: EntityEditDraft): void;
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
  onUpdateRelationship(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const entity = document.entityById.get(selectedId);
  if (!entity) {
    return <Text style={styles.empty}>No entity selected.</Text>;
  }

  if (mode === "edit") {
    return <EditPanel entity={entity} onSave={onSaveEdit} />;
  }
  if (mode === "psets") {
    return (
      <PsetPanel
        document={document}
        selectedId={selectedId}
        onAddPset={onAddPset}
        onAddQuantity={onAddQuantity}
        onUpdateProperty={onUpdateProperty}
      />
    );
  }
  if (mode === "placement") {
    return (
      <PlacementPanel
        document={document}
        selectedId={selectedId}
        onMove={onMovePlacement}
      />
    );
  }
  if (mode === "relations") {
    return (
      <RelationsPanel
        document={document}
        selectedId={selectedId}
        onAddRelationship={onAddRelationship}
        onRemoveRelationship={onRemoveRelationship}
        onUpdateRelationship={onUpdateRelationship}
      />
    );
  }
  if (mode === "refs") {
    return <ReferencesPanel document={document} selectedId={selectedId} />;
  }
  if (mode === "resources") {
    return (
      <ResourcesPanel
        document={document}
        selectedId={selectedId}
        onAddClassification={onAddClassification}
        onAddDocumentReference={onAddDocumentReference}
        onAddMaterial={onAddMaterial}
        onAssignType={onAssignType}
      />
    );
  }
  if (mode === "units") {
    return <UnitsPanel document={document} onAddUnit={onAddUnit} />;
  }
  return <InfoPanel document={document} entity={entity} />;
}

function InfoPanel({
  document,
  entity,
}: {
  document: NativeIfcDocument;
  entity: NativeIfcEntity;
}) {
  const path = findTreePath(document, entity.id);
  const resources = document.resourcesByEntity.get(entity.id) ?? [];
  const sets = document.propertySetsByEntity.get(entity.id) ?? [];
  const relationships = document.relationshipsByEntity.get(entity.id) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Identity">
        <InfoRow label="ID" value={`#${entity.id}`} />
        <InfoRow label="Class" value={entity.type} />
        <InfoRow label="GlobalId" value={entity.globalId || "-"} />
        <InfoRow label="Name" value={entity.name || "-"} />
        <InfoRow label="Description" value={entity.description || "-"} />
      </InfoSection>
      <InfoSection title="Document">
        <InfoRow label="File" value={document.fileName} />
        <InfoRow label="Schema" value={document.schema} />
        <InfoRow
          label="Entities"
          value={document.entities.length.toLocaleString()}
        />
        <InfoRow
          label="Types"
          value={document.entitiesByType.size.toLocaleString()}
        />
      </InfoSection>
      <InfoSection title="Spatial Path">
        {path.length ? (
          path.map((item) => (
            <Text key={item.id} style={styles.infoText}>
              #{item.id} {item.type}: {item.name || item.type}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No spatial path.</Text>
        )}
      </InfoSection>
      <InfoSection title="Resources">
        {resources.length ? (
          resources.map((item) => (
            <Text key={item} style={styles.infoText}>
              {item}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No resources linked.</Text>
        )}
      </InfoSection>
      <InfoSection title="Properties / Quantities">
        {sets.length ? (
          sets.map((set) => (
            <Text key={set.id} style={styles.infoText}>
              #{set.id} {set.kind} {set.name}:{" "}
              {set.values
                .map((value) => `${value.name}=${value.value}`)
                .join(", ")}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No Psets or QTOs linked.</Text>
        )}
      </InfoSection>
      <InfoSection title="Relationships">
        {relationships.length ? (
          relationships.map((relationship) => (
            <Text key={relationship.id} style={styles.infoText}>
              #{relationship.id} {relationship.type}:{" "}
              {relationship.sourceIds.map((id) => `#${id}`).join(",") || "-"} -{" "}
              {relationship.targetIds.map((id) => `#${id}`).join(",") || "-"}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No relationships indexed.</Text>
        )}
      </InfoSection>
      <InfoSection title="STEP">
        <Text style={styles.codeBlock}>
          #{entity.id}= {entity.type}({entity.args.join(",")});
        </Text>
      </InfoSection>
    </ScrollView>
  );
}

function EditPanel({
  entity,
  onSave,
}: {
  entity: NativeIfcEntity;
  onSave(draft: EntityEditDraft): void;
}) {
  const rawArgsValue = entity.args.join(",");
  const [type, setType] = useState(entity.type);
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description);
  const [rawArgs, setRawArgs] = useState(rawArgsValue);

  useEffect(() => {
    setType(entity.type);
    setName(entity.name);
    setDescription(entity.description);
    setRawArgs(rawArgsValue);
  }, [entity.description, entity.id, entity.name, entity.type, rawArgsValue]);

  return (
    <ScrollView style={styles.panelScroll}>
      <DropdownField
        label="Class"
        options={ENTITY_TYPES}
        value={type}
        onChange={setType}
      />
      <LabeledInput label="Name" value={name} onChangeText={setName} />
      <LabeledInput
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <LabeledInput
        label="Raw STEP arguments"
        value={rawArgs}
        onChangeText={setRawArgs}
        multiline
        mono
      />
      <Button
        label="Save Entity"
        primary
        onPress={() => onSave({ description, name, rawArgs, type })}
      />
    </ScrollView>
  );
}

function PlacementPanel({
  document,
  selectedId,
  onMove,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onMove(x: string, y: string, z: string): void;
}) {
  const placement = getNativePlacement(document, selectedId);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [z, setZ] = useState("0");

  useEffect(() => {
    if (!placement) {
      setX("0");
      setY("0");
      setZ("0");
      return;
    }
    setX(String(placement.x));
    setY(String(placement.y));
    setZ(String(placement.z));
  }, [placement?.pointId, placement?.x, placement?.y, placement?.z]);

  if (!placement) {
    return (
      <View style={styles.diffEmpty}>
        <Text style={styles.infoTitle}>No editable local placement</Text>
        <Text style={styles.empty}>
          Select a product with IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D →
          IFCCARTESIANPOINT to draft a numeric XYZ move.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Selected placement">
        <InfoRow label="Product" value={`#${placement.productId}`} />
        <InfoRow label="Placement" value={`#${placement.placementId}`} />
        <InfoRow label="Axis" value={`#${placement.axisPlacementId}`} />
        <InfoRow label="Point" value={`#${placement.pointId}`} />
        <InfoRow
          label="Relative to"
          value={placement.relativeTo ? `#${placement.relativeTo}` : "$"}
        />
      </InfoSection>
      <InfoSection title="Draft move">
        <Text style={styles.empty}>
          Edits update only the placement cartesian point and stay pending until
          reviewed in IFC Diff / Review.
        </Text>
        <View style={styles.row}>
          <View style={styles.flexField}>
            <LabeledInput
              label="X"
              keyboardType="numeric"
              value={x}
              onChangeText={setX}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Y"
              keyboardType="numeric"
              value={y}
              onChangeText={setY}
            />
          </View>
          <View style={styles.flexField}>
            <LabeledInput
              label="Z"
              keyboardType="numeric"
              value={z}
              onChangeText={setZ}
            />
          </View>
        </View>
        <Button
          label="Stage Placement Move"
          primary
          onPress={() => onMove(x, y, z)}
        />
      </InfoSection>
    </ScrollView>
  );
}

function PsetPanel({
  document,
  selectedId,
  onAddPset,
  onAddQuantity,
  onUpdateProperty,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddPset(
    psetName: string,
    propertyName: string,
    propertyValue: string,
    propertyValueType?: string,
  ): void;
  onAddQuantity(
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType?: string,
  ): void;
  onUpdateProperty(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const [psetName, setPsetName] = useState("Pset_IFCnative_Custom");
  const [propertyName, setPropertyName] = useState("Status");
  const [propertyValue, setPropertyValue] = useState("Draft");
  const [propertyValueType, setPropertyValueType] = useState("IFCLABEL");
  const [qtoName, setQtoName] = useState("Qto_IFCnative_BaseQuantities");
  const [quantityName, setQuantityName] = useState("ObservedLength");
  const [quantityValue, setQuantityValue] = useState("1");
  const [quantityType, setQuantityType] = useState("IFCQUANTITYLENGTH");
  const sets = document.propertySetsByEntity.get(selectedId) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Property Set</Text>
        <LabeledInput
          label="Pset name"
          value={psetName}
          onChangeText={setPsetName}
        />
        <LabeledInput
          label="Property"
          value={propertyName}
          onChangeText={setPropertyName}
        />
        <DropdownField
          label="Value type"
          options={PROPERTY_VALUE_TYPES}
          value={propertyValueType}
          onChange={setPropertyValueType}
        />
        <LabeledInput
          label="Value"
          value={propertyValue}
          onChangeText={setPropertyValue}
        />
        <Button
          label="+ Add Pset"
          primary
          onPress={() =>
            onAddPset(psetName, propertyName, propertyValue, propertyValueType)
          }
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Quantity Set</Text>
        <LabeledInput
          label="QTO name"
          value={qtoName}
          onChangeText={setQtoName}
        />
        <LabeledInput
          label="Quantity"
          value={quantityName}
          onChangeText={setQuantityName}
        />
        <DropdownField
          label="Quantity type"
          options={QUANTITY_TYPES}
          value={quantityType}
          onChange={setQuantityType}
        />
        <LabeledInput
          label="Value"
          keyboardType="numeric"
          value={quantityValue}
          onChangeText={setQuantityValue}
        />
        <Button
          label="+ Add Quantity"
          onPress={() =>
            onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
          }
        />
      </View>
      {sets.map((set) => (
        <InfoSection key={set.id} title={`${set.kind} #${set.id} ${set.name}`}>
          {set.values.map((value) => (
            <EditablePropertyRow
              key={value.id}
              property={value}
              rawValue={editableSetValue(
                document.entityById.get(value.id),
                value.value,
              )}
              onUpdate={onUpdateProperty}
            />
          ))}
        </InfoSection>
      ))}
      {!sets.length ? (
        <Text style={styles.empty}>No Psets or QTOs indexed.</Text>
      ) : null}
    </ScrollView>
  );
}

function EditablePropertyRow({
  property,
  rawValue,
  onUpdate,
}: {
  property: { id: number; name: string; value: string; type: string };
  rawValue: string;
  onUpdate(
    propertyId: number,
    propertyName: string,
    propertyValue: string,
    propertyValueType: string,
  ): void;
}) {
  const parsed = parseTypedPropertyValue(rawValue);
  const [name, setName] = useState(property.name);
  const [valueType, setValueType] = useState(parsed.valueType);
  const [value, setValue] = useState(parsed.value);
  const propertyOptions = useMemo(
    () =>
      uniqueStrings([
        ...PROPERTY_VALUE_TYPES,
        ...QUANTITY_TYPES,
        parsed.valueType,
      ]),
    [parsed.valueType],
  );

  useEffect(() => {
    setName(property.name);
    setValueType(parsed.valueType);
    setValue(parsed.value);
  }, [parsed.value, parsed.valueType, property.id, property.name]);

  return (
    <View style={styles.editBlock}>
      <LabeledInput
        label={`Property #${property.id}`}
        value={name}
        onChangeText={setName}
      />
      <DropdownField
        label="Value type"
        options={propertyOptions}
        value={valueType}
        onChange={setValueType}
      />
      <LabeledInput label="Value" value={value} onChangeText={setValue} />
      <Button
        label="Save Property"
        onPress={() => onUpdate(property.id, name, value, valueType)}
      />
    </View>
  );
}

function RelationsPanel({
  document,
  selectedId,
  onAddRelationship,
  onRemoveRelationship,
  onUpdateRelationship,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onRemoveRelationship(relationshipId: number): void;
  onUpdateRelationship(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const relationships = document.relationshipsByEntity.get(selectedId) ?? [];
  const [relType, setRelType] = useState("IFCRELAGGREGATES");
  const [sourceId, setSourceId] = useState(String(selectedId));
  const [targetId, setTargetId] = useState(String(selectedId));
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

  return (
    <ScrollView style={styles.panelScroll}>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Relationship</Text>
        <DropdownField
          label="Relationship class"
          options={RELATION_TYPES}
          value={relType}
          onChange={setRelType}
        />
        <EntityDropdown
          label="Source object"
          document={document}
          value={sourceId}
          onChange={setSourceId}
        />
        <EntityDropdown
          label="Target object"
          document={document}
          value={targetId}
          onChange={setTargetId}
        />
        <Button
          disabled={!validSource || !validTarget}
          label="+ Add Relationship"
          primary
          onPress={() =>
            onAddRelationship(relType, Number(sourceId), Number(targetId))
          }
        />
      </View>
      {relationships.map((relationship) => (
        <InfoSection
          key={relationship.id}
          title={`#${relationship.id} ${relationship.type}`}
        >
          <EditableRelationship
            document={document}
            relationship={relationship}
            selectedId={selectedId}
            onRemove={onRemoveRelationship}
            onUpdate={onUpdateRelationship}
          />
        </InfoSection>
      ))}
      {!relationships.length ? (
        <Text style={styles.empty}>No relationships indexed.</Text>
      ) : null}
    </ScrollView>
  );
}

function EditableRelationship({
  document,
  relationship,
  selectedId,
  onRemove,
  onUpdate,
}: {
  document: NativeIfcDocument;
  relationship: NativeIfcRelationship;
  selectedId: number;
  onRemove(relationshipId: number): void;
  onUpdate(
    relationshipId: number,
    type: string,
    sourceId: number,
    targetId: number,
  ): void;
}) {
  const currentSourceId = relationship.sourceIds[0] ?? selectedId;
  const currentTargetId = relationship.targetIds[0] ?? selectedId;
  const [type, setType] = useState(relationship.type);
  const [sourceId, setSourceId] = useState(String(currentSourceId));
  const [targetId, setTargetId] = useState(String(currentTargetId));
  const typeOptions = useMemo(
    () => uniqueStrings([...RELATION_TYPES, relationship.type]),
    [relationship.type],
  );
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));

  useEffect(() => {
    setType(relationship.type);
    setSourceId(String(currentSourceId));
    setTargetId(String(currentTargetId));
  }, [currentSourceId, currentTargetId, relationship.id, relationship.type]);

  return (
    <View style={styles.editBlock}>
      <InfoRow label="Family" value={relationship.family} />
      <DropdownField
        label="Relationship class"
        options={typeOptions}
        value={type}
        onChange={setType}
      />
      <EntityDropdown
        label="Source object"
        document={document}
        value={sourceId}
        onChange={setSourceId}
      />
      <EntityDropdown
        label="Target object"
        document={document}
        value={targetId}
        onChange={setTargetId}
      />
      <View style={styles.row}>
        <View style={styles.flexField}>
          <Button
            disabled={!validSource || !validTarget}
            label="Save Relationship"
            onPress={() =>
              onUpdate(
                relationship.id,
                type,
                Number(sourceId),
                Number(targetId),
              )
            }
          />
        </View>
        <View style={styles.flexField}>
          <Button
            label="Stage Delete Relationship"
            onPress={() => onRemove(relationship.id)}
          />
        </View>
      </View>
    </View>
  );
}

function ResourcesPanel({
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddMaterial,
  onAssignType,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
}) {
  const resources = document.resourcesByEntity.get(selectedId) ?? [];
  const typeAssignments =
    document.typeAssignmentsByEntity.get(selectedId) ?? [];
  const [materialName, setMaterialName] = useState("Inspection Concrete");
  const [materialCategory, setMaterialCategory] = useState("Concrete");
  const [typeClass, setTypeClass] = useState("IFCTYPEOBJECT");
  const [typeName, setTypeName] = useState("Inspection Element Type");
  const [typeTag, setTypeTag] = useState("TYPE-INSPECTION");
  const [classificationId, setClassificationId] = useState(
    "IFCNATIVE-INSPECTION",
  );
  const [classificationName, setClassificationName] =
    useState("Inspection Target");
  const [classificationUri, setClassificationUri] = useState(
    "https://ifcnative.local/classification/inspection-target",
  );
  const [documentId, setDocumentId] = useState("DOC-INSPECTION");
  const [documentName, setDocumentName] = useState("Inspection Report");
  const [documentUri, setDocumentUri] = useState(
    "https://ifcnative.local/documents/inspection-report",
  );

  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Linked Resources">
        {resources.length ? (
          resources.map((resource) => (
            <Text key={resource} style={styles.infoText}>
              {resource}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>
            No material, classification or document linked.
          </Text>
        )}
      </InfoSection>
      <InfoSection title="Type assignments">
        {typeAssignments.length ? (
          typeAssignments.map((assignment) => (
            <Text
              key={`${assignment.relationshipId}-${assignment.typeId}`}
              style={styles.infoText}
            >
              #{assignment.relationshipId} → #{assignment.typeId}{" "}
              {assignment.typeClass} {assignment.typeName}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>No IFCRELDEFINESBYTYPE assignment.</Text>
        )}
      </InfoSection>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Assign Type</Text>
        <DropdownField
          label="Type class"
          options={TYPE_CLASSES}
          value={typeClass}
          onChange={setTypeClass}
        />
        <LabeledInput
          label="Type name"
          value={typeName}
          onChangeText={setTypeName}
        />
        <LabeledInput
          label="Type tag"
          value={typeTag}
          onChangeText={setTypeTag}
        />
        <Button
          label="+ Assign Type"
          primary
          onPress={() => onAssignType(typeName, typeClass, typeTag)}
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Material</Text>
        <LabeledInput
          label="Material"
          value={materialName}
          onChangeText={setMaterialName}
        />
        <LabeledInput
          label="Category"
          value={materialCategory}
          onChangeText={setMaterialCategory}
        />
        <Button
          label="+ Add Material"
          primary
          onPress={() => onAddMaterial(materialName, materialCategory)}
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Classification</Text>
        <LabeledInput
          label="Identification"
          value={classificationId}
          onChangeText={setClassificationId}
        />
        <LabeledInput
          label="Name"
          value={classificationName}
          onChangeText={setClassificationName}
        />
        <LabeledInput
          label="Location / URI"
          value={classificationUri}
          onChangeText={setClassificationUri}
        />
        <Button
          label="+ Add Classification"
          onPress={() =>
            onAddClassification(
              classificationId,
              classificationName,
              classificationUri,
            )
          }
        />
      </View>
      <View style={styles.editBlock}>
        <Text style={styles.infoTitle}>Add Document</Text>
        <LabeledInput
          label="Identification"
          value={documentId}
          onChangeText={setDocumentId}
        />
        <LabeledInput
          label="Name"
          value={documentName}
          onChangeText={setDocumentName}
        />
        <LabeledInput
          label="Location / URI"
          value={documentUri}
          onChangeText={setDocumentUri}
        />
        <Button
          label="+ Add Document"
          onPress={() =>
            onAddDocumentReference(documentId, documentName, documentUri)
          }
        />
      </View>
    </ScrollView>
  );
}

function ReferencesPanel({
  document,
  selectedId,
}: {
  document: NativeIfcDocument;
  selectedId: number;
}) {
  const outgoing = document.outgoingRefs.get(selectedId) ?? [];
  const incoming = document.incomingRefs.get(selectedId) ?? [];
  return (
    <ScrollView style={styles.panelScroll}>
      <InfoSection title="Outgoing">
        {outgoing.length ? (
          outgoing.map((id) => (
            <Text key={id} style={styles.infoText}>
              -&gt; #{id} {document.entityById.get(id)?.type ?? ""}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>None.</Text>
        )}
      </InfoSection>
      <InfoSection title="Incoming">
        {incoming.length ? (
          incoming.map((entity) => (
            <Text key={entity.id} style={styles.infoText}>
              &lt;- #{entity.id} {entity.type}
            </Text>
          ))
        ) : (
          <Text style={styles.empty}>None.</Text>
        )}
      </InfoSection>
    </ScrollView>
  );
}

function UnitsPanel({
  document,
  onAddUnit,
}: {
  document: NativeIfcDocument;
  onAddUnit(unitType: string, unitName: string): void;
}) {
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
  return (
    <ScrollView style={styles.panelScroll}>
      <DropdownField
        label="Unit type"
        options={UNIT_TYPES}
        value={unitType}
        onChange={setUnitType}
      />
      <DropdownField
        label="Unit name"
        options={UNIT_NAMES}
        value={unitName}
        onChange={setUnitName}
      />
      <Button
        label="+ Add Unit"
        primary
        onPress={() => onAddUnit(unitType, unitName)}
      />
      {document.units.map((unit) => (
        <Text key={unit} style={styles.infoText}>
          {unit}
        </Text>
      ))}
    </ScrollView>
  );
}

function BuilderPanel({
  document,
  selectedId,
  onAddClassification,
  onAddDocumentReference,
  onAddBodyElement,
  onAssignBodyToSelected,
  onAssignType,
  onAddElement,
  onAddMaterial,
  onAddPset,
  onAddQuantity,
  onAddRelationship,
  onAddUnit,
}: {
  document: NativeIfcDocument;
  selectedId: number;
  onAddClassification(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddDocumentReference(
    identification: string,
    name: string,
    location: string,
  ): void;
  onAddBodyElement(options: BodyElementDraft): void;
  onAssignBodyToSelected(options: BodyElementDraft): void;
  onAssignType(typeName: string, typeClass: string, tag: string): void;
  onAddElement(type: string, name: string, parentId?: number): void;
  onAddMaterial(materialName: string, materialCategory: string): void;
  onAddPset(
    psetName: string,
    propertyName: string,
    propertyValue: string,
    propertyValueType?: string,
  ): void;
  onAddQuantity(
    qtoName: string,
    quantityName: string,
    quantityValue: string,
    quantityType?: string,
  ): void;
  onAddRelationship(type: string, sourceId: number, targetId: number): void;
  onAddUnit(unitType: string, unitName: string): void;
}) {
  const [type, setType] = useState("IFCBUILDINGELEMENTPROXY");
  const [name, setName] = useState("New Element");
  const [bodyType, setBodyType] = useState("IFCBUILTELEMENT");
  const [bodyName, setBodyName] = useState("New Body Element");
  const [bodyWidth, setBodyWidth] = useState("4");
  const [bodyDepth, setBodyDepth] = useState("2");
  const [bodyHeight, setBodyHeight] = useState("1.5");
  const [bodyProfile, setBodyProfile] = useState<"rectangle" | "cylinder">(
    "rectangle",
  );
  const [bodyX, setBodyX] = useState("0");
  const [bodyY, setBodyY] = useState("0");
  const [bodyZ, setBodyZ] = useState("0");
  const [bodyTag, setBodyTag] = useState("IFCNATIVE-BODY");
  const [relType, setRelType] = useState("IFCRELAGGREGATES");
  const [sourceId, setSourceId] = useState(String(selectedId));
  const [targetId, setTargetId] = useState(String(selectedId));
  const [psetName, setPsetName] = useState("Pset_IFCnative_Custom");
  const [propertyName, setPropertyName] = useState("Status");
  const [propertyValue, setPropertyValue] = useState("Draft");
  const [propertyValueType, setPropertyValueType] = useState("IFCLABEL");
  const [qtoName, setQtoName] = useState("Qto_IFCnative_BaseQuantities");
  const [quantityName, setQuantityName] = useState("ObservedLength");
  const [quantityValue, setQuantityValue] = useState("1");
  const [quantityType, setQuantityType] = useState("IFCQUANTITYLENGTH");
  const [materialName, setMaterialName] = useState("Inspection Concrete");
  const [materialCategory, setMaterialCategory] = useState("Concrete");
  const [typeClass, setTypeClass] = useState("IFCTYPEOBJECT");
  const [typeName, setTypeName] = useState("Inspection Element Type");
  const [typeTag, setTypeTag] = useState("TYPE-INSPECTION");
  const [classificationId, setClassificationId] = useState(
    "IFCNATIVE-INSPECTION",
  );
  const [classificationName, setClassificationName] =
    useState("Inspection Target");
  const [classificationUri, setClassificationUri] = useState(
    "https://ifcnative.local/classification/inspection-target",
  );
  const [documentId, setDocumentId] = useState("DOC-INSPECTION");
  const [documentName, setDocumentName] = useState("Inspection Report");
  const [documentUri, setDocumentUri] = useState(
    "https://ifcnative.local/documents/inspection-report",
  );
  const [unitType, setUnitType] = useState("LENGTHUNIT");
  const [unitName, setUnitName] = useState("METRE");
  const validSource = document.entityById.has(Number(sourceId));
  const validTarget = document.entityById.has(Number(targetId));
  const canAssignBody = isBodyAssignableEntity(
    document.entityById.get(selectedId),
  );

  useEffect(() => {
    setSourceId(String(selectedId));
    setTargetId(String(selectedId));
  }, [selectedId]);

  return (
    <ScrollView style={styles.panelScroll}>
      <DropdownField
        label="Element class"
        options={ENTITY_TYPES}
        value={type}
        onChange={setType}
      />
      <LabeledInput label="Element name" value={name} onChangeText={setName} />
      <Button
        label="+ Add Element under selected"
        primary
        onPress={() => onAddElement(type, name, selectedId)}
      />
      <View style={styles.separator} />
      <Text style={styles.sectionTitle}>Simple body preset</Text>
      <DropdownField
        label="Body class"
        options={ENTITY_TYPES}
        value={bodyType}
        onChange={setBodyType}
      />
      <LabeledInput
        label="Body name"
        value={bodyName}
        onChangeText={setBodyName}
      />
      <DropdownField
        label="Profile"
        options={["rectangle", "cylinder"]}
        value={bodyProfile}
        onChange={(value) => setBodyProfile(value as "rectangle" | "cylinder")}
      />
      <View style={styles.row}>
        <LabeledInput
          label={bodyProfile === "cylinder" ? "Diameter X" : "Width X"}
          keyboardType="numeric"
          value={bodyWidth}
          onChangeText={setBodyWidth}
        />
        <LabeledInput
          label={bodyProfile === "cylinder" ? "Diameter Y" : "Depth Y"}
          keyboardType="numeric"
          value={bodyDepth}
          onChangeText={setBodyDepth}
        />
      </View>
      <View style={styles.row}>
        <LabeledInput
          label="Height Z"
          keyboardType="numeric"
          value={bodyHeight}
          onChangeText={setBodyHeight}
        />
        <LabeledInput label="Tag" value={bodyTag} onChangeText={setBodyTag} />
      </View>
      <View style={styles.row}>
        <LabeledInput
          label="X"
          keyboardType="numeric"
          value={bodyX}
          onChangeText={setBodyX}
        />
        <LabeledInput
          label="Y"
          keyboardType="numeric"
          value={bodyY}
          onChangeText={setBodyY}
        />
        <LabeledInput
          label="Z"
          keyboardType="numeric"
          value={bodyZ}
          onChangeText={setBodyZ}
        />
      </View>
      <Button
        label={
          bodyProfile === "cylinder"
            ? "+ Add Cylindrical Body under selected"
            : "+ Add Rectangular Body under selected"
        }
        primary
        onPress={() =>
          onAddBodyElement({
            depth: bodyDepth,
            height: bodyHeight,
            name: bodyName,
            parentId: selectedId,
            profile: bodyProfile,
            tag: bodyTag,
            type: bodyType,
            width: bodyWidth,
            x: bodyX,
            y: bodyY,
            z: bodyZ,
          })
        }
      />
      <Button
        disabled={!canAssignBody}
        label={
          bodyProfile === "cylinder"
            ? "Assign Cylindrical Body to selected"
            : "Assign Rectangular Body to selected"
        }
        onPress={() =>
          onAssignBodyToSelected({
            depth: bodyDepth,
            height: bodyHeight,
            name: bodyName,
            profile: bodyProfile,
            tag: bodyTag,
            type: bodyType,
            width: bodyWidth,
            x: bodyX,
            y: bodyY,
            z: bodyZ,
          })
        }
      />
      <View style={styles.separator} />
      <DropdownField
        label="Relationship"
        options={RELATION_TYPES}
        value={relType}
        onChange={setRelType}
      />
      <EntityDropdown
        label="Source object"
        document={document}
        value={sourceId}
        onChange={setSourceId}
      />
      <EntityDropdown
        label="Target object"
        document={document}
        value={targetId}
        onChange={setTargetId}
      />
      <Button
        disabled={!validSource || !validTarget}
        label="+ Add Relationship"
        onPress={() =>
          onAddRelationship(relType, Number(sourceId), Number(targetId))
        }
      />
      <View style={styles.separator} />
      <LabeledInput label="Pset" value={psetName} onChangeText={setPsetName} />
      <LabeledInput
        label="Property"
        value={propertyName}
        onChangeText={setPropertyName}
      />
      <DropdownField
        label="Value type"
        options={PROPERTY_VALUE_TYPES}
        value={propertyValueType}
        onChange={setPropertyValueType}
      />
      <LabeledInput
        label="Value"
        value={propertyValue}
        onChangeText={setPropertyValue}
      />
      <Button
        label="+ Add Pset to selected"
        onPress={() =>
          onAddPset(psetName, propertyName, propertyValue, propertyValueType)
        }
      />
      <View style={styles.separator} />
      <LabeledInput label="QTO" value={qtoName} onChangeText={setQtoName} />
      <LabeledInput
        label="Quantity"
        value={quantityName}
        onChangeText={setQuantityName}
      />
      <DropdownField
        label="Quantity type"
        options={QUANTITY_TYPES}
        value={quantityType}
        onChange={setQuantityType}
      />
      <LabeledInput
        label="Quantity value"
        keyboardType="numeric"
        value={quantityValue}
        onChangeText={setQuantityValue}
      />
      <Button
        label="+ Add Quantity to selected"
        onPress={() =>
          onAddQuantity(qtoName, quantityName, quantityValue, quantityType)
        }
      />
      <View style={styles.separator} />
      <LabeledInput
        label="Material"
        value={materialName}
        onChangeText={setMaterialName}
      />
      <LabeledInput
        label="Material category"
        value={materialCategory}
        onChangeText={setMaterialCategory}
      />
      <Button
        label="+ Add Material to selected"
        onPress={() => onAddMaterial(materialName, materialCategory)}
      />
      <View style={styles.separator} />
      <DropdownField
        label="Type class"
        options={TYPE_CLASSES}
        value={typeClass}
        onChange={setTypeClass}
      />
      <LabeledInput
        label="Type name"
        value={typeName}
        onChangeText={setTypeName}
      />
      <LabeledInput
        label="Type tag"
        value={typeTag}
        onChangeText={setTypeTag}
      />
      <Button
        label="+ Assign Type to selected"
        onPress={() => onAssignType(typeName, typeClass, typeTag)}
      />
      <View style={styles.separator} />
      <LabeledInput
        label="Classification ID"
        value={classificationId}
        onChangeText={setClassificationId}
      />
      <LabeledInput
        label="Classification name"
        value={classificationName}
        onChangeText={setClassificationName}
      />
      <LabeledInput
        label="Classification URI"
        value={classificationUri}
        onChangeText={setClassificationUri}
      />
      <Button
        label="+ Add Classification"
        onPress={() =>
          onAddClassification(
            classificationId,
            classificationName,
            classificationUri,
          )
        }
      />
      <View style={styles.separator} />
      <LabeledInput
        label="Document ID"
        value={documentId}
        onChangeText={setDocumentId}
      />
      <LabeledInput
        label="Document name"
        value={documentName}
        onChangeText={setDocumentName}
      />
      <LabeledInput
        label="Document URI"
        value={documentUri}
        onChangeText={setDocumentUri}
      />
      <Button
        label="+ Add Document"
        onPress={() =>
          onAddDocumentReference(documentId, documentName, documentUri)
        }
      />
      <View style={styles.separator} />
      <DropdownField
        label="Unit type"
        options={UNIT_TYPES}
        value={unitType}
        onChange={setUnitType}
      />
      <DropdownField
        label="Unit name"
        options={UNIT_NAMES}
        value={unitName}
        onChange={setUnitName}
      />
      <Button
        label="+ Add Unit"
        onPress={() => onAddUnit(unitType, unitName)}
      />
      <Text style={styles.empty}>
        Current selection: #{selectedId}{" "}
        {document.entityById.get(selectedId)?.type}
      </Text>
    </ScrollView>
  );
}

function DiffPanel({
  currentText,
  pendingSummary,
  pendingText,
  onApply,
  onDiscard,
}: {
  currentText: string;
  pendingSummary: string;
  pendingText: string;
  onApply(): void;
  onDiscard(): void;
}) {
  const lines = useMemo(
    () =>
      pendingText ? previewEntityAwareDiffLines(currentText, pendingText) : [],
    [currentText, pendingText],
  );
  const summary = useMemo(
    () =>
      pendingText
        ? summarizeEntityAwareDiff(currentText, pendingText)
        : undefined,
    [currentText, pendingText],
  );
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;

  if (!pendingText) {
    return (
      <View style={styles.diffEmpty}>
        <Text style={styles.infoTitle}>No pending IFC changes</Text>
        <Text style={styles.empty}>
          Builder, inspector and graph edits create a draft first. Review this
          diff, then apply it before export.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.console}>
      <View style={styles.diffHeader}>
        <View style={styles.diffHeaderText}>
          <Text style={styles.infoTitle}>{pendingSummary}</Text>
          <Text style={styles.empty}>
            {summary?.changedEntities ?? 0} changed /{" "}
            {summary?.addedEntities ?? 0} added /{" "}
            {summary?.removedEntities ?? 0} removed STEP entities. IFC export
            stays disabled until this draft is applied or discarded.
          </Text>
        </View>
        <View style={styles.actions}>
          <Button label="Apply" primary onPress={onApply} />
          <Button label="Discard" onPress={onDiscard} />
        </View>
      </View>
      {summary &&
      (summary.relationshipChanges.length > 0 ||
        summary.placementChanges.length > 0 ||
        summary.geometryChanges.length > 0) ? (
        <View style={styles.diffSummaryGrid}>
          {summary.placementChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Placement changes</Text>
              {summary.placementChanges.slice(0, 5).map((change) => (
                <Text key={change.pointId} style={styles.diffSummaryText}>
                  #{change.pointId}
                  {formatPlacementProducts(change)} XYZ{" "}
                  {formatPoint(change.before)} → {formatPoint(change.after)} Δ{" "}
                  {formatPoint(change.delta)}
                </Text>
              ))}
            </View>
          ) : null}
          {summary.relationshipChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Relationship changes</Text>
              {summary.relationshipChanges.slice(0, 5).map((change) => (
                <Text
                  key={`${change.action}-${change.id}`}
                  style={styles.diffSummaryText}
                >
                  #{change.id} {change.type} {change.action}:{" "}
                  {change.after ?? change.before}
                </Text>
              ))}
            </View>
          ) : null}
          {summary.geometryChanges.length > 0 ? (
            <View style={styles.diffSummaryCard}>
              <Text style={styles.diffSummaryTitle}>Geometry changes</Text>
              {summary.geometryChanges.slice(0, 5).map((change) => (
                <Text
                  key={`${change.action}-${change.id}`}
                  style={styles.diffSummaryText}
                >
                  #{change.id}
                  {formatGeometryProducts(change)} {change.action}:{" "}
                  {change.after ?? change.before}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <ScrollView style={styles.diffLines}>
        <Text style={styles.diffLine}>
          {" "}
          Raw hunks: {added} additions / {removed} removals
        </Text>
        {lines.map((line, index) => (
          <Text
            key={`${line.kind}-${index}-${line.text}`}
            style={[
              styles.diffLine,
              line.kind === "add" && styles.diffLineAdd,
              line.kind === "remove" && styles.diffLineRemove,
            ]}
          >
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}{" "}
            {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function formatPoint(point: [number, number, number]) {
  return `(${point
    .map((value) =>
      Number(value)
        .toFixed(3)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1"),
    )
    .join(", ")})`;
}

function formatPlacementProducts(
  change: ReturnType<
    typeof summarizeEntityAwareDiff
  >["placementChanges"][number],
) {
  if (!change.affectedProducts.length) {
    return "";
  }
  const labels = change.affectedProducts
    .slice(0, 3)
    .map(
      (product) =>
        `#${product.id} ${product.type}${product.name ? ` '${product.name}'` : ""}`,
    )
    .join(", ");
  return ` (${labels}${change.affectedProducts.length > 3 ? " …" : ""})`;
}

function formatGeometryProducts(
  change: ReturnType<
    typeof summarizeEntityAwareDiff
  >["geometryChanges"][number],
) {
  if (!change.affectedProducts.length) {
    return "";
  }
  const labels = change.affectedProducts
    .slice(0, 3)
    .map(
      (product) =>
        `#${product.id} ${product.type}${product.name ? ` '${product.name}'` : ""}`,
    )
    .join(", ");
  return ` (${labels}${change.affectedProducts.length > 3 ? " …" : ""})`;
}

function ConsolePanel({
  lines,
  onClear,
}: {
  lines: string[];
  onClear(): void;
}) {
  return (
    <View style={styles.console}>
      <Button label="Clear" onPress={onClear} />
      <ScrollView style={styles.consoleLines}>
        {lines.map((line, index) => (
          <Text key={`${line}-${index}`} style={styles.consoleLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function DiagnosticsPanel({ document }: { document: NativeIfcDocument }) {
  return (
    <ScrollView style={styles.panelScroll}>
      {document.diagnostics.map((diagnostic) => (
        <Text key={diagnostic} style={styles.monoLine}>
          {diagnostic}
        </Text>
      ))}
    </ScrollView>
  );
}

function LabeledInput({
  keyboardType,
  label,
  multiline,
  mono,
  onChangeText,
  value,
}: {
  keyboardType?: "default" | "numeric";
  label: string;
  multiline?: boolean;
  mono?: boolean;
  onChangeText(value: string): void;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.textArea,
          mono && styles.monoInput,
        ]}
        value={value}
      />
    </View>
  );
}

interface DropdownOption {
  value: string;
  label: string;
  detail?: string;
}

function DropdownField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: (string | DropdownOption)[];
  value: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const normalized = useMemo(
    () => normalizeDropdownOptions(options),
    [options],
  );
  const selected = normalized.find((option) => option.value === value) ?? {
    detail: "custom value",
    label: value || "Select",
    value,
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={styles.dropdownButton}
      >
        <View style={styles.dropdownTextWrap}>
          <Text style={styles.dropdownButtonText} numberOfLines={1}>
            {selected.label}
          </Text>
          {selected.detail ? (
            <Text style={styles.dropdownDetail} numberOfLines={1}>
              {selected.detail}
            </Text>
          ) : null}
        </View>
        <Text style={styles.dropdownCaret}>{open ? "^" : "v"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.dropdownMenu}>
          <ScrollView nestedScrollEnabled style={styles.dropdownList}>
            {normalized.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[
                  styles.dropdownOption,
                  value === option.value && styles.dropdownOptionActive,
                ]}
              >
                <Text
                  style={[
                    styles.dropdownOptionText,
                    value === option.value && styles.dropdownOptionTextActive,
                  ]}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {option.detail ? (
                  <Text
                    style={[
                      styles.dropdownOptionDetail,
                      value === option.value && styles.dropdownOptionTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {option.detail}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function EntityDropdown({
  document,
  label,
  value,
  onChange,
}: {
  document: NativeIfcDocument;
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const options = useMemo(() => {
    const selected = document.entityById.get(Number(value));
    const priorityTypes = new Set([
      "IFCPROJECT",
      "IFCSITE",
      "IFCBUILDING",
      "IFCBUILDINGSTOREY",
      "IFCSPACE",
      "IFCBUILDINGELEMENTPROXY",
      "IFCBUILTELEMENT",
      "IFCWALL",
      "IFCSLAB",
      "IFCBEAM",
      "IFCCOLUMN",
      "IFCDOOR",
      "IFCWINDOW",
      "IFCPROPERTYSET",
      "IFCELEMENTQUANTITY",
      "IFCMATERIAL",
      "IFCGROUP",
    ]);
    const priority = document.entities
      .filter((entity) => priorityTypes.has(entity.type))
      .slice(0, 260);
    const fallback = document.entities.slice(0, 260);
    return normalizeDropdownOptions([
      ...(selected ? [entityDropdownOption(selected)] : []),
      ...priority.map(entityDropdownOption),
      ...fallback.map(entityDropdownOption),
    ]);
  }, [document, value]);

  return (
    <DropdownField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function normalizeDropdownOptions(options: (string | DropdownOption)[]) {
  const seen = new Set<string>();
  const normalized: DropdownOption[] = [];
  for (const option of options) {
    const item =
      typeof option === "string"
        ? { label: shortType(option), value: option }
        : option;
    if (!item.value || seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);
    normalized.push(item);
  }
  return normalized;
}

function typeOption(value: string): DropdownOption {
  return {
    label: shortType(value),
    value,
  };
}

function entityDropdownOption(entity: NativeIfcEntity): DropdownOption {
  return {
    detail: entity.name || entity.globalId || entity.description || "",
    label: `#${entity.id} ${shortType(entity.type)}`,
    value: String(entity.id),
  };
}

function editableSetValue(
  entity: NativeIfcEntity | undefined,
  fallback: string,
) {
  if (!entity) {
    return fallback;
  }
  if (QUANTITY_TYPES.includes(entity.type)) {
    return `${entity.type}(${entity.args[3] ?? "0"})`;
  }
  return entity.args[2] ?? fallback;
}

function parseTypedPropertyValue(rawValue: string) {
  const trimmed = rawValue.trim();
  const match = trimmed.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (!match) {
    return { value: trimmed === "-" ? "" : trimmed, valueType: "IFCLABEL" };
  }
  const valueType = normalizePropertyValueType(match[1]);
  const inner = match[2].trim();
  if (valueType === "IFCBOOLEAN") {
    const flag = inner.replace(/^\./, "").replace(/\.$/, "").toUpperCase();
    return { value: flag === "F" ? "False" : "True", valueType };
  }
  const unquoted = inner.match(/^'([\s\S]*)'$/)?.[1];
  if (unquoted != null) {
    return { value: unquoted.replace(/''/g, "'"), valueType };
  }
  return { value: inner.replace(/^\./, "").replace(/\.$/, ""), valueType };
}

function normalizePropertyValueType(type: string) {
  const normalized = type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "");
  return normalized.startsWith("IFC") ? normalized : "IFCLABEL";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function InfoSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.infoSection}>
      <Text style={styles.infoTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoText}>{value}</Text>
    </View>
  );
}

interface GraphLayoutNode extends Point {
  id: number;
}

interface GraphLayoutCandidate {
  desiredY: number;
  fixed: boolean;
  id: number;
}

interface GraphLayoutColumnCandidate {
  desiredX: number;
  fixed: boolean;
  id: number;
}

const GRAPH_AGGREGATE_RELATIONSHIP_TYPE = "IFCRELAGGREGATES";
const GRAPH_ORIGIN_X = 44;
const GRAPH_ORIGIN_Y = 46;
const GRAPH_COLUMN_GAP = 340;
const GRAPH_ROW_GAP = 118;
const GRAPH_MIN_ROW_GAP = 104;
const GRAPH_TREE_COLUMN_GAP = 310;
const GRAPH_TREE_LEVEL_GAP = 172;
const GRAPH_TREE_MIN_COLUMN_GAP = 286;
const GRAPH_SIDE_BRANCH_GAP = 340;
const GRAPH_SIDE_BRANCH_ROW_GAP = 112;
const GRAPH_TENSION_ITERATIONS = 72;

function buildGraph(
  document: NativeIfcDocument,
  selectedId: number,
  pinned: Set<number>,
  expanded: Set<number>,
  collapsed: Set<number>,
  depth: number,
  preset: NativeGraphPreset,
  relationshipTypes: Set<string>,
) {
  return buildNativeGraphNeighborhood(document, {
    collapsed,
    depth,
    expanded,
    pinned,
    preset,
    relationshipTypes,
    selectedId,
  });
}

function layoutGraph(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
  pinned: Set<number>,
  mode: RelationshipFlowLayoutMode,
): GraphLayoutNode[] {
  const aggregateTree = hasAggregateGraphEdges(edges);
  const layoutLevels = aggregateTree
    ? buildAggregateTreeLevels(nodeIds, edges, levels)
    : levels;
  const initial = aggregateTree
    ? layoutAggregateTreeGraph(nodeIds, layoutLevels, edges, manual)
    : layoutGraphColumns(nodeIds, layoutLevels, edges, manual);
  const positions =
    mode === "tension"
      ? applyTensionLayout(
          initial,
          nodeIds,
          layoutLevels,
          edges,
          manual,
          pinned,
          aggregateTree,
        )
      : initial;
  return nodeIds.flatMap((id) => {
    const point = positions.get(id);
    return point ? [{ id, x: point.x, y: point.y }] : [];
  });
}

function layoutAggregateTreeGraph(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
) {
  const nodeSet = new Set(nodeIds);
  const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
  const sideAttachments = buildSideAttachmentLookup(
    edges,
    nodeSet,
    aggregateParticipants,
  );
  const treeNodeIds = nodeIds.filter((id) => !sideAttachments.targets.has(id));
  const grouped = groupNodeIdsByLevel(
    treeNodeIds.length ? treeNodeIds : nodeIds,
    levels,
  );
  const parentLookup = buildAggregateParentLookup(edges, nodeSet);
  const positions = new Map<number, Point>();
  for (const [level, ids] of sortedLevelEntries(grouped)) {
    const siblingLookup = buildSiblingLookup(ids, parentLookup, level);
    const candidates = ids.map((id, index) => {
      const existing = manual.get(id);
      const parentIds = parentLookup.get(id) ?? [];
      const parentX = averageDefined(
        parentIds.map(
          (parentId) => positions.get(parentId)?.x ?? manual.get(parentId)?.x,
        ),
      );
      const sibling = siblingLookup.get(id);
      const siblingOffset = sibling
        ? (sibling.index - (sibling.count - 1) / 2) * GRAPH_TREE_COLUMN_GAP
        : 0;
      return {
        desiredX:
          existing?.x ??
          (parentX === undefined
            ? GRAPH_ORIGIN_X + index * GRAPH_TREE_COLUMN_GAP
            : parentX + siblingOffset),
        fixed: Boolean(existing),
        id,
      } satisfies GraphLayoutColumnCandidate;
    });
    const columnPositions = spreadLevelColumns(candidates);
    for (const candidate of candidates) {
      const existing = manual.get(candidate.id);
      positions.set(candidate.id, {
        x:
          existing?.x ??
          columnPositions.get(candidate.id) ??
          candidate.desiredX,
        y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
      });
    }
  }
  placeSideBranches(
    nodeIds,
    levels,
    sideAttachments.sources,
    positions,
    manual,
  );
  for (const id of nodeIds) {
    if (positions.has(id)) {
      continue;
    }
    const existing = manual.get(id);
    const level = levels.get(id) ?? 0;
    positions.set(id, {
      x: existing?.x ?? GRAPH_ORIGIN_X + level * GRAPH_TREE_COLUMN_GAP,
      y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
    });
  }
  return positions;
}

function layoutGraphColumns(
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
) {
  const grouped = groupNodeIdsByLevel(nodeIds, levels);
  const nodeSet = new Set(nodeIds);
  const parentLookup = buildDirectedParentLookup(edges, nodeSet, levels);
  const positions = new Map<number, Point>();
  for (const [level, ids] of sortedLevelEntries(grouped)) {
    const siblingLookup = buildSiblingLookup(ids, parentLookup, level);
    const candidates = ids.map((id, index) => {
      const existing = manual.get(id);
      const parentIds = parentLookup.get(id) ?? [];
      const parentY = averageDefined(
        parentIds.map(
          (parentId) => positions.get(parentId)?.y ?? manual.get(parentId)?.y,
        ),
      );
      const sibling = siblingLookup.get(id);
      const siblingOffset = sibling
        ? (sibling.index - (sibling.count - 1) / 2) * GRAPH_ROW_GAP
        : 0;
      return {
        desiredY:
          existing?.y ??
          (parentY === undefined
            ? GRAPH_ORIGIN_Y + index * GRAPH_ROW_GAP
            : parentY + siblingOffset),
        fixed: Boolean(existing),
        id,
      } satisfies GraphLayoutCandidate;
    });
    const rowPositions = spreadLevelRows(candidates);
    for (const candidate of candidates) {
      const existing = manual.get(candidate.id);
      const levelValue = levels.get(candidate.id) ?? level;
      positions.set(candidate.id, {
        x: existing?.x ?? GRAPH_ORIGIN_X + levelValue * GRAPH_COLUMN_GAP,
        y: existing?.y ?? rowPositions.get(candidate.id) ?? candidate.desiredY,
      });
    }
  }
  return positions;
}

function applyTensionLayout(
  initial: Map<number, Point>,
  nodeIds: number[],
  levels: Map<number, number>,
  edges: NativeGraphEdge[],
  manual: Map<number, Point>,
  pinned: Set<number>,
  aggregateTree: boolean,
) {
  const nodeSet = new Set(nodeIds);
  const fixed = new Set<number>();
  for (const id of manual.keys()) {
    if (nodeSet.has(id)) {
      fixed.add(id);
    }
  }
  for (const id of pinned) {
    if (nodeSet.has(id)) {
      fixed.add(id);
    }
  }
  const grouped = groupNodeIdsByLevel(nodeIds, levels);
  const neighborLookup = buildUndirectedNeighborLookup(edges, nodeSet);
  let positions = new Map(initial);
  for (
    let iteration = 0;
    iteration < GRAPH_TENSION_ITERATIONS;
    iteration += 1
  ) {
    const nextPositions = new Map(positions);
    for (const id of nodeIds) {
      if (fixed.has(id)) {
        continue;
      }
      const position = positions.get(id);
      if (!position) {
        continue;
      }
      const level = levels.get(id) ?? 0;
      let forceX = aggregateTree
        ? 0
        : (GRAPH_ORIGIN_X + level * GRAPH_COLUMN_GAP - position.x) * 0.12;
      let forceY = aggregateTree
        ? (GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP - position.y) * 0.12
        : 0;
      for (const neighborId of neighborLookup.get(id) ?? []) {
        const neighborPosition = positions.get(neighborId);
        if (!neighborPosition) {
          continue;
        }
        const neighborLevel = levels.get(neighborId) ?? level;
        if (aggregateTree) {
          const targetY =
            neighborPosition.y + (level - neighborLevel) * GRAPH_TREE_LEVEL_GAP;
          forceX += (neighborPosition.x - position.x) * 0.045;
          forceY += (targetY - position.y) * 0.018;
        } else {
          const targetX =
            neighborPosition.x + (level - neighborLevel) * GRAPH_COLUMN_GAP;
          forceX += (targetX - position.x) * 0.018;
          forceY += (neighborPosition.y - position.y) * 0.045;
        }
      }
      for (const peerId of grouped.get(level) ?? []) {
        if (peerId === id) {
          continue;
        }
        const peerPosition = positions.get(peerId);
        if (!peerPosition) {
          continue;
        }
        const distance = aggregateTree
          ? position.x - peerPosition.x
          : position.y - peerPosition.y;
        const absoluteDistance = Math.abs(distance);
        const minimumGap = aggregateTree
          ? GRAPH_TREE_MIN_COLUMN_GAP
          : GRAPH_MIN_ROW_GAP;
        if (absoluteDistance < minimumGap) {
          const direction =
            distance === 0 ? (id > peerId ? 1 : -1) : Math.sign(distance);
          if (aggregateTree) {
            forceX += direction * (minimumGap - absoluteDistance) * 0.09;
          } else {
            forceY += direction * (minimumGap - absoluteDistance) * 0.09;
          }
        }
      }
      nextPositions.set(id, {
        x: position.x + clampValue(forceX, -34, 34),
        y: position.y + clampValue(forceY, -34, 34),
      });
    }
    positions = aggregateTree
      ? spreadFlexibleColumns(nextPositions, grouped, fixed)
      : spreadFlexibleRows(nextPositions, grouped, fixed);
  }
  if (aggregateTree) {
    const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
    const sideAttachments = buildSideAttachmentLookup(
      edges,
      nodeSet,
      aggregateParticipants,
    );
    for (const target of sideAttachments.targets) {
      if (!manual.has(target)) {
        positions.delete(target);
      }
    }
    placeSideBranches(
      nodeIds,
      levels,
      sideAttachments.sources,
      positions,
      manual,
    );
  }
  return positions;
}

function groupNodeIdsByLevel(nodeIds: number[], levels: Map<number, number>) {
  const grouped = new Map<number, number[]>();
  for (const id of nodeIds) {
    const level = levels.get(id) ?? 0;
    const ids = grouped.get(level);
    if (ids) {
      ids.push(id);
    } else {
      grouped.set(level, [id]);
    }
  }
  return grouped;
}

function sortedLevelEntries(grouped: Map<number, number[]>) {
  return [...grouped.entries()].sort(
    ([leftLevel], [rightLevel]) => leftLevel - rightLevel,
  );
}

function buildDirectedParentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
  levels: Map<number, number>,
) {
  const parents = new Map<number, number[]>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      continue;
    }
    const sourceLevel = levels.get(edge.source) ?? 0;
    const targetLevel = levels.get(edge.target) ?? 0;
    const parentId = sourceLevel <= targetLevel ? edge.source : edge.target;
    const childId = sourceLevel <= targetLevel ? edge.target : edge.source;
    if (parentId === childId) {
      continue;
    }
    const parentIds = parents.get(childId);
    if (parentIds) {
      if (!parentIds.includes(parentId)) {
        parentIds.push(parentId);
      }
    } else {
      parents.set(childId, [parentId]);
    }
  }
  return parents;
}

function buildAggregateParentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const parents = new Map<number, number[]>();
  for (const edge of edges) {
    if (
      !isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const parentIds = parents.get(edge.target);
    if (parentIds) {
      if (!parentIds.includes(edge.source)) {
        parentIds.push(edge.source);
      }
    } else {
      parents.set(edge.target, [edge.source]);
    }
  }
  return parents;
}

function buildAggregateParticipantSet(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const participants = new Set<number>();
  for (const edge of edges) {
    if (
      isAggregateGraphEdge(edge) &&
      nodeSet.has(edge.source) &&
      nodeSet.has(edge.target)
    ) {
      participants.add(edge.source);
      participants.add(edge.target);
    }
  }
  return participants;
}

function buildSideAttachmentLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
  aggregateParticipants: Set<number>,
) {
  const targetToSource = new Map<number, number>();
  for (const edge of edges) {
    if (
      isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      aggregateParticipants.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const currentSource = targetToSource.get(edge.target);
    if (
      currentSource === undefined ||
      (!aggregateParticipants.has(currentSource) &&
        aggregateParticipants.has(edge.source))
    ) {
      targetToSource.set(edge.target, edge.source);
    }
  }
  const sources = new Map<number, number[]>();
  for (const [target, source] of targetToSource) {
    const targets = sources.get(source);
    if (targets) {
      targets.push(target);
    } else {
      sources.set(source, [target]);
    }
  }
  for (const targets of sources.values()) {
    targets.sort((leftId, rightId) => leftId - rightId);
  }
  return { sources, targets: new Set(targetToSource.keys()) };
}

function placeSideBranches(
  nodeIds: number[],
  levels: Map<number, number>,
  sideSources: Map<number, number[]>,
  positions: Map<number, Point>,
  manual: Map<number, Point>,
) {
  const nodeSet = new Set(nodeIds);
  for (let pass = 0; pass < nodeIds.length; pass += 1) {
    let placed = false;
    for (const [source, targets] of sideSources) {
      const sourcePosition = positions.get(source);
      if (!sourcePosition) {
        continue;
      }
      const visibleTargets = targets.filter((target) => nodeSet.has(target));
      visibleTargets.forEach((target, index) => {
        if (positions.has(target)) {
          return;
        }
        const existing = manual.get(target);
        const offset =
          (index - (visibleTargets.length - 1) / 2) * GRAPH_SIDE_BRANCH_ROW_GAP;
        positions.set(target, {
          x: existing?.x ?? sourcePosition.x + GRAPH_SIDE_BRANCH_GAP,
          y: existing?.y ?? sourcePosition.y + offset,
        });
        placed = true;
      });
    }
    if (!placed) {
      break;
    }
  }
  spreadRelativeSideBranches(positions, sideSources, manual);
  for (const target of [...sideSources.values()].flat()) {
    if (positions.has(target)) {
      continue;
    }
    const existing = manual.get(target);
    const level = levels.get(target) ?? 0;
    positions.set(target, {
      x: existing?.x ?? GRAPH_ORIGIN_X + (level + 1) * GRAPH_SIDE_BRANCH_GAP,
      y: existing?.y ?? GRAPH_ORIGIN_Y + level * GRAPH_TREE_LEVEL_GAP,
    });
  }
}

function spreadRelativeSideBranches(
  positions: Map<number, Point>,
  sideSources: Map<number, number[]>,
  manual: Map<number, Point>,
) {
  for (const [source, targets] of sideSources) {
    const sourcePosition = positions.get(source);
    if (!sourcePosition) {
      continue;
    }
    const placedTargets = targets
      .filter((target) => positions.has(target) && !manual.has(target))
      .sort((leftId, rightId) => leftId - rightId);
    placedTargets.forEach((target, index) => {
      const position = positions.get(target);
      if (!position) {
        return;
      }
      const offset =
        (index - (placedTargets.length - 1) / 2) * GRAPH_SIDE_BRANCH_ROW_GAP;
      positions.set(target, {
        x: position.x,
        y: sourcePosition.y + offset,
      });
    });
  }
}

function buildAggregateTreeLevels(
  nodeIds: number[],
  edges: NativeGraphEdge[],
  fallbackLevels: Map<number, number>,
) {
  const nodeSet = new Set(nodeIds);
  const aggregateParticipants = buildAggregateParticipantSet(edges, nodeSet);
  const children = new Map<number, number[]>();
  const hasParent = new Set<number>();
  for (const edge of edges) {
    if (
      !isAggregateGraphEdge(edge) ||
      !nodeSet.has(edge.source) ||
      !nodeSet.has(edge.target) ||
      edge.source === edge.target
    ) {
      continue;
    }
    const sourceChildren = children.get(edge.source);
    if (sourceChildren) {
      if (!sourceChildren.includes(edge.target)) {
        sourceChildren.push(edge.target);
      }
    } else {
      children.set(edge.source, [edge.target]);
    }
    hasParent.add(edge.target);
  }
  const levels = new Map<number, number>();
  const roots = nodeIds
    .filter((id) => !hasParent.has(id))
    .sort((leftId, rightId) =>
      compareGraphOrder(leftId, rightId, fallbackLevels),
    );
  const queue = roots.map((id) => ({ id, level: 0 }));
  for (const root of roots) {
    levels.set(root, 0);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const child of children
      .get(current.id)
      ?.sort((leftId, rightId) =>
        compareGraphOrder(leftId, rightId, fallbackLevels),
      ) ?? []) {
      const childLevel = current.level + 1;
      if ((levels.get(child) ?? -1) >= childLevel) {
        continue;
      }
      levels.set(child, childLevel);
      queue.push({ id: child, level: childLevel });
    }
  }
  let changed = true;
  for (let pass = 0; pass < nodeIds.length && changed; pass += 1) {
    changed = false;
    for (const edge of edges) {
      if (
        isAggregateGraphEdge(edge) ||
        !nodeSet.has(edge.source) ||
        !nodeSet.has(edge.target) ||
        aggregateParticipants.has(edge.target)
      ) {
        continue;
      }
      const sourceLevel = levels.get(edge.source);
      if (
        sourceLevel === undefined ||
        levels.get(edge.target) === sourceLevel
      ) {
        continue;
      }
      levels.set(edge.target, sourceLevel);
      changed = true;
    }
  }
  for (const id of nodeIds) {
    if (!levels.has(id)) {
      levels.set(id, fallbackLevels.get(id) ?? 0);
    }
  }
  return levels;
}

function compareGraphOrder(
  leftId: number,
  rightId: number,
  fallbackLevels: Map<number, number>,
) {
  return (
    (fallbackLevels.get(leftId) ?? 0) - (fallbackLevels.get(rightId) ?? 0) ||
    leftId - rightId
  );
}

function buildUndirectedNeighborLookup(
  edges: NativeGraphEdge[],
  nodeSet: Set<number>,
) {
  const neighbors = new Map<number, number[]>();
  for (const edge of edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      continue;
    }
    pushUniqueNeighbor(neighbors, edge.source, edge.target);
    pushUniqueNeighbor(neighbors, edge.target, edge.source);
  }
  return neighbors;
}

function pushUniqueNeighbor(
  neighbors: Map<number, number[]>,
  id: number,
  neighborId: number,
) {
  const current = neighbors.get(id);
  if (current) {
    if (!current.includes(neighborId)) {
      current.push(neighborId);
    }
  } else {
    neighbors.set(id, [neighborId]);
  }
}

function buildSiblingLookup(
  ids: number[],
  parentLookup: Map<number, number[]>,
  level: number,
) {
  const groups = new Map<string, number[]>();
  for (const id of ids) {
    const parentId = parentLookup.get(id)?.[0];
    const groupKey =
      parentId === undefined ? `level-${level}` : String(parentId);
    const group = groups.get(groupKey);
    if (group) {
      group.push(id);
    } else {
      groups.set(groupKey, [id]);
    }
  }
  const siblings = new Map<number, { count: number; index: number }>();
  for (const group of groups.values()) {
    group.sort((leftId, rightId) => leftId - rightId);
    group.forEach((id, index) => {
      siblings.set(id, { count: group.length, index });
    });
  }
  return siblings;
}

function spreadFlexibleRows(
  positions: Map<number, Point>,
  grouped: Map<number, number[]>,
  fixed: Set<number>,
) {
  const next = new Map(positions);
  for (const [, ids] of sortedLevelEntries(grouped)) {
    const candidates = ids.flatMap((id) => {
      const position = positions.get(id);
      return position
        ? [
            {
              desiredY: position.y,
              fixed: fixed.has(id),
              id,
            } satisfies GraphLayoutCandidate,
          ]
        : [];
    });
    const rowPositions = spreadLevelRows(candidates);
    for (const candidate of candidates) {
      if (candidate.fixed) {
        continue;
      }
      const position = positions.get(candidate.id);
      const nextY = rowPositions.get(candidate.id);
      if (position && nextY !== undefined) {
        next.set(candidate.id, { x: position.x, y: nextY });
      }
    }
  }
  return next;
}

function spreadFlexibleColumns(
  positions: Map<number, Point>,
  grouped: Map<number, number[]>,
  fixed: Set<number>,
) {
  const next = new Map(positions);
  for (const [, ids] of sortedLevelEntries(grouped)) {
    const candidates = ids.flatMap((id) => {
      const position = positions.get(id);
      return position
        ? [
            {
              desiredX: position.x,
              fixed: fixed.has(id),
              id,
            } satisfies GraphLayoutColumnCandidate,
          ]
        : [];
    });
    const columnPositions = spreadLevelColumns(candidates);
    for (const candidate of candidates) {
      if (candidate.fixed) {
        continue;
      }
      const position = positions.get(candidate.id);
      const nextX = columnPositions.get(candidate.id);
      if (position && nextX !== undefined) {
        next.set(candidate.id, { x: nextX, y: position.y });
      }
    }
  }
  return next;
}

function spreadLevelRows(candidates: GraphLayoutCandidate[]) {
  const sorted = [...candidates].sort(
    (left, right) => left.desiredY - right.desiredY || left.id - right.id,
  );
  const rows = new Map<number, number>();
  let cursor = GRAPH_ORIGIN_Y - GRAPH_MIN_ROW_GAP;
  for (const candidate of sorted) {
    const nextY = candidate.fixed
      ? candidate.desiredY
      : Math.max(candidate.desiredY, cursor + GRAPH_MIN_ROW_GAP);
    rows.set(candidate.id, nextY);
    cursor = Math.max(cursor, nextY);
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const candidate = sorted[index];
    const nextCandidate = sorted[index + 1];
    const currentY = rows.get(candidate.id);
    const nextY = rows.get(nextCandidate.id);
    if (
      currentY === undefined ||
      nextY === undefined ||
      candidate.fixed ||
      currentY <= nextY - GRAPH_MIN_ROW_GAP
    ) {
      continue;
    }
    rows.set(candidate.id, nextY - GRAPH_MIN_ROW_GAP);
  }
  return rows;
}

function spreadLevelColumns(candidates: GraphLayoutColumnCandidate[]) {
  const sorted = [...candidates].sort(
    (left, right) => left.desiredX - right.desiredX || left.id - right.id,
  );
  const columns = new Map<number, number>();
  let cursor = GRAPH_ORIGIN_X - GRAPH_TREE_MIN_COLUMN_GAP;
  for (const candidate of sorted) {
    const nextX = candidate.fixed
      ? candidate.desiredX
      : Math.max(candidate.desiredX, cursor + GRAPH_TREE_MIN_COLUMN_GAP);
    columns.set(candidate.id, nextX);
    cursor = Math.max(cursor, nextX);
  }
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const candidate = sorted[index];
    const nextCandidate = sorted[index + 1];
    const currentX = columns.get(candidate.id);
    const nextX = columns.get(nextCandidate.id);
    if (
      currentX === undefined ||
      nextX === undefined ||
      candidate.fixed ||
      currentX <= nextX - GRAPH_TREE_MIN_COLUMN_GAP
    ) {
      continue;
    }
    columns.set(candidate.id, nextX - GRAPH_TREE_MIN_COLUMN_GAP);
  }
  return columns;
}

function hasAggregateGraphEdges(edges: NativeGraphEdge[]) {
  return edges.some(isAggregateGraphEdge);
}

function isAggregateGraphEdge(edge: NativeGraphEdge) {
  return edge.type.trim().toUpperCase() === GRAPH_AGGREGATE_RELATIONSHIP_TYPE;
}

function averageDefined(values: Array<number | undefined>) {
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  if (!defined.length) {
    return undefined;
  }
  return defined.reduce((total, value) => total + value, 0) / defined.length;
}

function retainPinnedPositions(
  positions: Map<number, Point>,
  pinned: Set<number>,
) {
  const retained = new Map<number, Point>();
  for (const [id, point] of positions) {
    if (pinned.has(id)) {
      retained.set(id, point);
    }
  }
  return retained;
}

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function findTreePath(document: NativeIfcDocument, id: number) {
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

function shortType(type: string) {
  return type.replace(/^IFC/i, "");
}

function isBodyAssignableEntity(entity?: NativeIfcEntity) {
  return (
    Boolean(entity) &&
    !entity?.type.startsWith("IFCREL") &&
    !entity?.type.startsWith("IFCPROPERTY") &&
    !entity?.type.startsWith("IFCQUANTITY") &&
    ![
      "IFCPROJECT",
      "IFCOWNERHISTORY",
      "IFCAPPLICATION",
      "IFCUNITASSIGNMENT",
      "IFCSIUNIT",
    ].includes(entity?.type ?? "") &&
    (entity?.args.length ?? 0) >= 7
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    overflow: "visible",
    zIndex: 101,
  },
  appTitle: {
    color: "#18181b",
    fontSize: 22,
    fontWeight: "800",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4d4d8",
    borderRadius: 7,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonPrimary: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
  },
  buttonPrimaryText: {
    color: "#ffffff",
  },
  buttonText: {
    color: "#18181b",
    fontWeight: "700",
  },
  codeBlock: {
    backgroundColor: "#f4f4f5",
    borderRadius: 6,
    color: "#18181b",
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 11,
    padding: 10,
  },
  console: {
    flex: 1,
    gap: 8,
  },
  consoleLine: {
    color: "#e4e4e7",
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 11,
    paddingVertical: 1,
  },
  consoleLines: {
    backgroundColor: "#09090b",
    borderRadius: 7,
    minHeight: 190,
    padding: 10,
  },
  disabled: {
    opacity: 0.45,
  },
  diffEmpty: {
    alignItems: "flex-start",
    backgroundColor: "#f8fafc",
    borderColor: "#dbe4ee",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    padding: 14,
  },
  diffHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  diffHeaderText: {
    flex: 1,
    minWidth: 220,
  },
  diffSummaryCard: {
    backgroundColor: "#f8fafc",
    borderColor: "#dbe4ee",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: 240,
    padding: 10,
  },
  diffSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  diffSummaryText: {
    color: "#475569",
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 11,
  },
  diffSummaryTitle: {
    color: "#0f172a",
    fontSize: 12,
    fontWeight: "800",
  },
  diffLine: {
    color: "#334155",
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  diffLineAdd: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  diffLineRemove: {
    backgroundColor: "#fee2e2",
    color: "#991b1b",
  },
  diffLines: {
    backgroundColor: "#ffffff",
    borderColor: "#e4e4e7",
    borderRadius: 7,
    borderWidth: 1,
    minHeight: 190,
  },
  dropdownButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4d4d8",
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dropdownButtonText: {
    color: "#18181b",
    fontSize: 12,
    fontWeight: "800",
  },
  dropdownCaret: {
    color: "#0f766e",
    fontSize: 12,
    fontWeight: "900",
  },
  dropdownDetail: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 2,
  },
  dropdownList: {
    maxHeight: 230,
  },
  dropdownMenu: {
    backgroundColor: "#ffffff",
    borderColor: "#d4d4d8",
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 5,
    overflow: "hidden",
  },
  dropdownOption: {
    borderBottomColor: "#f4f4f5",
    borderBottomWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dropdownOptionActive: {
    backgroundColor: "#ccfbf1",
  },
  dropdownOptionDetail: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 2,
  },
  dropdownOptionText: {
    color: "#18181b",
    fontSize: 12,
    fontWeight: "800",
  },
  dropdownOptionTextActive: {
    color: "#0f766e",
  },
  dropdownTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  editBlock: {
    backgroundColor: "#fafafa",
    borderColor: "#e4e4e7",
    borderRadius: 7,
    borderWidth: 1,
    gap: 8,
    marginBottom: 10,
    padding: 10,
  },
  empty: {
    color: "#71717a",
    fontSize: 13,
    paddingVertical: 8,
  },
  field: {
    gap: 5,
    marginBottom: 10,
  },
  fieldLabel: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "700",
  },
  flexField: {
    flex: 1,
    minWidth: 82,
  },
  infoLabel: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "700",
    width: 96,
  },
  infoRow: {
    flexDirection: "row",
    gap: 8,
  },
  infoSection: {
    borderBottomColor: "#e4e4e7",
    borderBottomWidth: 1,
    gap: 6,
    paddingBottom: 12,
    paddingTop: 4,
  },
  infoText: {
    color: "#18181b",
    flex: 1,
    fontSize: 12,
  },
  infoTitle: {
    color: "#18181b",
    fontSize: 14,
    fontWeight: "800",
  },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#d4d4d8",
    borderRadius: 7,
    borderWidth: 1,
    color: "#18181b",
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  monoInput: {
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 11,
  },
  monoLine: {
    color: "#18181b",
    fontFamily: Platform.select({ default: "monospace", ios: "Menlo" }),
    fontSize: 12,
    paddingVertical: 2,
  },
  panelScroll: {
    flex: 1,
    minHeight: 0,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  safeArea: {
    backgroundColor: "#eef1f4",
    flex: 1,
  },
  segment: {
    alignItems: "center",
    borderColor: "#d4d4d8",
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  segmentActive: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
  },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  segmentText: {
    color: "#18181b",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  segmentTextActive: {
    color: "#ffffff",
  },
  separator: {
    backgroundColor: "#e4e4e7",
    height: 1,
    marginVertical: 12,
  },
  sectionTitle: {
    color: "#18181b",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  mosaicShell: {
    flex: 1,
    minHeight: 0,
    padding: 6,
    zIndex: 0,
  },
  tileContent: {
    flex: 1,
    gap: 10,
    minHeight: 0,
    padding: 10,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  topbar: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderBottomColor: "#e4e4e7",
    borderBottomWidth: 1,
    elevation: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    overflow: "visible",
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: "relative",
    zIndex: 100,
  },
  treeItem: {
    backgroundColor: "#ffffff",
    borderColor: "#e4e4e7",
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 6,
    padding: 9,
  },
  treeItemSelected: {
    backgroundColor: "#ccfbf1",
    borderColor: "#0f766e",
  },
  treeMeta: {
    color: "#71717a",
    fontSize: 11,
    marginTop: 3,
  },
  treeTitle: {
    color: "#18181b",
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  treeTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  treeToggle: {
    color: "#0f766e",
    fontSize: 13,
    fontWeight: "900",
    width: 12,
  },
  windowMenu: {
    overflow: "visible",
    position: "relative",
    zIndex: 102,
  },
  windowMenuButton: {
    minWidth: 104,
  },
  windowMenuEmpty: {
    color: "#71717a",
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  windowMenuOption: {
    alignItems: "center",
    borderBottomColor: "#f4f4f5",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  windowMenuOptionMeta: {
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "900",
  },
  windowMenuOptionPressed: {
    backgroundColor: "#ccfbf1",
  },
  windowMenuOptionText: {
    color: "#18181b",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  windowMenuPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d4d4d8",
    borderRadius: 7,
    borderWidth: 1,
    elevation: 12,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 42,
    width: 230,
    zIndex: 103,
  },
  zeroState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
});
