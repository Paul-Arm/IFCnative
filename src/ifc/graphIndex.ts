import type * as WebIFC from "web-ifc";

import type {
    IfcDiagnostic,
    IfcEntitySummary,
    IfcGraphIndex,
    IfcRelationshipLink,
    IfcTreeNode,
} from "./types";
import { asExpressID, asExpressIDs, labelForLine } from "./utils";

const RELATIONSHIP_TYPES = [
  "IFCRELAGGREGATES",
  "IFCRELNESTS",
  "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  "IFCRELREFERENCEDINSPATIALSTRUCTURE",
  "IFCRELDEFINESBYTYPE",
  "IFCRELDEFINESBYPROPERTIES",
  "IFCRELASSIGNSTOGROUP",
  "IFCRELASSIGNSTOPROCESS",
  "IFCRELASSIGNSTOCONTROL",
  "IFCRELASSIGNSTOPRODUCT",
  "IFCRELASSOCIATESMATERIAL",
  "IFCRELASSOCIATESCLASSIFICATION",
  "IFCRELASSOCIATESDOCUMENT",
  "IFCRELASSOCIATESLIBRARY",
  "IFCRELASSOCIATESCONSTRAINT",
  "IFCRELASSOCIATESAPPROVAL",
  "IFCRELCONNECTSELEMENTS",
  "IFCRELCONNECTSPORTS",
  "IFCRELCONNECTSPORTTOELEMENT",
  "IFCRELSPACEBOUNDARY",
  "IFCRELVOIDSELEMENT",
  "IFCRELFILLSELEMENT",
  "IFCRELSEQUENCE",
  "IFCRELSERVICESBUILDINGS",
];

export function buildGraphIndex(
  api: WebIFC.IfcAPI,
  modelID: number,
  entities: IfcEntitySummary[],
  entityCounts: { typeName: string; typeCode: number; count: number }[],
): IfcGraphIndex {
  const diagnostics: IfcDiagnostic[] = [];
  const byExpressID = new Map(
    entities.map((entity) => [entity.expressID, entity]),
  );
  const byGlobalId = new Map(
    entities
      .filter((entity) => entity.globalId)
      .map((entity) => [entity.globalId as string, entity] as const),
  );
  const relationships: IfcRelationshipLink[] = [];
  const aggregateChildren = new Map<number, IfcRelationshipLink[]>();
  const containedChildren = new Map<number, IfcRelationshipLink[]>();
  const typeAssignments = new Map<number, number[]>();
  const typeByOccurrence = new Map<number, number>();
  const groupAssignments = new Map<number, number[]>();
  const materialByObject = new Map<number, number[]>();
  const classificationByObject = new Map<number, number[]>();
  const documentByObject = new Map<number, number[]>();

  for (const relationshipType of RELATIONSHIP_TYPES) {
    for (const line of getLinesByTypeName(
      api,
      modelID,
      relationshipType,
      diagnostics,
    )) {
      const relationshipID = line.expressID as number;
      const link = relationshipLink(relationshipID, relationshipType, line);
      relationships.push(link);

      if (
        relationshipType === "IFCRELAGGREGATES" ||
        relationshipType === "IFCRELNESTS"
      ) {
        addParentLink(aggregateChildren, link);
      } else if (relationshipType === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
        addParentLink(containedChildren, link);
      } else if (
        relationshipType === "IFCRELDEFINESBYTYPE" &&
        link.relatingID
      ) {
        pushMapValues(typeAssignments, link.relatingID, link.relatedIDs);
        link.relatedIDs.forEach((id) =>
          typeByOccurrence.set(id, link.relatingID as number),
        );
      } else if (
        relationshipType === "IFCRELASSIGNSTOGROUP" &&
        link.relatingID
      ) {
        pushMapValues(groupAssignments, link.relatingID, link.relatedIDs);
      } else if (
        relationshipType === "IFCRELASSOCIATESMATERIAL" &&
        link.relatingID
      ) {
        addAssociation(materialByObject, link);
      } else if (
        relationshipType === "IFCRELASSOCIATESCLASSIFICATION" &&
        link.relatingID
      ) {
        addAssociation(classificationByObject, link);
      } else if (
        relationshipType === "IFCRELASSOCIATESDOCUMENT" &&
        link.relatingID
      ) {
        addAssociation(documentByObject, link);
      }
    }
  }

  const projectRoots = entities.filter(
    (entity) => entity.typeName.toUpperCase() === "IFCPROJECT",
  );
  const spatialFallbackRoots = entities.filter((entity) =>
    [
      "IFCSITE",
      "IFCBUILDING",
      "IFCBUILDINGSTOREY",
      "IFCSPACE",
      "IFCFACILITY",
    ].includes(entity.typeName.toUpperCase()),
  );
  const roots =
    projectRoots.length > 0 ? projectRoots : spatialFallbackRoots.slice(0, 1);

  return {
    byExpressID,
    byGlobalId,
    entityCounts,
    spatialTree: roots.map((root) =>
      buildTreeNode(
        root.expressID,
        byExpressID,
        aggregateChildren,
        containedChildren,
        "aggregate",
      ),
    ),
    containmentTree: roots.map((root) =>
      buildTreeNode(
        root.expressID,
        byExpressID,
        containedChildren,
        undefined,
        "contains",
      ),
    ),
    typeAssignments,
    typeByOccurrence,
    groupAssignments,
    materialByObject,
    classificationByObject,
    documentByObject,
    relationships,
    diagnostics,
  };
}

