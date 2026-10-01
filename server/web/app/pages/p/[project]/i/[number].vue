<script setup lang="ts">
import {
  PhArrowsLeftRight,
  PhCheckCircle,
  PhCube,
  PhCubeTransparent,
  PhDotsThree,
  PhDownloadSimple,
  PhLink,
  PhPencilSimple,
  PhPlus,
  PhRecord,
  PhTag,
  PhTrash,
  PhTreeStructure,
  PhUser,
  PhWarningCircle,
} from "@phosphor-icons/vue";

import type {
  Commit,
  Issue,
  IssueComment,
  IssueDetail,
  IssueEvent,
  Label,
} from "~/types/api";
import type { PickerItem } from "~/types/ui";

/**
 * Issue-Detail wie bei GitHub: Titelzeile, Unterhaltung als Timeline
 * (Beschreibung, Kommentare und Ereignisse), Kommentarfeld mit
 * „Mit Kommentar schließen“, Seitenleiste mit Zuordnungen. Sammel-Issues
 * zeigen den Unter-Issue-Explorer, verortete Issues einen 3D-Viewer.
 */
const route = useRoute();
const project = useProject();
const { slug, detail, models, canWrite } = project;
const { api } = useApi();
const { user, token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();
const { track } = useRecent();
const number = Number(route.params.number);

const {
  data: issueData,
  refresh,
  status: issueStatus,
  error: issueError,
} = useAsyncData(`issue-${slug}-${number}`, () => api<IssueDetail>(`/projects/${slug}/issues/${number}`), {
  lazy: true,
});
const { data: labelsData, refresh: refreshLabels } = useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
  { lazy: true },
);
const { data: allIssues } = useAsyncData(
  `issues-${slug}`,
  () => api<{ issues: Issue[] }>(`/projects/${slug}/issues`),
  { lazy: true },
);

const issue = computed(() => issueData.value?.issue ?? null);
const comments = computed(() => issueData.value?.comments ?? []);
const events = computed(() => issueData.value?.events ?? []);
const subIssues = computed(() => issueData.value?.subIssues ?? []);

watch(
  issue,
  (value) => {
    if (value) {
      track({
        type: "issue",
        title: value.title,
        subtitle: `${detail.value?.project.name ?? slug} #${value.number}`,
        to: `/p/${slug}/i/${value.number}`,
        state: value.state,
      });
    }
  },
  { immediate: true },
);
useHead({ title: computed(() => (issue.value ? `${issue.value.title} · #${number}` : `Issue #${number}`)) });

const canEdit = computed(() => canWrite.value || issue.value?.authorId === user.value?.id);

/** Neu rendern, damit Selects nach einer abgelehnten Änderung den echten Stand zeigen. */
const sideKey = ref(0);

async function patch(body: Record<string, unknown>, success?: string): Promise<boolean> {
  try {
    await api(`/projects/${slug}/issues/${number}`, { method: "PATCH", body });
    await refresh();
    void project.refreshStats();
    if (success) toast.success(success);
    return true;
  } catch (e) {
    sideKey.value += 1;
    toast.error(apiErrorMessage(e));
    return false;
  }
}

// ---- Titel + Beschreibung bearbeiten ---------------------------------------------

const editingTitle = ref(false);
const titleDraft = ref("");
function startTitleEdit(): void {
  titleDraft.value = issue.value?.title ?? "";
  editingTitle.value = true;
}
async function saveTitle(): Promise<void> {
  if (!titleDraft.value.trim()) return;
  if (await patch({ title: titleDraft.value.trim() })) editingTitle.value = false;
}

const editingBody = ref(false);
const bodyDraft = ref("");
function startBodyEdit(): void {
  bodyDraft.value = issue.value?.body ?? "";
  editingBody.value = true;
}
async function saveBody(): Promise<void> {
  if (await patch({ body: bodyDraft.value })) editingBody.value = false;
}

const bodyHtml = computed(() => (issue.value?.body ? renderMarkdown(issue.value.body) : null));

// ---- Timeline -------------------------------------------------------------------

type TimelineItem =
  | { type: "comment"; at: string; comment: IssueComment }
  | { type: "event"; at: string; event: IssueEvent };

