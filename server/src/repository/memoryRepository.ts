import { randomUUID } from "node:crypto";

import type {
  GuidDiffSummary,
  VersionManifestEntry,
} from "../ifc";
import type {
  Action,
  ActionRun,
  Branch,
  LibraryFile,
  Commit,
  Issue,
  IssueComment,
  IssueLinks,
  Label,
  Member,
  Model,
  Project,
  Repository,
  User,
} from "./types";

interface EntityObject {
  type: string;
  name: string;
  payload: string;
}

/**
 * In-memory Repository for local dev and tests. Not persistent — production
 * should provide a Postgres / Azure SQL implementation of `Repository`.
 */
export class MemoryRepository implements Repository {
  protected users = new Map<string, User>();
  protected projects = new Map<string, Project>();
  protected members: Member[] = [];
  protected models = new Map<string, Model>();
  protected branches = new Map<string, Branch>();
  protected commits = new Map<string, Commit>();
  /** content-addressable entity payloads, deduped across all commits. */
  protected entityObjects = new Map<string, EntityObject>();
  /** per-commit manifest: ordered (globalId, entityHash) references. */
  protected commitEntities = new Map<string, { globalId: string; hash: string }[]>();
  protected diffCache = new Map<string, GuidDiffSummary>();
  /** explizit angelegte Ordner je Projekt. */
  protected folders = new Map<string, Set<string>>();
  protected labels = new Map<string, Label>();
  protected issues = new Map<string, Issue>();
  protected issueLinks = new Map<string, IssueLinks>();
  protected issueComments = new Map<string, IssueComment>();
  protected actions = new Map<string, Action>();
  protected actionRuns = new Map<string, ActionRun>();
  protected libraryFiles = new Map<string, LibraryFile>();

  private now(): string {
    // Tests need determinism-free timestamps; ISO string is fine here.
    return new Date().toISOString();
  }

