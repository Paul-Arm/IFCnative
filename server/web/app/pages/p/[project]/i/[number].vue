<script setup lang="ts">
import {
  PhCheckCircle,
  PhPencilSimple,
  PhRecord,
  PhTrash,
} from "@phosphor-icons/vue";

import type {
  Issue,
  IssueComment,
  Label,
  Member,
  Model,
  Project,
  Role,
} from "~/types/api";

const route = useRoute();
const { api } = useApi();
const { user } = useAuth();
const slug = route.params.project as string;
const number = Number(route.params.number);

const { data: issueData, refresh } = await useAsyncData(
  `issue-${slug}-${number}`,
  () =>
    api<{ issue: Issue; comments: IssueComment[] }>(
      `/projects/${slug}/issues/${number}`,
    ),
);
const { data: projectData } = await useAsyncData(`project-role-${slug}`, () =>
  api<{
    project: Project;
    members: Member[];
    role: Role | null;
    folders: string[];
  }>(`/projects/${slug}`),
);
const { data: modelsData } = await useAsyncData(`models-${slug}`, () =>
  api<{ models: Model[] }>(`/projects/${slug}/models`),
);
const { data: labelsData, refresh: refreshLabels } = await useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
);

async function createProjectLabel(
  name: string,
  color: string,
): Promise<Label | null> {
  try {
    const { label } = await api<{ label: Label }>(`/projects/${slug}/labels`, {
      method: "POST",
      body: { name, color },
    });
    await refreshLabels();
    return label;
  } catch (e) {
    error.value = apiErrorMessage(e);
    return null;
  }
}

const issue = computed(() => issueData.value?.issue ?? null);
const comments = computed(() => issueData.value?.comments ?? []);

const hasWriteRole = computed(() => {
  const role = projectData.value?.role;
  return role === "owner" || role === "maintainer" || role === "contributor";
});
const canEdit = computed(
  () => hasWriteRole.value || issue.value?.authorId === user.value?.id,
);

const bodyHtml = computed(() =>
  issue.value?.body ? renderMarkdown(issue.value.body) : null,
);

const error = ref<string | null>(null);