const timeline = computed<TimelineItem[]>(() =>
  [
    ...comments.value.map((comment) => ({ type: "comment" as const, at: comment.createdAt, comment })),
    ...events.value.map((event) => ({ type: "event" as const, at: event.createdAt, event })),
  ].sort((a, b) => a.at.localeCompare(b.at)),
);

const participants = computed(() => {
  const map = new Map<string, { id: string; name: string }>();
  const add = (entry: { id: string; name: string } | null | undefined) => {
    if (entry) map.set(entry.id, entry);
  };
  add(issue.value?.author);
  for (const comment of comments.value) add(comment.author);
  for (const event of events.value) add(event.actor);
  return [...map.values()];
});

function eventIcon(event: IssueEvent) {
  switch (event.kind) {
    case "closed":
      return PhCheckCircle;
    case "reopened":
      return PhRecord;
    case "renamed":
      return PhPencilSimple;
    case "labeled":
    case "unlabeled":
      return PhTag;
    case "assigned":
    case "unassigned":
      return PhUser;
    case "linked_model":
    case "unlinked_model":
      return PhCube;
    case "parent_changed":
      return PhTreeStructure;
    default:
      return PhArrowsLeftRight;
  }
}

function eventBadge(event: IssueEvent): string {
  if (event.kind === "closed") return "done";
  if (event.kind === "reopened") return "success";
  return "";
}

function namesOf(users: { id: string; name: string }[] | undefined, actorId: string): string {
  const list = users ?? [];
  if (list.length === 1 && list[0]!.id === actorId) return "sich selbst";
  return list.map((entry) => entry.name).join(", ");
}

// ---- Kommentare ----------------------------------------------------------------------

const draft = ref("");
const commenting = ref(false);

async function submitComment(close = false): Promise<void> {
  if (commenting.value) return;
  const text = draft.value.trim();
  if (!text && !close) return;
  commenting.value = true;
  try {
    if (text) {
      await api(`/projects/${slug}/issues/${number}/comments`, { method: "POST", body: { body: text } });
      draft.value = "";
    }
    if (close && issue.value) {
      await api(`/projects/${slug}/issues/${number}`, {
        method: "PATCH",
        body: { state: issue.value.state === "open" ? "closed" : "open" },
      });
      void project.refreshStats();
    }
    await refresh();
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    commenting.value = false;
  }
}

function canDelete(comment: IssueComment): boolean {
  return canWrite.value || comment.authorId === user.value?.id;
}