function relationshipLink(
  relationshipID: number,
  relationshipType: string,
  line: Record<string, unknown>,
): IfcRelationshipLink {
  const related = firstIDs(
    line.RelatedObjects,
    line.RelatedElements,
    line.RelatedProducts,
    line.RelatedProcess,
    line.RelatedResources,
  );
  const relating =
    asExpressID(line.RelatingObject) ??
    asExpressID(line.RelatingStructure) ??
    asExpressID(line.RelatingType) ??
    asExpressID(line.RelatingGroup) ??
    asExpressID(line.RelatingMaterial) ??
    asExpressID(line.RelatingClassification) ??
    asExpressID(line.RelatingDocument) ??
    asExpressID(line.RelatingLibrary) ??
    asExpressID(line.RelatingConstraint) ??
    asExpressID(line.RelatingApproval) ??
    asExpressID(line.RelatingProcess) ??
    asExpressID(line.RelatingProduct);

  return {
    relationshipID,
    relationshipType,
    relatingID: relating,
    relatedIDs: related,
  };
}

function firstIDs(...values: unknown[]) {
  for (const value of values) {
    const ids = asExpressIDs(value);
    if (ids.length > 0) {
      return ids;
    }
  }
  return [];
}

function getLinesByTypeName(
  api: WebIFC.IfcAPI,
  modelID: number,
  typeName: string,
  diagnostics: IfcDiagnostic[],
) {
  const typeCode = api.GetTypeCodeFromName(typeName);
  if (!typeCode) {
    return [];
  }
  try {
    const ids = api.GetLineIDsWithType(modelID, typeCode);
    const lines: Record<string, unknown>[] = [];
    for (let index = 0; index < ids.size(); index += 1) {
      const expressID = ids.get(index);
      if (expressID) {
        lines.push(api.GetLine(modelID, expressID) as Record<string, unknown>);
      }
    }
    return lines;
  } catch (error) {
    diagnostics.push({
      code: "RELATIONSHIP_READ_FAILED",
      severity: "warning",
      message: `Could not read ${typeName}: ${String(error)}`,
    });
    return [];
  }
}

function addParentLink(
  target: Map<number, IfcRelationshipLink[]>,
  link: IfcRelationshipLink,
) {
  if (!link.relatingID) {
    return;
  }
  pushMapValue(target, link.relatingID, link);
}

function addAssociation(
  target: Map<number, number[]>,
  link: IfcRelationshipLink,
) {
  link.relatedIDs.forEach((objectID) => {
    pushMapValue(target, objectID, link.relatingID as number);
  });
}

function pushMapValue<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) {
    values.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushMapValues<K, V>(map: Map<K, V[]>, key: K, values: V[]) {
  if (!values.length) {
    return;
  }
  const current = map.get(key);
  if (current) {
    current.push(...values);
  } else {
    map.set(key, [...values]);
  }
}

function buildTreeNode(
  expressID: number,
  byExpressID: Map<number, IfcEntitySummary>,
  primaryChildren: Map<number, IfcRelationshipLink[]>,
  secondaryChildren?: Map<number, IfcRelationshipLink[]>,
  relationship = "child",
): IfcTreeNode {
  const entity = byExpressID.get(expressID);
  const root: IfcTreeNode = {
    expressID,
    label: entity?.name ?? `#${expressID}`,
    typeName: entity?.typeName ?? "UNKNOWN",
    relationship,
    children: [],
  };
  const stack: Array<{ node: IfcTreeNode; path: Set<number> }> = [
    { node: root, path: new Set([expressID]) },
  ];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const visitLink = (link: IfcRelationshipLink) => {
      for (const childID of link.relatedIDs) {
        if (current.path.has(childID)) {
          continue;
        }
        const childEntity = byExpressID.get(childID);
        const childNode: IfcTreeNode = {
          expressID: childID,
          label: childEntity?.name ?? `#${childID}`,
          typeName: childEntity?.typeName ?? "UNKNOWN",
          relationship: link.relationshipType,
          children: [],
        };
        current.node.children.push(childNode);
        const childPath = new Set(current.path);
        childPath.add(childID);
        stack.push({ node: childNode, path: childPath });
      }
    };
    for (const link of primaryChildren.get(current.node.expressID) ?? []) {
      visitLink(link);
    }
    for (const link of secondaryChildren?.get(current.node.expressID) ?? []) {
      visitLink(link);
    }
  }

  return root;
}

export function summarizeLine(
  api: WebIFC.IfcAPI,
  line: Record<string, unknown>,
): IfcEntitySummary | undefined {
  const expressID = Number(line.expressID);
  const typeCode = Number(line.type);
  if (!expressID || !typeCode) {
    return undefined;
  }
  const typeName = api.GetNameFromTypeCode(typeCode);
  return {
    expressID,
    typeCode,
    typeName,
    globalId: labelForLine({ Name: line.GlobalId }, "").trim() || undefined,
    name: labelForLine(line, "").trim() || undefined,
    description:
      labelForLine({ Name: line.Description }, "").trim() || undefined,
  };
}
