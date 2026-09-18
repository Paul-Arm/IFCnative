/**
 * Single bridge to the shared IFC layer in `editor/src/ifc`.
 *
 * The server reuses the editor's STEP parser and GlobalId-keyed diff so both
 * sides agree exactly on what "changed" means. If the monorepo layout moves
 * again, this file is the only place that needs updating.
 */
export {
  parseNativeIfcText,
  type NativeIfcDocument,
} from "../../../editor/src/ifc/nativeDocument";
export {
  buildVersionManifest,
  diffManifests,
  type GuidChangeStatus,
  type GuidDiffEntry,
  type GuidDiffSummary,
  type VersionManifest,
  type VersionManifestEntry,
} from "../../../editor/src/ifc/versioning/entityDiffByGuid";
export {
  diffEntityFields,
  type EntityFieldDiff,
} from "../../../editor/src/ifc/versioning/entityFieldDiff";
export { createHashContext } from "../../../editor/src/ifc/versioning/entityHash";
export {
  CHANGE_FACETS,
  buildObjectRecords,
  diffObjectDetails,
  diffObjectIndexes,
  type ChangeFacet,
  type ObjectChangeEntry,
  type ObjectChangeStatus,
  type ObjectDetail,
  type ObjectDiffSummary,
  type ObjectFieldChange,
  type ObjectIndexEntry,
  type ObjectRecord,
} from "../../../editor/src/ifc/versioning/objectRecords";
export {
  parseIdsXml,
  validateIds,
  type IdsDocumentModel,
  type IdsValidationSummary,
} from "../../../editor/src/ifc/ids";
