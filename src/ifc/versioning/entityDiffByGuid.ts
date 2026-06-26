import {
  parseNativeIfcText,
  type NativeIfcDocument,
} from "../nativeDocument";
import {
  canonicalEntityPayload,
  createHashContext,
  ifcGlobalId,
  sha256Hex,
} from "./entityHash";

/**
 * GlobalId-keyed semantic diff for IFC versions.
 *
 * Unlike the express-id based matcher in `entityDiff.ts` (which treats a
 * re-exported, re-numbered file as a full rewrite), this compares two versions
 * by stable IFC GlobalId. A "version manifest" maps every rooted entity's
 * GlobalId to a version-stable content hash; diffing two manifests yields the
 * added / removed / modified entity sets — the semantic, content-addressable
 * core of the IFC version control server.
 */

export interface VersionManifestEntry {
  globalId: string;
  type: string;
  name: string;
  hash: string;
  /**
   * Canonical, express-id-free payload that `hash` is computed from. Enables
   * content-addressable dedup of entity payloads in a persistent store. Not
   * required for diffing (which only compares hashes), so it may be omitted
   * when a manifest is reconstructed from storage.
   */
  payload?: string;
}

export interface VersionManifest {
  /** sha256 over the sorted `globalId:hash` set — the commit tree id. */
  manifestHash: string;
  entries: Map<string, VersionManifestEntry>;
  /** GlobalIds that appeared more than once (invalid IFC; last one wins). */
  duplicateGlobalIds: string[];
  entityCount: number;
}

export function buildVersionManifest(doc: NativeIfcDocument): VersionManifest {
  const ctx = createHashContext(doc);
  const entries = new Map<string, VersionManifestEntry>();
  const duplicates = new Set<string>();

  for (const entity of doc.entities) {
    const gid = ifcGlobalId(entity);
    if (!gid) {
      continue;
    }
    if (entries.has(gid)) {
      duplicates.add(gid);
    }
    const payload = canonicalEntityPayload(entity, ctx);
    entries.set(gid, {
      globalId: gid,
      type: entity.type,
      name: entity.name,
      hash: sha256Hex(payload),
      payload,
    });
  }

  return {
    manifestHash: computeManifestHash(entries),
    entries,
    duplicateGlobalIds: [...duplicates].sort(),
    entityCount: entries.size,
  };
}

function computeManifestHash(
  entries: Map<string, VersionManifestEntry>,
): string {
  const lines = [...entries.values()]
    .map((entry) => `${entry.globalId}:${entry.hash}`)
    .sort();
  return sha256Hex(lines.join("\n"));
}

export type GuidChangeStatus = "added" | "removed" | "modified";

export interface GuidDiffEntry {
  globalId: string;
  type: string;
  name: string;
  status: GuidChangeStatus;
  beforeHash?: string;
  afterHash?: string;
}

export interface GuidDiffSummary {
  added: GuidDiffEntry[];
  removed: GuidDiffEntry[];
  modified: GuidDiffEntry[];
  unchanged: number;
  beforeManifestHash: string;
  afterManifestHash: string;
  /** true when both manifests hash identically (semantically equal versions). */
  identical: boolean;
}

function compareEntries(a: GuidDiffEntry, b: GuidDiffEntry): number {
  return (
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name) ||
    a.globalId.localeCompare(b.globalId)
  );
}

export function diffManifests(
  before: VersionManifest,
  after: VersionManifest,
): GuidDiffSummary {
  const added: GuidDiffEntry[] = [];
  const removed: GuidDiffEntry[] = [];
  const modified: GuidDiffEntry[] = [];
  let unchanged = 0;

  for (const [gid, afterEntry] of after.entries) {
    const beforeEntry = before.entries.get(gid);
    if (!beforeEntry) {
      added.push({
        globalId: gid,
        type: afterEntry.type,
        name: afterEntry.name,
        status: "added",
        afterHash: afterEntry.hash,
      });
    } else if (beforeEntry.hash !== afterEntry.hash) {
      modified.push({
        globalId: gid,
        type: afterEntry.type,
        name: afterEntry.name,
        status: "modified",
        beforeHash: beforeEntry.hash,
        afterHash: afterEntry.hash,
      });
    } else {
      unchanged += 1;
    }
  }

  for (const [gid, beforeEntry] of before.entries) {
    if (!after.entries.has(gid)) {
      removed.push({
        globalId: gid,
        type: beforeEntry.type,
        name: beforeEntry.name,
        status: "removed",
        beforeHash: beforeEntry.hash,
      });
    }
  }

  added.sort(compareEntries);
  removed.sort(compareEntries);
  modified.sort(compareEntries);

  return {
    added,
    removed,
    modified,
    unchanged,
    beforeManifestHash: before.manifestHash,
    afterManifestHash: after.manifestHash,
    identical: before.manifestHash === after.manifestHash,
  };
}

export function diffNativeDocuments(
  before: NativeIfcDocument,
  after: NativeIfcDocument,
): GuidDiffSummary {
  return diffManifests(
    buildVersionManifest(before),
    buildVersionManifest(after),
  );
}

export function diffIfcText(
  beforeText: string,
  afterText: string,
): GuidDiffSummary {
  return diffNativeDocuments(
    parseNativeIfcText(beforeText),
    parseNativeIfcText(afterText),
  );
}
