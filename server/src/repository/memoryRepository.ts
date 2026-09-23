import { randomUUID } from "node:crypto";

import type {
  GuidDiffSummary,
  ObjectDetail,
  ObjectIndexEntry,
  ObjectRecord,
  VersionManifestEntry,
} from "../ifc";
import {
  compareIssueEvents,
  emptyProjectSummary,
  type Action,
  type ActionRun,
  type ActionRunStatus,
  type ActivityDayCount,
  type Branch,
  type CommentWithProject,
  type CommitWithModel,
  type LibraryFile,
  type Commit,
  type Issue,
  type IssueComment,
  type IssueEvent,
  type IssueEventKind,
  type IssueFilter,
  type IssueLinks,
  type Label,
  type Member,
  type Model,
  type Project,
  type ProjectSummary,
  type RecentQuery,
  type Repository,
  type RepositoryCounts,
  type User,
} from "./types";

interface EntityObject {
  type: string;
  name: string;
  payload: string;
}

/**
 * Gemeinsamer Filter der "neueste zuerst"-Abfragen: vor `before`, vom
 * Akteur, absteigend nach Zeit (dann Id), höchstens `limit`.
 */
function newestFirst<T>(
  items: T[],
  query: RecentQuery,
  key: (item: T) => { createdAt: string; id: string; actorId: string },
): T[] {
  return items
    .filter((item) => {
      const { createdAt, actorId } = key(item);
      return (
        (query.before === undefined || createdAt < query.before) &&
        (query.actorId === undefined || actorId === query.actorId)
      );
    })
    .sort((a, b) => {
      const left = key(a);
      const right = key(b);
      return (
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    })
    .slice(0, query.limit);
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
  protected objectDetails = new Map<string, ObjectDetail>();
  protected commitObjects = new Map<string, ObjectIndexEntry[]>();
  /** explizit angelegte Ordner je Projekt. */
  protected folders = new Map<string, Set<string>>();
  protected labels = new Map<string, Label>();
  protected issues = new Map<string, Issue>();
  protected issueLinks = new Map<string, IssueLinks>();
  protected issueComments = new Map<string, IssueComment>();
  protected issueEvents = new Map<string, IssueEvent>();
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
    input: Omit<Project, "id" | "createdAt" | "description"> & {
      description?: string;
    },
  ): Promise<Project> {
    const project: Project = {
      ...input,
      description: input.description ?? "",
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
    patch: Partial<Pick<Project, "name" | "visibility" | "description">>,
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

  async projectSummaries(
    projectIds: string[],
  ): Promise<Map<string, ProjectSummary>> {
    const summaries = new Map<string, ProjectSummary>();
    for (const id of projectIds) {
      summaries.set(id, emptyProjectSummary());
    }
    for (const member of this.members) {
      const summary = summaries.get(member.projectId);
      if (summary) summary.memberCount += 1;
    }
    for (const model of this.models.values()) {
      const summary = summaries.get(model.projectId);
      if (summary) summary.modelCount += 1;
    }
    for (const issue of this.issues.values()) {
      const summary = summaries.get(issue.projectId);
      if (!summary) continue;
      if (issue.state === "open") {
        summary.openIssueCount += 1;
      } else {
        summary.closedIssueCount += 1;
      }
      if (!summary.lastIssueAt || issue.updatedAt > summary.lastIssueAt) {
        summary.lastIssueAt = issue.updatedAt;
      }
    }
    for (const commit of this.commits.values()) {
      const model = this.models.get(commit.modelId);
      const summary = model ? summaries.get(model.projectId) : undefined;
      if (!summary) continue;
      summary.commitCount += 1;
      if (!summary.lastCommitAt || commit.createdAt > summary.lastCommitAt) {
        summary.lastCommitAt = commit.createdAt;
      }
    }
    return summaries;
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
      this.commitObjects.delete(id);
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
    for (const event of [...this.issueEvents.values()]) {
      if (event.projectId === projectId) {
        this.issueEvents.delete(event.id);
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

  async countActionRunsByStatus(
    projectId: string,
  ): Promise<Map<ActionRunStatus, number>> {
    const counts = new Map<ActionRunStatus, number>();
    for (const run of this.actionRuns.values()) {
      if (run.projectId === projectId) {
        counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
      }
    }
    return counts;
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

  async createLabel(
    input: Omit<Label, "id" | "description"> & { description?: string },
  ): Promise<Label> {
    const label: Label = {
      ...input,
      description: input.description ?? "",
      id: randomUUID(),
    };
    this.labels.set(label.id, label);
    return label;
  }

  async listLabels(projectId: string): Promise<Label[]> {
    return [...this.labels.values()]
      .filter((label) => label.projectId === projectId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getLabel(labelId: string): Promise<Label | null> {
    return this.labels.get(labelId) ?? null;
  }

  async updateLabel(
    labelId: string,
    patch: Partial<Pick<Label, "name" | "color" | "description">>,
  ): Promise<Label | null> {
    const label = this.labels.get(labelId);
    if (!label) {
      return null;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (label as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return label;
  }

  async deleteLabel(labelId: string): Promise<void> {
    for (const links of this.issueLinks.values()) {
      links.labelIds = links.labelIds.filter((id) => id !== labelId);
    }
    this.labels.delete(labelId);
  }

  async countOpenIssuesByLabel(projectId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const issue of this.issues.values()) {
      if (issue.projectId !== projectId || issue.state !== "open") continue;
      for (const labelId of this.issueLinks.get(issue.id)?.labelIds ?? []) {
        counts.set(labelId, (counts.get(labelId) ?? 0) + 1);
      }
    }
    return counts;
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

  async listIssuesByFilter(
    projectIds: string[],
    filter: IssueFilter,
  ): Promise<Issue[]> {
    const ids = new Set(projectIds);
    return [...this.issues.values()]
      .filter(
        (issue) =>
          ids.has(issue.projectId) &&
          (filter.state === undefined || issue.state === filter.state) &&
          (filter.authorId === undefined || issue.authorId === filter.authorId) &&
          (filter.assigneeId === undefined ||
            (this.issueLinks.get(issue.id)?.assigneeIds ?? []).includes(
              filter.assigneeId,
            )),
      )
      .sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      )
      .slice(0, filter.limit);
  }

  async countIssueComments(issueIds: string[]): Promise<Map<string, number>> {
    const counts = new Map(issueIds.map((id) => [id, 0]));
    for (const comment of this.issueComments.values()) {
      const count = counts.get(comment.issueId);
      if (count !== undefined) counts.set(comment.issueId, count + 1);
    }
    return counts;
  }

  async countSubIssues(issueIds: string[]): Promise<Map<string, number>> {
    const counts = new Map(issueIds.map((id) => [id, 0]));
    for (const issue of this.issues.values()) {
      if (!issue.parentId) continue;
      const count = counts.get(issue.parentId);
      if (count !== undefined) counts.set(issue.parentId, count + 1);
    }
    return counts;
  }

  async createIssueEvents(
    events: Omit<IssueEvent, "id" | "createdAt">[],
  ): Promise<IssueEvent[]> {
    const createdAt = this.now();
    return events.map((input) => {
      // Daten kopieren: Schnappschüsse dürfen sich nicht nachträglich ändern.
      const event: IssueEvent = {
        ...input,
        data: structuredClone(input.data),
        id: randomUUID(),
        createdAt,
      };
      this.issueEvents.set(event.id, event);
      return event;
    });
  }

  async listIssueEvents(issueId: string): Promise<IssueEvent[]> {
    return [...this.issueEvents.values()]
      .filter((event) => event.issueId === issueId)
      .sort(compareIssueEvents);
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

  async countCommitsByAuthor(
    projectId: string,
  ): Promise<{ authorId: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const commit of this.commits.values()) {
      if (this.models.get(commit.modelId)?.projectId === projectId) {
        counts.set(commit.authorId, (counts.get(commit.authorId) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([authorId, count]) => ({ authorId, count }))
      .sort((a, b) => b.count - a.count || a.authorId.localeCompare(b.authorId));
  }

  // ---- Aktivitäts-Feed, Beiträge, Suche ---------------------------------

  async listRecentCommits(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<CommitWithModel[]> {
    const ids = new Set(projectIds);
    const rows: CommitWithModel[] = [];
    for (const commit of this.commits.values()) {
      const model = this.models.get(commit.modelId);
      if (model && ids.has(model.projectId)) {
        rows.push({ commit, model });
      }
    }
    return newestFirst(rows, query, ({ commit }) => ({
      createdAt: commit.createdAt,
      id: commit.id,
      actorId: commit.authorId,
    }));
  }

  async listRecentIssues(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<Issue[]> {
    const ids = new Set(projectIds);
    return newestFirst(
      [...this.issues.values()].filter((issue) => ids.has(issue.projectId)),
      query,
      (issue) => ({
        createdAt: issue.createdAt,
        id: issue.id,
        actorId: issue.authorId,
      }),
    );
  }

  async listRecentIssueEvents(
    projectIds: string[],
    query: RecentQuery & { kinds?: IssueEventKind[] },
  ): Promise<IssueEvent[]> {
    const ids = new Set(projectIds);
    const kinds = query.kinds ? new Set(query.kinds) : null;
    return newestFirst(
      [...this.issueEvents.values()].filter(
        (event) =>
          ids.has(event.projectId) && (kinds === null || kinds.has(event.kind)),
      ),
      query,
      (event) => ({
        createdAt: event.createdAt,
        id: event.id,
        actorId: event.actorId,
      }),
    );
  }

  async listRecentComments(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<CommentWithProject[]> {
    const ids = new Set(projectIds);
    const rows: CommentWithProject[] = [];
    for (const comment of this.issueComments.values()) {
      const issue = this.issues.get(comment.issueId);
      if (issue && ids.has(issue.projectId)) {
        rows.push({ comment, projectId: issue.projectId });
      }
    }
    return newestFirst(rows, query, ({ comment }) => ({
      createdAt: comment.createdAt,
      id: comment.id,
      actorId: comment.authorId,
    }));
  }

  async listRecentRuns(
    projectIds: string[],
    query: RecentQuery,
  ): Promise<Omit<ActionRun, "log">[]> {
    const ids = new Set(projectIds);
    return newestFirst(
      [...this.actionRuns.values()].filter((run) => ids.has(run.projectId)),
      query,
      (run) => ({
        createdAt: run.createdAt,
        id: run.id,
        actorId: run.triggeredById,
      }),
    ).map(({ log: _log, ...run }) => run);
  }

  async activityDayCounts(
    projectIds: string[],
    query: { since: string; actorId?: string },
  ): Promise<ActivityDayCount[]> {
    const ids = new Set(projectIds);
    const byDay = new Map<string, ActivityDayCount>();
    const count = (
      source: "commits" | "issues" | "comments",
      createdAt: string,
      actorId: string,
    ) => {
      if (createdAt < query.since) return;
      if (query.actorId !== undefined && actorId !== query.actorId) return;
      const day = createdAt.slice(0, 10);
      const entry = byDay.get(day) ?? { day, commits: 0, issues: 0, comments: 0 };
      entry[source] += 1;
      byDay.set(day, entry);
    };
    for (const commit of this.commits.values()) {
      const model = this.models.get(commit.modelId);
      if (model && ids.has(model.projectId)) {
        count("commits", commit.createdAt, commit.authorId);
      }
    }
    for (const issue of this.issues.values()) {
      if (ids.has(issue.projectId)) {
        count("issues", issue.createdAt, issue.authorId);
      }
    }
    for (const comment of this.issueComments.values()) {
      const issue = this.issues.get(comment.issueId);
      if (issue && ids.has(issue.projectId)) {
        count("comments", comment.createdAt, comment.authorId);
      }
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }

  async searchModels(
    projectIds: string[],
    text: string,
    limit: number,
  ): Promise<Model[]> {
    const ids = new Set(projectIds);
    const needle = text.toLowerCase();
    return [...this.models.values()]
      .filter(
        (model) =>
          ids.has(model.projectId) &&
          [model.name, model.slug, model.folder].some((value) =>
            value.toLowerCase().includes(needle),
          ),
      )
      .map((model) => ({
        model,
        rank:
          model.name.toLowerCase().startsWith(needle) ||
          model.slug.toLowerCase().startsWith(needle)
            ? 0
            : 1,
      }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.model.name.toLowerCase().localeCompare(b.model.name.toLowerCase()) ||
          a.model.id.localeCompare(b.model.id),
      )
      .slice(0, limit)
      .map((entry) => entry.model);
  }

  async searchIssues(
    projectIds: string[],
    query: { text: string; number?: number; limit: number },
  ): Promise<Issue[]> {
    const ids = new Set(projectIds);
    const needle = query.text.toLowerCase();
    return [...this.issues.values()]
      .filter(
        (issue) =>
          ids.has(issue.projectId) &&
          (issue.title.toLowerCase().includes(needle) ||
            issue.number === query.number),
      )
      .map((issue) => ({
        issue,
        rank:
          issue.number === query.number
            ? 0
            : issue.title.toLowerCase().startsWith(needle)
              ? 1
              : 2,
      }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          b.issue.createdAt.localeCompare(a.issue.createdAt) ||
          b.issue.id.localeCompare(a.issue.id),
      )
      .slice(0, query.limit)
      .map((entry) => entry.issue);
  }

  async counts(): Promise<RepositoryCounts> {
    return {
      users: this.users.size,
      projects: this.projects.size,
      models: this.models.size,
      commits: this.commits.size,
      issues: this.issues.size,
      runs: this.actionRuns.size,
    };
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

  async saveObjectRecords(
    commitId: string,
    records: ObjectRecord[],
  ): Promise<void> {
    const index: ObjectIndexEntry[] = [];
    for (const { detail, ...entry } of records) {
      if (!this.objectDetails.has(entry.hash)) {
        this.objectDetails.set(entry.hash, detail);
      }
      index.push(entry);
    }
    this.commitObjects.set(commitId, index);
  }

  async hasObjectIndex(commitId: string): Promise<boolean> {
    return this.commitObjects.has(commitId);
  }

  async getObjectIndex(commitId: string): Promise<ObjectIndexEntry[]> {
    return this.commitObjects.get(commitId) ?? [];
  }

  async getObjectDetails(
    recordHashes: string[],
  ): Promise<Map<string, ObjectDetail>> {
    const result = new Map<string, ObjectDetail>();
    for (const hash of recordHashes) {
      const detail = this.objectDetails.get(hash);
      if (detail) {
        result.set(hash, detail);
      }
    }
    return result;
  }

  async updateCommitStats(
    commitId: string,
    stats: { added: number; removed: number; modified: number },
  ): Promise<void> {
    const commit = this.commits.get(commitId);
    if (commit) {
      this.commits.set(commitId, { ...commit, ...stats });
    }
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