  /** In-Memory gibt es keine echte Atomarität — fn läuft direkt. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async createUser(input: Omit<User, "id" | "createdAt">): Promise<User> {
    const user: User = { ...input, id: randomUUID(), createdAt: this.now() };
    this.users.set(user.id, user);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const lower = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === lower) {
        return user;
      }
    }
    return null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listUsers(): Promise<User[]> {
    return [...this.users.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async updateUser(
    userId: string,
    patch: Partial<Pick<User, "name" | "isAdmin" | "passwordHash">>,
  ): Promise<User | null> {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (user as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return user;
  }

  async userHasContent(userId: string): Promise<boolean> {
    return (
      [...this.commits.values()].some((c) => c.authorId === userId) ||
      [...this.issues.values()].some((i) => i.authorId === userId) ||
      [...this.issueComments.values()].some((c) => c.authorId === userId)
    );
  }

  async deleteUser(userId: string): Promise<void> {
    for (const links of this.issueLinks.values()) {
      links.assigneeIds = links.assigneeIds.filter((id) => id !== userId);
    }
    this.members = this.members.filter((m) => m.userId !== userId);
    this.users.delete(userId);
  }

  async listAllProjects(): Promise<Project[]> {
    return [...this.projects.values()];
  }

  async createProject(
    input: Omit<Project, "id" | "createdAt">,
  ): Promise<Project> {
    const project: Project = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    for (const project of this.projects.values()) {
      if (project.slug === slug) {
        return project;
      }
    }
    return null;
  }

  async listPublicProjects(): Promise<Project[]> {
    return [...this.projects.values()].filter(
      (project) => project.visibility === "public",
    );
  }

  async updateProject(
    projectId: string,
    patch: Partial<Pick<Project, "name" | "visibility">>,
  ): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (project as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return project;
  }

  async listProjectsForUser(userId: string): Promise<Project[]> {
    const ids = new Set(
      this.members.filter((m) => m.userId === userId).map((m) => m.projectId),
    );
    return [...this.projects.values()].filter((p) => ids.has(p.id));
  }

  async addMember(member: Member): Promise<Member> {
    const existing = this.members.find(
      (m) => m.projectId === member.projectId && m.userId === member.userId,
    );
    if (existing) {
      existing.role = member.role;
      return existing;
    }
    this.members.push(member);
    return member;
  }

  async getMember(projectId: string, userId: string): Promise<Member | null> {
    return (
      this.members.find(
        (m) => m.projectId === projectId && m.userId === userId,
      ) ?? null
    );
  }

  async listMembers(projectId: string): Promise<Member[]> {
    return this.members.filter((m) => m.projectId === projectId);
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    this.members = this.members.filter(
      (m) => !(m.projectId === projectId && m.userId === userId),
    );
  }

  async createModel(input: Omit<Model, "id" | "createdAt">): Promise<Model> {
    const model: Model = { ...input, id: randomUUID(), createdAt: this.now() };
    this.models.set(model.id, model);
    return model;
  }

  async getModel(projectId: string, slug: string): Promise<Model | null> {
    for (const model of this.models.values()) {
      if (model.projectId === projectId && model.slug === slug) {
        return model;
      }
    }
    return null;
  }

  async listModels(projectId: string): Promise<Model[]> {
    return [...this.models.values()].filter((m) => m.projectId === projectId);
  }

  async updateModel(
    modelId: string,
    patch: Partial<
      Pick<Model, "name" | "visibility" | "defaultBranch" | "folder">
    >,
  ): Promise<Model | null> {
    const model = this.models.get(modelId);
    if (!model) {
      return null;
    }
    // Nur gesetzte Felder übernehmen — `{name: undefined}` darf den
    // bestehenden Wert nicht auslöschen.
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (model as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return model;
  }

  async deleteModel(modelId: string): Promise<string[]> {
    for (const links of this.issueLinks.values()) {
      links.models = links.models.filter((link) => link.modelId !== modelId);
    }
    for (const run of [...this.actionRuns.values()]) {
      if (run.modelId === modelId) {
        this.actionRuns.delete(run.id);
      }
    }
    // Actions, die nur für dieses Modell galten, gehen mit ihm.
    const scopedActionBlobs: string[] = [];
    for (const action of [...this.actions.values()]) {
      if (action.scopeModelId === modelId) {
        if (!action.libraryFileId) {
          scopedActionBlobs.push(action.fileKey);
        }
        this.actions.delete(action.id);
      }
    }
    const commits = [...this.commits.values()].filter(
      (c) => c.modelId === modelId,
    );
    const commitIds = new Set(commits.map((c) => c.id));
    for (const id of commitIds) {
      this.commits.delete(id);
      this.commitEntities.delete(id);
    }
    for (const key of [...this.diffCache.keys()]) {
      const [from, to] = key.split("->");
      if (commitIds.has(from) || commitIds.has(to)) {
        this.diffCache.delete(key);
      }
    }
    for (const branch of [...this.branches.values()]) {
      if (branch.modelId === modelId) {
        this.branches.delete(branch.id);
      }
    }
    this.models.delete(modelId);
    return [...commits.map((c) => c.blobKey), ...scopedActionBlobs];
  }

  async deleteProject(projectId: string): Promise<string[]> {
    const blobKeys: string[] = [];
    for (const model of await this.listModels(projectId)) {
      blobKeys.push(...(await this.deleteModel(model.id)));
    }
    this.members = this.members.filter((m) => m.projectId !== projectId);
    this.folders.delete(projectId);
    for (const issue of [...this.issues.values()]) {
      if (issue.projectId === projectId) {
        this.issues.delete(issue.id);
        this.issueLinks.delete(issue.id);
        for (const comment of [...this.issueComments.values()]) {
          if (comment.issueId === issue.id) {
            this.issueComments.delete(comment.id);
          }
        }
      }
    }
    for (const label of [...this.labels.values()]) {
      if (label.projectId === projectId) {
        this.labels.delete(label.id);
      }
    }
    for (const action of [...this.actions.values()]) {
      if (action.projectId === projectId) {
        // Bibliotheksdateien gehören nicht dem Projekt — Blob nicht löschen.
        if (!action.libraryFileId) {
          blobKeys.push(action.fileKey);
        }
        this.actions.delete(action.id);
      }
    }
    for (const run of [...this.actionRuns.values()]) {
      if (run.projectId === projectId) {
        this.actionRuns.delete(run.id);
      }
    }
    this.projects.delete(projectId);
    return blobKeys;
  }

  // ---- actions + runs --------------------------------------------------

  async createAction(input: Omit<Action, "createdAt">): Promise<Action> {
    const action: Action = { ...input, createdAt: this.now() };
    this.actions.set(action.id, action);
    return action;
  }

  async getAction(actionId: string): Promise<Action | null> {
    return this.actions.get(actionId) ?? null;
  }

  async listActions(projectId: string): Promise<Action[]> {
    return [...this.actions.values()]
      .filter((action) => action.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- zentrale Skript-/IDS-Bibliothek ---------------------------------

  async createLibraryFile(
    input: Omit<LibraryFile, "createdAt">,
  ): Promise<LibraryFile> {
    const file: LibraryFile = { ...input, createdAt: this.now() };
    this.libraryFiles.set(file.id, file);
    return file;
  }

  async getLibraryFile(fileId: string): Promise<LibraryFile | null> {
    return this.libraryFiles.get(fileId) ?? null;
  }

  async listLibraryFiles(): Promise<LibraryFile[]> {
    return [...this.libraryFiles.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  async updateLibraryFile(
    fileId: string,
    patch: Partial<Pick<LibraryFile, "name" | "fileName">>,
  ): Promise<LibraryFile | null> {
    const file = this.libraryFiles.get(fileId);
    if (!file) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (file as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return file;
  }

  async deleteLibraryFile(fileId: string): Promise<void> {
    this.libraryFiles.delete(fileId);
  }

  async countActionsUsingLibraryFile(fileId: string): Promise<number> {
    return [...this.actions.values()].filter(
      (action) => action.libraryFileId === fileId,
    ).length;
  }

  async updateAction(
    actionId: string,
    patch: Partial<Pick<Action, "name" | "runOnCommit" | "fileName">>,
  ): Promise<Action | null> {
    const action = this.actions.get(actionId);
    if (!action) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (action as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return action;
  }

  async deleteAction(actionId: string): Promise<void> {
    for (const run of [...this.actionRuns.values()]) {
      if (run.actionId === actionId) {
        this.actionRuns.delete(run.id);
      }
    }
    this.actions.delete(actionId);
  }

  async createActionRun(
    input: Omit<ActionRun, "id" | "number" | "createdAt">,
  ): Promise<ActionRun> {
    const nextNumber =
      Math.max(
        0,
        ...[...this.actionRuns.values()]
          .filter((run) => run.projectId === input.projectId)
          .map((run) => run.number),
      ) + 1;
    const run: ActionRun = {
      ...input,
      id: randomUUID(),
      number: nextNumber,
      createdAt: this.now(),
    };
    this.actionRuns.set(run.id, run);
    return run;
  }

  async getActionRun(runId: string): Promise<ActionRun | null> {
    return this.actionRuns.get(runId) ?? null;
  }

  async listActionRuns(
    projectId: string,
    filter?: { actionId?: string; modelId?: string; commitId?: string },
  ): Promise<ActionRun[]> {
    return [...this.actionRuns.values()]
      .filter(
        (run) =>
          run.projectId === projectId &&
          (filter?.actionId === undefined || run.actionId === filter.actionId) &&
          (filter?.modelId === undefined || run.modelId === filter.modelId) &&
          (filter?.commitId === undefined || run.commitId === filter.commitId),
      )
      .sort((a, b) => b.number - a.number);
  }

  async listUnfinishedActionRuns(): Promise<ActionRun[]> {
    return [...this.actionRuns.values()]
      .filter((run) => run.status === "queued" || run.status === "running")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateActionRun(
    runId: string,
    patch: Partial<
      Pick<
        ActionRun,
        "status" | "summary" | "log" | "failedGuids" | "startedAt" | "finishedAt"
      >
    >,
  ): Promise<ActionRun | null> {
    const run = this.actionRuns.get(runId);
    if (!run) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (run as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return run;
  }

  // ---- labels + issues -------------------------------------------------

  async createLabel(input: Omit<Label, "id">): Promise<Label> {
    const label: Label = { ...input, id: randomUUID() };
    this.labels.set(label.id, label);
    return label;
  }

  async listLabels(projectId: string): Promise<Label[]> {
    return [...this.labels.values()]
      .filter((label) => label.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createIssue(
    input: Omit<Issue, "id" | "number" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<Issue> {
    const nextNumber =
      Math.max(
        0,
        ...[...this.issues.values()]
          .filter((issue) => issue.projectId === input.projectId)
          .map((issue) => issue.number),
      ) + 1;
    const now = this.now();
    const issue: Issue = {
      ...input,
      id: input.id ?? randomUUID(),
      number: nextNumber,
      createdAt: now,
      updatedAt: now,
    };
    this.issues.set(issue.id, issue);
    return issue;
  }

  async getIssueById(issueId: string): Promise<Issue | null> {
    return this.issues.get(issueId) ?? null;
  }

  async createIssueWithLinks(
    input: Parameters<MemoryRepository["createIssue"]>[0],
    links: Partial<IssueLinks>,
  ): Promise<Issue> {
    const issue = await this.createIssue(input);
    await this.setIssueLinks(issue.id, links);
    return issue;
  }

  async getIssue(projectId: string, number: number): Promise<Issue | null> {
    return (
      [...this.issues.values()].find(
        (issue) => issue.projectId === projectId && issue.number === number,
      ) ?? null
    );
  }

  async listIssues(projectId: string): Promise<Issue[]> {
    return [...this.issues.values()]
      .filter((issue) => issue.projectId === projectId)
      .sort((a, b) => b.number - a.number);
  }

  async updateIssue(
    issueId: string,
    patch: Partial<
      Pick<Issue, "title" | "body" | "state" | "kind" | "parentId">
    >,
  ): Promise<Issue | null> {
    const issue = this.issues.get(issueId);
    if (!issue) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (issue as unknown as Record<string, unknown>)[key] = value;
      }
    }
    issue.updatedAt = this.now();
    return issue;
  }

  async setIssueLinks(
    issueId: string,
    links: Partial<IssueLinks>,
  ): Promise<void> {
    const current = this.issueLinks.get(issueId) ?? {
      assigneeIds: [],
      models: [],
      labelIds: [],
      guids: [],
    };
    // Modelle nach Id dedupen (letzter Eintrag gewinnt).
    const models = links.models
      ? [
          ...new Map(
            links.models.map((link) => [link.modelId, { ...link }]),
          ).values(),
        ]
      : current.models;
    this.issueLinks.set(issueId, {
      assigneeIds: links.assigneeIds
        ? [...new Set(links.assigneeIds)]
        : current.assigneeIds,
      models,
      labelIds: links.labelIds ? [...new Set(links.labelIds)] : current.labelIds,
      guids: links.guids ? [...new Set(links.guids)] : current.guids,
    });
  }

  async getIssueLinks(issueIds: string[]): Promise<Map<string, IssueLinks>> {
    const map = new Map<string, IssueLinks>();
    for (const id of issueIds) {
      const links = this.issueLinks.get(id);
      map.set(id, {
        assigneeIds: [...(links?.assigneeIds ?? [])],
        models: (links?.models ?? []).map((link) => ({ ...link })),
        labelIds: [...(links?.labelIds ?? [])],
        guids: [...(links?.guids ?? [])],
      });
    }
    return map;
  }

  async createIssueComment(
    input: Omit<IssueComment, "id" | "createdAt">,
  ): Promise<IssueComment> {
    const comment: IssueComment = {
      ...input,
      id: randomUUID(),
      createdAt: this.now(),
    };
    this.issueComments.set(comment.id, comment);
    return comment;
  }

  async listIssueComments(issueId: string): Promise<IssueComment[]> {
    return [...this.issueComments.values()]
      .filter((comment) => comment.issueId === issueId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getIssueComment(commentId: string): Promise<IssueComment | null> {
    return this.issueComments.get(commentId) ?? null;
  }

  async deleteIssueComment(commentId: string): Promise<void> {
    this.issueComments.delete(commentId);
  }

  async listFolders(projectId: string): Promise<string[]> {
    return [...(this.folders.get(projectId) ?? [])].sort();
  }

  async addFolder(projectId: string, path: string): Promise<void> {
    let set = this.folders.get(projectId);
    if (!set) {
      set = new Set();
      this.folders.set(projectId, set);
    }
    set.add(path);
  }

  async removeFolder(projectId: string, path: string): Promise<void> {
    const set = this.folders.get(projectId);
    if (!set) {
      return;
    }
    for (const entry of [...set]) {
      if (entry === path || entry.startsWith(`${path}/`)) {
        set.delete(entry);
      }
    }
  }

  async createBranch(input: Omit<Branch, "id">): Promise<Branch> {
    const branch: Branch = { ...input, id: randomUUID() };
    this.branches.set(branch.id, branch);
    return branch;
  }

  async getBranch(modelId: string, name: string): Promise<Branch | null> {
    for (const branch of this.branches.values()) {
      if (branch.modelId === modelId && branch.name === name) {
        return branch;
      }
    }
    return null;
  }

  async listBranches(modelId: string): Promise<Branch[]> {
    return [...this.branches.values()].filter((b) => b.modelId === modelId);
  }

  async setBranchHead(branchId: string, headCommitId: string): Promise<void> {
    const branch = this.branches.get(branchId);
    if (branch) {
      branch.headCommitId = headCommitId;
    }
  }

  async createCommit(commit: Commit): Promise<Commit> {
    this.commits.set(commit.id, commit);
    return commit;
  }

  async getCommit(id: string): Promise<Commit | null> {
    return this.commits.get(id) ?? null;
  }

  async listCommits(modelId: string, branchName?: string): Promise<Commit[]> {
    return [...this.commits.values()]
      .filter(
        (c) =>
          c.modelId === modelId &&
          (branchName === undefined || c.branchName === branchName),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveManifest(
    commitId: string,
    entries: VersionManifestEntry[],
  ): Promise<void> {
    const refs: { globalId: string; hash: string }[] = [];
    for (const entry of entries) {
      if (!this.entityObjects.has(entry.hash)) {
        this.entityObjects.set(entry.hash, {
          type: entry.type,
          name: entry.name,
          payload: entry.payload ?? "",
        });
      }
      refs.push({ globalId: entry.globalId, hash: entry.hash });
    }
    this.commitEntities.set(commitId, refs);
  }

  async getManifest(commitId: string): Promise<VersionManifestEntry[]> {
    const refs = this.commitEntities.get(commitId) ?? [];
    return refs.map((ref) => {
      const object = this.entityObjects.get(ref.hash);
      return {
        globalId: ref.globalId,
        hash: ref.hash,
        type: object?.type ?? "",
        name: object?.name ?? "",
      };
    });
  }

  async getCachedDiff(
    fromCommitId: string,
    toCommitId: string,
  ): Promise<GuidDiffSummary | null> {
    return this.diffCache.get(`${fromCommitId}->${toCommitId}`) ?? null;
  }

  async saveCachedDiff(
    fromCommitId: string,
    toCommitId: string,
    summary: GuidDiffSummary,
  ): Promise<void> {
    this.diffCache.set(`${fromCommitId}->${toCommitId}`, summary);
  }
}
