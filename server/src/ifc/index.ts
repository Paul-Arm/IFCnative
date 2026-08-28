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
  type GuidDiffSummary,
  type VersionManifest,
  type VersionManifestEntry,
} from "../../../editor/src/ifc/versioning/entityDiffByGuid";
export {
  diffEntityFields,
  type EntityFieldDiff,
} from "../../../editor/src/ifc/versioning/entityFieldDiff";
