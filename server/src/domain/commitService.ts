import { randomUUID } from "node:crypto";

import { parseNativeIfcText } from "../../../src/ifc/nativeDocument";
import {
  buildVersionManifest,
  diffManifests,
  type GuidDiffSummary,
  type VersionManifest,
  type VersionManifestEntry,
} from "../../../src/ifc/versioning/entityDiffByGuid";
import type { ObjectStore } from "../storage/objectStore";
import type { Commit, Model, Repository } from "../repository/types";

/**
 * The versioning core: turns an uploaded IFC file into a content-addressable
 * commit (raw blob + GlobalId manifest in the object store, metadata in the
 * repository) and computes semantic diffs between commits by GlobalId.
 */

interface SerializedManifest {
  manifestHash: string;
  entityCount: number;
  entries: VersionManifestEntry[];
}

function serializeManifest(manifest: VersionManifest): SerializedManifest {
  return {
    manifestHash: manifest.manifestHash,
    entityCount: manifest.entityCount,
    entries: [...manifest.entries.values()],
  };
}

function deserializeManifest(data: SerializedManifest): VersionManifest {
  const entries = new Map<string, VersionManifestEntry>();
  for (const entry of data.entries) {
    entries.set(entry.globalId, entry);
  }
  return {
    manifestHash: data.manifestHash,
    entityCount: data.entityCount,
    entries,
    duplicateGlobalIds: [],
  };
}

export interface CreateCommitInput {
  model: Model;
  branchName: string;
  ifcText: string;
  authorId: string;
  message: string;
}

export interface CreateCommitResult {
  commit: Commit;
  /** Semantic diff against the previous head of the branch (parent commit). */
  diff: GuidDiffSummary;
}

export class CommitService {
  constructor(
    private readonly repo: Repository,
    private readonly store: ObjectStore,
  ) {}

  private blobKey(modelId: string, commitId: string): string {
    return `models/${modelId}/commits/${commitId}.ifc`;
  }

  private manifestKey(modelId: string, manifestHash: string): string {
    return `models/${modelId}/manifests/${manifestHash}.json`;
  }

  private async loadManifest(commit: Commit): Promise<VersionManifest> {
    const buffer = await this.store.get(commit.manifestKey);
    return deserializeManifest(
      JSON.parse(buffer.toString("utf8")) as SerializedManifest,
    );
  }

  async createCommit(input: CreateCommitInput): Promise<CreateCommitResult> {
    const { model, branchName, ifcText, authorId, message } = input;

    const doc = parseNativeIfcText(ifcText);
    const manifest = buildVersionManifest(doc);

    let branch = await this.repo.getBranch(model.id, branchName);
    if (!branch) {
      branch = await this.repo.createBranch({
        modelId: model.id,
        name: branchName,
        headCommitId: null,
      });
    }

    const parentCommit = branch.headCommitId
      ? await this.repo.getCommit(branch.headCommitId)
      : null;

    let diff: GuidDiffSummary;
    if (parentCommit) {
      const parentManifest = await this.loadManifest(parentCommit);
      diff = diffManifests(parentManifest, manifest);
    } else {
      diff = diffManifests(
        {
          manifestHash: "",
          entries: new Map(),
          duplicateGlobalIds: [],
          entityCount: 0,
        },
        manifest,
      );
    }

    const commitId = randomUUID();
    const blobKey = this.blobKey(model.id, commitId);
    const manifestKey = this.manifestKey(model.id, manifest.manifestHash);

    await this.store.put(blobKey, ifcText, "application/x-step");
    if (!(await this.store.exists(manifestKey))) {
      await this.store.put(
        manifestKey,
        JSON.stringify(serializeManifest(manifest)),
        "application/json",
      );
    }

    const commit: Commit = {
      id: commitId,
      modelId: model.id,
      branchName,
      parentCommitId: parentCommit?.id ?? null,
      manifestHash: manifest.manifestHash,
      blobKey,
      manifestKey,
      schema: doc.schema,
      authorId,
      message,
      createdAt: new Date().toISOString(),
      entityCount: manifest.entityCount,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
    };

    await this.repo.createCommit(commit);
    await this.repo.setBranchHead(branch.id, commit.id);

    return { commit, diff };
  }

  async getDiff(from: Commit, to: Commit): Promise<GuidDiffSummary> {
    const [fromManifest, toManifest] = await Promise.all([
      this.loadManifest(from),
      this.loadManifest(to),
    ]);
    return diffManifests(fromManifest, toManifest);
  }

  async downloadIfc(commit: Commit): Promise<Buffer> {
    return this.store.get(commit.blobKey);
  }
}