async function patchIssue(patch: Record<string, unknown>): Promise<void> {
  error.value = null;
  try {
    await api(`/projects/${slug}/issues/${number}`, {
      method: "PATCH",
      body: patch,
    });
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

// ---- Titel/Body bearbeiten --------------------------------------------

const editing = ref(false);
const editTitle = ref("");
const editBody = ref("");

function startEdit(): void {
  editTitle.value = issue.value?.title ?? "";
  editBody.value = issue.value?.body ?? "";
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  await patchIssue({ title: editTitle.value, body: editBody.value });
  editing.value = false;
}

// ---- 3D-Verortung (betroffene GlobalIds im ThatOpen-Viewer) ------------

interface ViewerHandle {
  highlightGuids(guids: string[], zoom?: boolean): Promise<number>;
}

const viewerRef = ref<ViewerHandle | null>(null);
const show3d = ref(false);
/** Wie viele der Issue-GUIDs im geladenen Stand gefunden wurden. */
const foundCount = ref<number | null>(null);
const activeGuid = ref<string | null>(null);

/** Verknüpfte IFC-Modelle mit Head-Commit als Viewer-Quellen. */
const viewerSources = computed(() => {
  const linked = new Set(
    (issue.value?.models ?? [])
      .filter((model) => model.kind === "ifc")
      .map((model) => model.id),
  );
  return (modelsData.value?.models ?? [])
    .filter((model) => linked.has(model.id) && model.head)
    .map((model) => ({
      key: model.id,
      label: model.name,
      src: `/api/projects/${slug}/models/${model.slug}/commits/${model.head!.id}/fragments`,
    }));
});

const canLocate = computed(() =>
  Boolean(issue.value?.guids.length && viewerSources.value.length),
);

async function markAll(): Promise<void> {
  activeGuid.value = null;
  foundCount.value =
    (await viewerRef.value?.highlightGuids(issue.value?.guids ?? [], true)) ??
    0;
}

/** Erst-Markierung nach dem Laden: kurz warten, bis die Szene steht. */
function onViewerReady(): void {
  setTimeout(() => void markAll(), 400);
}

async function markOne(guid: string): Promise<void> {
  activeGuid.value = guid;
  const found = await viewerRef.value?.highlightGuids([guid], true);
  if (!found) {
    // Objekt existiert im aktuellen Stand nicht (mehr) — alle markieren.
    await markAll();
  }
}

// ---- Kommentare --------------------------------------------------------

const commentDraft = ref("");
const commentBusy = ref(false);

async function submitComment(): Promise<void> {
  if (!commentDraft.value.trim()) return;
  error.value = null;
  commentBusy.value = true;
  try {
    await api(`/projects/${slug}/issues/${number}/comments`, {
      method: "POST",
      body: { body: commentDraft.value },
    });
    commentDraft.value = "";
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    commentBusy.value = false;
  }
}

function canDeleteComment(comment: IssueComment): boolean {
  return hasWriteRole.value || comment.authorId === user.value?.id;
}

async function deleteComment(comment: IssueComment): Promise<void> {
  if (!window.confirm("Kommentar löschen?")) return;
  error.value = null;
  try {
    await api(`/projects/${slug}/issues/${number}/comments/${comment.id}`, {
      method: "DELETE",
    });
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

// ---- Zuordnungen (Sidebar, sofort speichern) ---------------------------

function idsWithToggle(current: string[], id: string, on: boolean): string[] {
  const set = new Set(current);
  if (on) {
    set.add(id);
  } else {
    set.delete(id);
  }
  return [...set];
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
</script>

<template>
  <div v-if="issue">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">
        {{ projectData?.project.name ?? slug }}
      </NuxtLink>
      <span>/</span>
      <NuxtLink :to="{ path: `/p/${slug}`, query: { tab: 'issues' } }">
        Issues
      </NuxtLink>
      <span>/</span>
      <strong>#{{ issue.number }}</strong>
    </nav>

    <div v-if="error" class="alert error">{{ error }}</div>

    <!-- Titelzeile über beiden Spalten -->
    <div class="issue-title-row">
      <h1 class="issue-title">
        {{ issue.title }}
        <span class="muted">#{{ issue.number }}</span>
      </h1>
      <span class="topbar-spacer" />
      <button v-if="canEdit && !editing" @click="startEdit">
        <PhPencilSimple :size="14" aria-hidden="true" />
        Bearbeiten
      </button>
      <button
        v-if="canEdit"
        @click="patchIssue({ state: issue.state === 'open' ? 'closed' : 'open' })"
      >
        {{ issue.state === "open" ? "Schließen" : "Wieder öffnen" }}
      </button>
    </div>
    <div class="issue-title-meta">
      <span class="issue-state-badge" :class="issue.state">
        <PhRecord v-if="issue.state === 'open'" :size="14" />
        <PhCheckCircle v-else :size="14" weight="fill" />
        {{ issue.state === "open" ? "Offen" : "Geschlossen" }}
      </span>
      <span class="muted small">
        <strong>{{ issue.author?.name ?? "?" }}</strong> eröffnete am
        {{ dateFmt.format(new Date(issue.createdAt)) }}
        · {{ comments.length }}
        {{ comments.length === 1 ? "Kommentar" : "Kommentare" }}
      </span>
    </div>

    <div class="issue-layout">
      <!-- ============ Hauptspalte: Body + Kommentare ============ -->
      <div class="issue-main">
        <div class="card comment-card">
          <div class="comment-head">
            <strong>{{ issue.author?.name ?? "?" }}</strong>
            <span class="muted small">
              {{ dateFmt.format(new Date(issue.createdAt)) }}
            </span>
          </div>
          <div class="card-body">
            <template v-if="!editing">
              <div v-if="bodyHtml" class="markdown-body" v-html="bodyHtml"></div>
              <p v-else class="muted" style="margin: 0">Keine Beschreibung.</p>
            </template>
            <template v-else>
              <div class="form-row">
                <label for="edit-title">Titel</label>
                <input id="edit-title" v-model="editTitle" type="text" required />
              </div>
              <div class="form-row">
                <label>Beschreibung (Markdown)</label>
                <MarkdownEditor v-model="editBody" min-height="10rem" />
              </div>
              <div class="form-inline">
                <button class="primary" @click="saveEdit">Speichern</button>
                <button @click="editing = false">Abbrechen</button>
              </div>
            </template>
          </div>
        </div>

        <!-- ============ 3D-Verortung (betroffene Objekte) ============ -->
        <div v-if="canLocate" class="card">
          <div class="card-header">
            <h2 style="margin: 0">3D-Verortung</h2>
            <span class="badge accent">
              {{ issue!.guids.length }}
              {{ issue!.guids.length === 1 ? "Objekt" : "Objekte" }}
            </span>
            <span v-if="foundCount !== null" class="muted small">
              {{ foundCount }} im aktuellen Stand gefunden
            </span>
            <span class="topbar-spacer" />
            <button @click="show3d = !show3d">
              {{ show3d ? "3D ausblenden" : "In 3D anzeigen" }}
            </button>
          </div>
          <template v-if="show3d">
            <div class="issue-guid-bar">
              <button class="btn small" @click="markAll">Alle markieren</button>
              <button
                v-for="guid in issue!.guids"
                :key="guid"
                class="guid-chip"
                :class="{ active: activeGuid === guid }"
                :title="`Objekt ${guid} markieren und anfahren`"
                @click="markOne(guid)"
              >
                {{ guid }}
              </button>
            </div>
            <ModelViewer
              ref="viewerRef"
              :sources="viewerSources"
              @ready="onViewerReady"
            />
          </template>
        </div>

        <div
          v-for="comment in comments"
          :key="comment.id"
          class="card comment-card"
        >
          <div class="comment-head">
            <strong>{{ comment.author?.name ?? "?" }}</strong>
            <span class="muted small">
              {{ dateFmt.format(new Date(comment.createdAt)) }}
            </span>
            <span class="topbar-spacer" />
            <button
              v-if="canDeleteComment(comment)"
              class="link danger comment-delete"
              title="Kommentar löschen"
              @click="deleteComment(comment)"
            >
              <PhTrash :size="14" aria-hidden="true" />
            </button>
          </div>
          <div
            class="card-body markdown-body"
            v-html="renderMarkdown(comment.body)"
          ></div>
        </div>

        <div class="card">
          <div class="card-body">
            <div class="form-row">
              <label>Kommentar (Markdown)</label>
              <MarkdownEditor
                v-model="commentDraft"
                placeholder="Antworten …"
                min-height="6rem"
              />
            </div>
            <button
              class="primary"
              :disabled="commentBusy || !commentDraft.trim()"
              @click="submitComment"
            >
              Kommentieren
            </button>
          </div>
        </div>
      </div>

      <!-- ============ Sidebar: Metadaten ============ -->
      <aside class="issue-side">
        <section class="issue-side-section">
          <h4>Zugewiesen an</h4>
          <p v-if="!issue.assignees.length && !canEdit" class="muted small">
            Niemand
          </p>
          <label
            v-for="member in projectData?.members ?? []"
            :key="member.userId"
            class="pv-item"
            :class="{
              'side-hidden':
                !canEdit &&
                !issue.assignees.some((a) => a.id === member.userId),
            }"
          >
            <input
              v-if="canEdit"
              type="checkbox"
              :checked="issue.assignees.some((a) => a.id === member.userId)"
              @change="
                patchIssue({
                  assigneeIds: idsWithToggle(
                    issue.assignees.map((a) => a.id),
                    member.userId,
                    ($event.target as HTMLInputElement).checked,
                  ),
                })
              "
            />
            <span class="pv-label">{{ member.user?.name ?? member.userId }}</span>
          </label>
        </section>

        <section class="issue-side-section">
          <h4>Modelle</h4>
          <p v-if="!issue.models.length && !canEdit" class="muted small">
            Keine
          </p>
          <label
            v-for="model in modelsData?.models ?? []"
            :key="model.id"
            class="pv-item"
            :class="{
              'side-hidden':
                !canEdit && !issue.models.some((m) => m.id === model.id),
            }"
          >
            <input
              v-if="canEdit"
              type="checkbox"
              :checked="issue.models.some((m) => m.id === model.id)"
              @change="
                patchIssue({
                  modelIds: idsWithToggle(
                    issue.models.map((m) => m.id),
                    model.id,
                    ($event.target as HTMLInputElement).checked,
                  ),
                })
              "
            />
            <span class="pv-label">
              <NuxtLink :to="`/p/${slug}/m/${model.slug}`">
                {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
              </NuxtLink>
            </span>
          </label>
        </section>

        <section class="issue-side-section">
          <h4>Labels</h4>
          <LabelPicker
            :labels="labelsData?.labels ?? []"
            :selected-ids="issue.labels.map((l) => l.id)"
            :editable="canEdit"
            :create-label="hasWriteRole ? createProjectLabel : undefined"
            @update="(ids) => patchIssue({ labelIds: ids })"
          />
        </section>
      </aside>
    </div>
  </div>
</template>