async function deleteComment(comment: IssueComment): Promise<void> {
  const ok = await confirm({
    title: "Kommentar löschen?",
    message: "Der Kommentar wird endgültig entfernt.",
    confirmLabel: "Löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}/issues/${number}/comments/${comment.id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

async function copyLink(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${location.origin}/p/${slug}/i/${number}#${id}`);
    toast.info("Link kopiert.");
  } catch {
    // Zwischenablage nicht verfügbar
  }
}

// ---- Seitenleiste ------------------------------------------------------------------------

const memberItems = computed<PickerItem[]>(() =>
  (detail.value?.members ?? [])
    .filter((member) => member.user)
    .map((member) => ({ id: member.userId, label: member.user!.name, sub: member.user!.email, user: member.user })),
);
const modelItems = computed<PickerItem[]>(() =>
  (models.value ?? []).map((model) => ({
    id: model.id,
    label: model.name,
    sub: model.folder || undefined,
    model: { kind: model.kind, name: model.name },
  })),
);

async function createLabel(name: string, color: string): Promise<Label | null> {
  try {
    const { label } = await api<{ label: Label }>(`/projects/${slug}/labels`, {
      method: "POST",
      body: { name, color },
    });
    await refreshLabels();
    return label;
  } catch (e) {
    toast.error(apiErrorMessage(e));
    return null;
  }
}

function setModels(ids: string[]): void {
  const current = issue.value?.models ?? [];
  void patch({
    modelLinks: ids.map((id) => {
      const known = current.find((model) => model.id === id);
      return {
        modelId: id,
        foundCommitId: known?.foundCommitId ?? null,
        fixedCommitId: known?.fixedCommitId ?? null,
      };
    }),
  });
}

function setModelCommit(modelId: string, field: "found" | "fixed", commitId: string): void {
  void patch({
    modelLinks: (issue.value?.models ?? []).map((model) => ({
      modelId: model.id,
      foundCommitId: model.id === modelId && field === "found" ? commitId || null : model.foundCommitId,
      fixedCommitId: model.id === modelId && field === "fixed" ? commitId || null : model.fixedCommitId,
    })),
  });
}

const commitsByModel = reactive(new Map<string, Commit[]>());
watch(
  () => issue.value?.models,
  (list) => {
    for (const model of list ?? []) {
      if (commitsByModel.has(model.id)) continue;
      commitsByModel.set(model.id, []);
      void api<{ commits: Commit[] }>(`/projects/${slug}/models/${model.slug}/commits`)
        .then((result) => commitsByModel.set(model.id, result.commits))
        .catch(() => commitsByModel.delete(model.id));
    }
  },
  { immediate: true },
);

/** Das Issue selbst und alle (auch indirekten) Unter-Issues scheiden aus — der Server lehnt Zyklen ab. */
const parentCandidates = computed(() => {
  const list = allIssues.value?.issues ?? [];
  const excluded = new Set(subIssues.value.map((sub) => sub.id));
  if (issue.value) excluded.add(issue.value.id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of list) {
      if (entry.parentId && excluded.has(entry.parentId) && !excluded.has(entry.id)) {
        excluded.add(entry.id);
        grew = true;
      }
    }
  }
  return list.filter((entry) => !excluded.has(entry.id)).sort((a, b) => b.number - a.number);
});

async function downloadBcf(): Promise<void> {
  try {
    const blob = await $fetch<Blob>(`/api/projects/${slug}/issues/${number}/bcf`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-issue-${number}.bcfzip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- 3D-Verortung -------------------------------------------------------------------------

interface ViewerHandle {
  highlightGuids(guids: string[], zoom?: boolean): Promise<number>;
  isolateGuids(guids: string[]): Promise<number>;
  showAll(): Promise<void>;
}

const viewerRef = ref<ViewerHandle | null>(null);
const show3d = ref(false);
const foundCount = ref<number | null>(null);
const activeGuid = ref<string | null>(null);
const isolateOnly = ref(false);
let currentGuids: string[] = [];

const allGuids = computed(() => {
  const set = new Set(issue.value?.guids ?? []);
  for (const sub of subIssues.value) for (const guid of sub.guids) set.add(guid);
  return [...set];
});

const viewerSources = computed(() => {
  const linked = new Set(
    [issue.value, ...subIssues.value]
      .flatMap((entry) => entry?.models ?? [])
      .filter((model) => model.kind === "ifc")
      .map((model) => model.id),
  );
  return (models.value ?? [])
    .filter((model) => linked.has(model.id) && model.head)
    .map((model) => ({
      key: model.id,
      label: model.name,
      src: `/api/projects/${slug}/models/${model.slug}/commits/${model.head!.id}/fragments`,
    }));
});

const canLocate = computed(
  () => !subIssues.value.length && allGuids.value.length > 0 && viewerSources.value.length > 0,
);
const GUID_PREVIEW = 12;
const showAllGuids = ref(false);
const guidChips = computed(() =>
  showAllGuids.value ? (issue.value?.guids ?? []) : (issue.value?.guids ?? []).slice(0, GUID_PREVIEW),
);

async function applyIsolation(): Promise<void> {
  if (!viewerRef.value) return;
  if (isolateOnly.value && currentGuids.length) await viewerRef.value.isolateGuids(currentGuids);
  else await viewerRef.value.showAll();
}

async function mark(guids: string[]): Promise<number> {
  currentGuids = guids;
  const found = (await viewerRef.value?.highlightGuids(guids, true)) ?? 0;
  await applyIsolation();
  return found;
}

async function markAll(): Promise<void> {
  activeGuid.value = null;
  foundCount.value = await mark(allGuids.value);
}

async function markOne(guid: string): Promise<void> {
  activeGuid.value = guid;
  if (!(await mark([guid]))) await markAll();
}

watch(isolateOnly, () => void applyIsolation());

/** Erst-Markierung nach dem Laden: kurz warten, bis die Szene steht. */
function onViewerReady(): void {
  setTimeout(() => void markAll(), 400);
}

const openedAt = computed(() => issue.value?.createdAt ?? "");
</script>

<template>
  <div v-if="issueError" class="box">
    <Blankslate :icon="PhWarningCircle" :title="`Issue #${number} nicht gefunden`">
      {{ apiErrorMessage(issueError) }}
      <template #actions>
        <NuxtLink :to="`/p/${slug}/issues`" class="btn">Alle Issues</NuxtLink>
      </template>
    </Blankslate>
  </div>

  <div v-else-if="!issue && (issueStatus === 'pending' || issueStatus === 'idle')" class="issue-page">
    <span class="skeleton" style="width: 50%; height: 30px" />
    <SkeletonRows :rows="5" class="box" style="margin-top: 24px" />
  </div>

  <div v-else-if="issue" class="issue-page">
    <!-- ============ Titel ============ -->
    <header class="issue-header">
      <div class="issue-header-top">
        <form v-if="editingTitle" class="issue-title-edit" @submit.prevent="saveTitle">
          <input v-model="titleDraft" type="text" class="input-lg" maxlength="200" autofocus />
          <button type="submit" class="btn">Speichern</button>
          <button type="button" class="btn btn-invisible" @click="editingTitle = false">Abbrechen</button>
        </form>
        <h1 v-else class="issue-h1">
          {{ issue.title }} <span class="issue-number">#{{ issue.number }}</span>
        </h1>
        <div v-if="!editingTitle" class="issue-header-actions">
          <button v-if="canEdit" type="button" class="btn btn-sm" @click="startTitleEdit">Bearbeiten</button>
          <NuxtLink :to="`/p/${slug}/issues/new`" class="btn btn-sm btn-primary">
            <PhPlus :size="14" /> Neues Issue
          </NuxtLink>
        </div>
      </div>
      <div class="issue-header-meta">
        <span class="state" :class="issue.state === 'open' ? 'state-open' : 'state-closed'">
          <PhRecord v-if="issue.state === 'open'" :size="16" weight="bold" />
          <PhCheckCircle v-else :size="16" weight="fill" />
          {{ issue.state === "open" ? "Offen" : "Geschlossen" }}
        </span>
        <span v-if="issue.kind === 'bcf'" class="tag tag-accent tag-lg" title="Echtes IFC-Issue — als BCF exportierbar">BCF</span>
        <span class="muted">
          <strong class="text">{{ issue.author?.name ?? "?" }}</strong> eröffnete dieses Issue
          <RelTime :date="openedAt" /> · {{ plural(comments.length, "Kommentar", "Kommentare") }}
        </span>
        <span v-if="issue.parent" class="muted">
          · Teil von
          <NuxtLink :to="`/p/${slug}/i/${issue.parent.number}`">#{{ issue.parent.number }} {{ issue.parent.title }}</NuxtLink>
        </span>
      </div>
    </header>

    <!-- ============ Unter-Issue-Explorer (Sammel-Issue) ============ -->
    <SubIssueExplorer v-if="subIssues.length" :slug="slug" :sub-issues="subIssues" :sources="viewerSources" />

    <div class="layout issue-layout">
      <div class="layout-main">
        <div class="discussion">
          <!-- Beschreibung als erster Beitrag -->
          <div id="beschreibung" class="comment" :class="{ self: issue.authorId === user?.id }">
            <UserAvatar :user="issue.author" :size="40" />
            <div class="comment-box">
              <div class="comment-head">
                <span class="author">{{ issue.author?.name ?? "?" }}</span>
                eröffnete <RelTime :date="issue.createdAt" />
                <span class="spacer" />
                <span class="tag">Autor</span>
                <button
                  v-if="canEdit && !editingBody"
                  type="button"
                  class="btn btn-invisible btn-xs btn-icon"
                  aria-label="Beschreibung bearbeiten"
                  data-tip="Bearbeiten"
                  @click="startBodyEdit"
                >
                  <PhPencilSimple :size="14" />
                </button>
              </div>
              <div v-if="editingBody" class="comment-body compose-edit">
                <MarkdownEditor v-model="bodyDraft" min-height="10rem" />
                <div class="form-actions">
                  <button type="button" class="btn" @click="editingBody = false">Abbrechen</button>
                  <button type="button" class="btn btn-primary" @click="saveBody">Speichern</button>
                </div>
              </div>
              <div v-else-if="bodyHtml" class="comment-body markdown-body" v-html="bodyHtml" />
              <div v-else class="comment-body muted"><em>Keine Beschreibung.</em></div>
            </div>
          </div>

          <!-- 3D-Verortung -->
          <div v-if="canLocate" class="comment locate">
            <span class="tl-badge accent locate-badge"><PhCubeTransparent :size="16" /></span>
            <div class="box locate-box">
              <div class="box-header">
                <PhCube :size="16" class="color-accent" />
                <span class="box-title">3D-Verortung</span>
                <span class="counter">{{ allGuids.length }}</span>
                <span v-if="foundCount !== null" class="muted small">· {{ foundCount }} im aktuellen Stand gefunden</span>
                <span class="spacer" />
                <label v-if="show3d" class="switch small">
                  <input v-model="isolateOnly" type="checkbox" />
                  <span class="switch-track" />
                  Nur betroffene
                </label>
                <button type="button" class="btn btn-sm" :class="{ 'btn-accent': !show3d }" @click="show3d = !show3d">
                  {{ show3d ? "3D ausblenden" : "In 3D anzeigen" }}
                </button>
              </div>
              <template v-if="show3d">
                <div class="guid-bar">
                  <button type="button" class="btn btn-xs" @click="markAll">Alle markieren</button>
                  <button
                    v-for="guid in guidChips"
                    :key="guid"
                    type="button"
                    class="guid-chip"
                    :class="{ active: activeGuid === guid }"
                    :title="`Objekt ${guid} markieren und anfahren`"
                    @click="markOne(guid)"
                  >
                    {{ guid }}
                  </button>
                  <button
                    v-if="issue.guids.length > GUID_PREVIEW"
                    type="button"
                    class="guid-chip"
                    @click="showAllGuids = !showAllGuids"
                  >
                    {{ showAllGuids ? "weniger" : `+${issue.guids.length - GUID_PREVIEW} weitere` }}
                  </button>
                </div>
                <ModelViewer ref="viewerRef" :sources="viewerSources" @ready="onViewerReady" />
              </template>
            </div>
          </div>

          <!-- Kommentare + Ereignisse -->
          <template v-for="item in timeline" :key="item.type === 'comment' ? item.comment.id : item.event.id">
            <div
              v-if="item.type === 'comment'"
              :id="`comment-${item.comment.id}`"
              class="comment"
              :class="{ self: item.comment.authorId === user?.id }"
            >
              <UserAvatar :user="item.comment.author" :size="40" />
              <div class="comment-box">
                <div class="comment-head">
                  <span class="author">{{ item.comment.author?.name ?? "?" }}</span>
                  kommentierte
                  <a :href="`#comment-${item.comment.id}`" class="muted"><RelTime :date="item.comment.createdAt" /></a>
                  <span class="spacer" />
                  <span v-if="item.comment.authorId === issue.authorId" class="tag">Autor</span>
                  <UiMenu align="right">
                    <template #trigger="{ toggle }">
                      <button type="button" class="btn btn-invisible btn-xs btn-icon" aria-label="Kommentar-Aktionen" @click="toggle">
                        <PhDotsThree :size="16" weight="bold" />
                      </button>
                    </template>
                    <button type="button" class="menu-item" @click="copyLink(`comment-${item.comment.id}`)">
                      <PhLink :size="16" /> Link kopieren
                    </button>
                    <button
                      v-if="canDelete(item.comment)"
                      type="button"
                      class="menu-item danger"
                      @click="deleteComment(item.comment)"
                    >
                      <PhTrash :size="16" /> Löschen
                    </button>
                  </UiMenu>
                </div>
                <div class="comment-body markdown-body" v-html="renderMarkdown(item.comment.body)" />
              </div>
            </div>

            <div v-else class="tl-event">
              <span class="tl-badge" :class="eventBadge(item.event)">
                <component :is="eventIcon(item.event)" :size="16" :weight="item.event.kind === 'closed' ? 'fill' : 'regular'" />
              </span>
              <UserAvatar :user="item.event.actor" :size="20" />
              <span class="tl-text">
                <span class="author">{{ item.event.actor?.name ?? "Jemand" }}</span>
                <template v-if="item.event.kind === 'closed'"> hat dieses Issue geschlossen</template>
                <template v-else-if="item.event.kind === 'reopened'"> hat dieses Issue wieder geöffnet</template>
                <template v-else-if="item.event.kind === 'renamed'">
                  hat den Titel geändert: <del>{{ item.event.data.from }}</del> → <strong class="text">{{ item.event.data.to }}</strong>
                </template>
                <template v-else-if="item.event.kind === 'labeled' || item.event.kind === 'unlabeled'">
                  hat
                  <LabelChip v-for="label in item.event.data.labels ?? []" :key="label.id" :label="label" />
                  {{ item.event.kind === "labeled" ? "hinzugefügt" : "entfernt" }}
                </template>
                <template v-else-if="item.event.kind === 'assigned'">
                  hat {{ namesOf(item.event.data.users, item.event.actorId) }} zugewiesen
                </template>
                <template v-else-if="item.event.kind === 'unassigned'">
                  hat die Zuweisung von {{ namesOf(item.event.data.users, item.event.actorId) }} entfernt
                </template>
                <template v-else-if="item.event.kind === 'linked_model' || item.event.kind === 'unlinked_model'">
                  hat
                  <template v-for="(model, index) in item.event.data.models ?? []" :key="model.id">
                    <template v-if="index">, </template>
                    <NuxtLink :to="`/p/${slug}/m/${model.slug}`" class="text strong">{{ model.name }}</NuxtLink>
                  </template>
                  {{ item.event.kind === "linked_model" ? "verknüpft" : "entknüpft" }}
                </template>
                <template v-else-if="item.event.kind === 'parent_changed'">
                  <template v-if="item.event.data.parent">
                    hat dieses Issue #{{ item.event.data.parent.number }} {{ item.event.data.parent.title }} untergeordnet
                  </template>
                  <template v-else> hat die Zuordnung zum übergeordneten Issue entfernt</template>
                </template>
                <template v-else-if="item.event.kind === 'kind_changed'">
                  hat die Art auf <strong class="text">{{ item.event.data.to === "bcf" ? "IFC-Issue (BCF)" : "Virtuell" }}</strong> geändert
                </template>
                · <RelTime :date="item.event.createdAt" />
              </span>
            </div>
          </template>

          <div class="tl-break" />

          <!-- Kommentieren -->
          <div class="comment compose-comment">
            <UserAvatar :user="user" :size="40" />
            <div class="comment-box">
              <div class="comment-head">
                <span class="author">Kommentar schreiben</span>
              </div>
              <div class="comment-body">
                <MarkdownEditor v-model="draft" placeholder="Antworten … (Markdown)" min-height="7rem" />
                <div class="form-actions">
                  <button
                    v-if="canEdit"
                    type="button"
                    class="btn"
                    :disabled="commenting"
                    @click="submitComment(true)"
                  >
                    <template v-if="issue.state === 'open'">
                      <PhCheckCircle :size="16" class="color-done" />
                      {{ draft.trim() ? "Mit Kommentar schließen" : "Issue schließen" }}
                    </template>
                    <template v-else>
                      <PhRecord :size="16" class="color-success" />
                      {{ draft.trim() ? "Mit Kommentar wieder öffnen" : "Wieder öffnen" }}
                    </template>
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary"
                    :disabled="commenting || !draft.trim()"
                    @click="submitComment(false)"
                  >
                    <span v-if="commenting" class="spinner" />
                    Kommentieren
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ============ Seitenleiste ============ -->
      <aside class="layout-side issue-side">
        <SidePicker
          title="Zugewiesen"
          :items="memberItems"
          :selected="issue.assignees.map((a) => a.id)"
          :editable="canEdit"
          empty-text="Niemand"
          @update="(ids) => patch({ assigneeIds: ids })"
        />
        <LabelPicker
          :labels="labelsData?.labels ?? []"
          :selected-ids="issue.labels.map((l) => l.id)"
          :editable="canEdit"
          :create-label="canWrite ? createLabel : undefined"
          @update="(ids) => patch({ labelIds: ids })"
        />
        <SidePicker
          title="Modelle"
          :items="modelItems"
          :selected="issue.models.map((m) => m.id)"
          :editable="canEdit"
          empty-text="Keine"
          @update="setModels"
        >
          <div v-for="linked in issue.models" :key="`v-${linked.id}`" class="side-version">
            <div class="side-version-title">
              <ModelIcon :kind="linked.kind" :name="linked.name" :size="14" />
              <NuxtLink :to="`/p/${slug}/m/${linked.slug}`" class="truncate">{{ linked.name }}</NuxtLink>
            </div>
            <div class="side-version-row">
              <span class="muted small">Aufgefallen in</span>
              <select
                v-if="canEdit"
                :key="`found-${sideKey}`"
                class="input-sm"
                :value="linked.foundCommitId ?? ''"
                @change="setModelCommit(linked.id, 'found', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="commit in commitsByModel.get(linked.id) ?? []" :key="commit.id" :value="commit.id">
                  {{ shortSha(commit.id) }} · {{ commit.message || "(ohne Nachricht)" }}
                </option>
              </select>
              <NuxtLink
                v-else-if="linked.foundCommit"
                class="sha"
                :to="`/p/${slug}/m/${linked.slug}/c/${linked.foundCommit.id}`"
              >{{ shortSha(linked.foundCommit.id) }}</NuxtLink>
            </div>
            <div class="side-version-row">
              <span class="muted small">Behoben in</span>
              <select
                v-if="canEdit"
                :key="`fixed-${sideKey}`"
                class="input-sm"
                :value="linked.fixedCommitId ?? ''"
                @change="setModelCommit(linked.id, 'fixed', ($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="commit in commitsByModel.get(linked.id) ?? []" :key="commit.id" :value="commit.id">
                  {{ shortSha(commit.id) }} · {{ commit.message || "(ohne Nachricht)" }}
                </option>
              </select>
              <NuxtLink
                v-else-if="linked.fixedCommit"
                class="sha"
                :to="`/p/${slug}/m/${linked.slug}/c/${linked.fixedCommit.id}`"
              >{{ shortSha(linked.fixedCommit.id) }}</NuxtLink>
            </div>
          </div>
        </SidePicker>

        <section class="side-section">
          <div class="side-head"><span>Art</span></div>
          <div v-if="canEdit" class="seg side-seg">
            <button type="button" :class="{ active: issue.kind === 'virtual' }" @click="issue.kind !== 'virtual' && patch({ kind: 'virtual' })">
              Virtuell
            </button>
            <button type="button" :class="{ active: issue.kind === 'bcf' }" @click="issue.kind !== 'bcf' && patch({ kind: 'bcf' })">
              IFC-Issue (BCF)
            </button>
          </div>
          <p v-else class="side-empty">{{ issue.kind === "bcf" ? "IFC-Issue (BCF)" : "Virtuell" }}</p>
          <button v-if="issue.kind === 'bcf'" type="button" class="btn btn-sm side-bcf" @click="downloadBcf">
            <PhDownloadSimple :size="14" /> Als BCF exportieren
          </button>
        </section>

        <section class="side-section">
          <div class="side-head"><span>Übergeordnetes Issue</span></div>
          <select
            v-if="canEdit"
            :key="`parent-${sideKey}`"
            class="input-sm"
            :value="issue.parentId ?? ''"
            @change="patch({ parentId: ($event.target as HTMLSelectElement).value || null })"
          >
            <option value="">— keines —</option>
            <option v-for="candidate in parentCandidates" :key="candidate.id" :value="candidate.id">
              #{{ candidate.number }} {{ candidate.title }}
            </option>
          </select>
          <p v-else-if="issue.parent" class="side-empty">
            <NuxtLink :to="`/p/${slug}/i/${issue.parent.number}`">#{{ issue.parent.number }} {{ issue.parent.title }}</NuxtLink>
          </p>
          <p v-else class="side-empty">Keines</p>
        </section>

        <section v-if="participants.length" class="side-section">
          <div class="side-head"><span>{{ plural(participants.length, "Beteiligte Person", "Beteiligte") }}</span></div>
          <div class="side-people">
            <UserAvatar v-for="person in participants" :key="person.id" :user="person" :size="26" />
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>
