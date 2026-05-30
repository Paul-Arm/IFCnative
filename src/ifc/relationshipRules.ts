import type { NativeIfcDocument } from "./nativeDocument";

export function relationshipTypesForEntities(
  document: NativeIfcDocument,
  relationshipTypes: string[],
  sourceId: number,
  targetId: number,
) {
  const source = document.entityById.get(sourceId);
  const target = document.entityById.get(targetId);
  if (!source || !target) {
    return [];
  }
  return relationshipTypesForEndpointTypes(
    relationshipTypes,
    source.type,
    target.type,
    sourceId,
    targetId,
  );
}

export function relationshipTypesForEndpointTypes(
  relationshipTypes: string[],
  sourceType: string | undefined,
  targetType: string | undefined,
  sourceId?: number,
  targetId?: number,
) {
  if (!sourceType || !targetType) {
    return [];
  }
  return relationshipTypes.filter((type) =>
    isRelationshipTypeAllowedForEndpointTypes(
      type,
      sourceType,
      targetType,
      sourceId,
      targetId,
    ),
  );
}

export function isRelationshipTypeAllowedForEndpointTypes(
  relationshipType: string,
  sourceType: string,
  targetType: string,
  sourceId?: number,
  targetId?: number,
) {
  const type = normalizeType(relationshipType);
  const source = normalizeType(sourceType);
  const target = normalizeType(targetType);
  if (!type || !source || !target) {
    return false;
  }
  if (sourceId != null && targetId != null && sourceId === targetId) {
    return false;
  }
  if (source.startsWith("IFCREL") || target.startsWith("IFCREL")) {
    return false;
  }

  if (type === "IFCRELAGGREGATES" || type === "IFCRELNESTS") {
    return isObjectDefinition(source) && isObjectDefinition(target);
  }
  if (
    type === "IFCRELCONTAINEDINSPATIALSTRUCTURE" ||
    type === "IFCRELREFERENCEDINSPATIALSTRUCTURE"
  ) {
    return isSpatial(source) && isPhysicalProduct(target) && !isSpatial(target);
  }
  if (type === "IFCRELDEFINESBYPROPERTIES") {
    return (
      isObjectDefinition(source) &&
      (target === "IFCPROPERTYSET" || target === "IFCELEMENTQUANTITY")
    );
  }
  if (type === "IFCRELDEFINESBYTYPE") {
    return isObjectDefinition(source) && isTypeObject(target);
  }
  if (type === "IFCRELASSOCIATESMATERIAL") {
    return (
      isObjectDefinition(source) &&
      target.startsWith("IFCMATERIAL") &&
      !(isTypeObject(source) && isMaterialUsageType(target))
    );
  }
  if (type === "IFCRELASSOCIATESCLASSIFICATION") {
    return (
      isObjectDefinition(source) &&
      (target === "IFCCLASSIFICATION" || target === "IFCCLASSIFICATIONREFERENCE")
    );
  }
  if (type === "IFCRELASSOCIATESDOCUMENT") {
    return (
      isObjectDefinition(source) &&
      (target === "IFCDOCUMENTINFORMATION" || target === "IFCDOCUMENTREFERENCE")
    );
  }
  if (type === "IFCRELASSOCIATESLIBRARY") {
    return (
      isObjectDefinition(source) &&
      (target === "IFCLIBRARYINFORMATION" || target === "IFCLIBRARYREFERENCE")
    );
  }
  if (type === "IFCRELASSOCIATESCONSTRAINT") {
    return isObjectDefinition(source) && (target === "IFCOBJECTIVE" || target === "IFCMETRIC");
  }
  if (type === "IFCRELASSOCIATESAPPROVAL") {
    return isObjectDefinition(source) && target === "IFCAPPROVAL";
  }
  if (type === "IFCRELASSIGNSTOGROUP") {
    return isObjectDefinition(source) && isGroupObject(target);
  }
  if (type === "IFCRELASSIGNSTOPROCESS") {
    return isObjectDefinition(source) && isProcess(target);
  }
  if (type === "IFCRELASSIGNSTOCONTROL") {
    return isObjectDefinition(source) && isControl(target);
  }
  if (type === "IFCRELASSIGNSTOPRODUCT") {
    return isObjectDefinition(source) && isProduct(target);
  }
  if (type === "IFCRELCONNECTSELEMENTS") {
    return isElementLike(source) && isElementLike(target);
  }
  if (type === "IFCRELCONNECTSPORTS") {
    return isPort(source) && isPort(target);
  }
  if (type === "IFCRELCONNECTSPORTTOELEMENT") {
    return isPort(source) && isElementLike(target);
  }
  if (type === "IFCRELVOIDSELEMENT") {
    return isElementLike(source) && isFeatureSubtraction(target);
  }
  if (type === "IFCRELFILLSELEMENT") {
    return source === "IFCOPENINGELEMENT" && isElementLike(target);
  }
  if (type === "IFCRELSEQUENCE") {
    return isProcess(source) && isProcess(target);
  }
  if (type === "IFCRELSERVICESBUILDINGS") {
    return isSystem(source) && isSpatial(target);
  }
  return false;
}

function normalizeType(type: string) {
  return type.trim().toUpperCase();
}

function isSpatial(type: string) {
  return [
    "IFCSITE",
    "IFCBUILDING",
    "IFCBUILDINGSTOREY",
    "IFCSPACE",
    "IFCFACILITY",
    "IFCSPATIALZONE",
  ].includes(type);
}

function isObjectDefinition(type: string) {
  return (
    isProduct(type) ||
    isTypeObject(type) ||
    isGroupObject(type) ||
    isProcess(type) ||
    isControl(type)
  );
}

function isProduct(type: string) {
  return isSpatial(type) || isElementLike(type) || isPort(type) || type === "IFCPROXY";
}

function isPhysicalProduct(type: string) {
  return isProduct(type) && !isPort(type);
}

function isElementLike(type: string) {
  return (
    (type.endsWith("ELEMENT") ||
      type.includes("ELEMENT") ||
      type === "IFCWALL" ||
      type === "IFCSLAB" ||
      type === "IFCBEAM" ||
      type === "IFCCOLUMN" ||
      type === "IFCDOOR" ||
      type === "IFCWINDOW" ||
      type === "IFCBUILTELEMENT" ||
      type === "IFCBUILDINGELEMENTPROXY" ||
      type === "IFCSENSOR" ||
      type === "IFCACTUATOR") &&
    !isFeatureSubtraction(type)
  );
}

function isFeatureSubtraction(type: string) {
  return type === "IFCOPENINGELEMENT" || type === "IFCVOIDINGFEATURE";
}

function isTypeObject(type: string) {
  return type === "IFCTYPEOBJECT" || type.endsWith("TYPE") || type.endsWith("TYPEOBJECT");
}

function isMaterialUsageType(type: string) {
  return (
    type === "IFCMATERIALLAYERSETUSAGE" ||
    type === "IFCMATERIALPROFILESETUSAGE"
  );
}

function isGroupObject(type: string) {
  return (
    type === "IFCGROUP" ||
    type === "IFCSYSTEM" ||
    type === "IFCZONE" ||
    type === "IFCASSET" ||
    type === "IFCBUILDINGSYSTEM" ||
    type === "IFCBUILTSYSTEM" ||
    type === "IFCDISTRIBUTIONSYSTEM" ||
    type === "IFCSTRUCTURALANALYSISMODEL" ||
    type === "IFCSTRUCTURALLOADGROUP" ||
    type === "IFCSTRUCTURALRESULTGROUP" ||
    type === "IFCINVENTORY"
  );
}

function isSystem(type: string) {
  return (
    type === "IFCSYSTEM" ||
    type === "IFCBUILDINGSYSTEM" ||
    type === "IFCBUILTSYSTEM" ||
    type === "IFCDISTRIBUTIONSYSTEM"
  );
}

function isProcess(type: string) {
  return type === "IFCPROCESS" || type === "IFCTASK" || type === "IFCEVENT" || type === "IFCPROCEDURE";
}

function isControl(type: string) {
  return (
    type === "IFCCONTROL" ||
    type === "IFCPERMIT" ||
    type === "IFCWORKCONTROL" ||
    type === "IFCWORKPLAN" ||
    type === "IFCWORKSCHEDULE" ||
    type === "IFCPROJECTORDER" ||
    type === "IFCPERFORMANCEHISTORY"
  );
}

function isPort(type: string) {
  return type === "IFCDISTRIBUTIONPORT" || type.endsWith("PORT");
}
