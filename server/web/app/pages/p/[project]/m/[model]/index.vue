<script setup lang="ts">
import {
  PhBookOpen,
  PhCubeTransparent,
  PhGear,
  PhGitBranch,
  PhGitCommit,
  PhPencilSimple,
  PhUploadSimple,
} from "@phosphor-icons/vue";

import type {
  Branch,
  Commit,
  GuidDiffSummary,
  Member,
  Model,
  Project,
  Role,
} from "~/types/api";

const route = useRoute();
const router = useRouter();
const { api } = useApi();
const { token } = useAuth();
const slug = route.params.project as string;
const modelSlug = route.params.model as string;
const base = `/projects/${slug}/models/${modelSlug}`;

const { data: modelData, refresh: refreshModel } = await useAsyncData(
  `model-${slug}-${modelSlug}`,
  () => api<{ model: Model; branches: Branch[] }>(base),
);
const { data: projectData } = await useAsyncData(`project-role-${slug}`, () =>
  api<{
    project: Project;
    members: Member[];
    role: Role | null;
    folders: string[];
  }>(`/projects/${slug}`),
);

const isAdmin = computed(
  () =>
    projectData.value?.role === "owner" ||
    projectData.value?.role === "maintainer",
);
const canWrite = computed(
  () => isAdmin.value || projectData.value?.role === "contributor",
);
const isMd = computed(() => modelData.value?.model.kind === "md");

const folderCrumbs = computed(() => {
  const folder = modelData.value?.model.folder ?? "";
  if (!folder) return [];
  const segments = folder.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
  }));
});

// ---- Tabs --------------------------------------------------------------

type Tab = "inhalt" | "commits" | "3d" | "einstellungen";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  if (value === "commits" || value === "einstellungen") return value;
  if (value === "inhalt" && isMd.value) return "inhalt";
  if (value === "3d" && !isMd.value) return "3d";
  return isMd.value ? "inhalt" : "commits";
});

function goTab(nextTab: Tab): void {
  router.replace({ query: { ...route.query, tab: nextTab } });
}

// ---- Branch-Auswahl + Commits -----------------------------------------

const selectedBranch = ref<string | null>(null);
watchEffect(() => {
  if (selectedBranch.value === null && modelData.value) {
    selectedBranch.value = modelData.value.model.defaultBranch;
  }
});

const { data: commitsData, refresh: refreshCommits } = await useAsyncData(
  `commits-${slug}-${modelSlug}`,
  () =>
    api<{ commits: Commit[] }>(`${base}/commits`, {
      query: selectedBranch.value ? { branch: selectedBranch.value } : {},
    }),
  { watch: [selectedBranch] },
);

// ---- Commit-Graph ------------------------------------------------------

const ROW_H = 62;
const LANE_W = 18;
const LANE_COLORS = [
  "#4493f8",
  "#3fb950",
  "#d29922",
  "#a371f7",
  "#f85149",
  "#39c5cf",
];

function laneX(lane: number): number {
  return 11 + lane * LANE_W;
}

function rowY(index: number): number {
  return index * ROW_H + ROW_H / 2;
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!;
}

const graph = computed(() => {
  const commits = commitsData.value?.commits ?? [];
  const laneOrder: string[] = [];
  const defaultBranch = modelData.value?.model.defaultBranch;
  if (defaultBranch && commits.some((c) => c.branchName === defaultBranch)) {
    laneOrder.push(defaultBranch);
  }
  for (const commit of commits) {
    if (!laneOrder.includes(commit.branchName)) {
      laneOrder.push(commit.branchName);
    }
  }
  const indexById = new Map(commits.map((c, i) => [c.id, i]));
  const rows = commits.map((commit, index) => ({
    commit,
    index,
    lane: Math.max(0, laneOrder.indexOf(commit.branchName)),
  }));
  const edges: { path: string; color: string }[] = [];
  for (const row of rows) {
    const parentIndex = row.commit.parentCommitId
      ? indexById.get(row.commit.parentCommitId)
      : undefined;
    if (parentIndex === undefined) continue;
    const parent = rows[parentIndex]!;
    const x1 = laneX(row.lane);
    const y1 = rowY(row.index);
    const x2 = laneX(parent.lane);
    const y2 = rowY(parent.index);
    const path =
      x1 === x2
        ? `M ${x1} ${y1} L ${x2} ${y2}`
        : `M ${x1} ${y1} L ${x1} ${y2 - ROW_H / 2} Q ${x1} ${y2} ${x2} ${y2}`;
    edges.push({ path, color: laneColor(row.lane) });
  }
  return {
    rows,
    edges,
    laneCount: Math.max(1, laneOrder.length),
    width: 11 + Math.max(1, laneOrder.length) * LANE_W,
    height: Math.max(rows.length * ROW_H, ROW_H),
  };
});

// ---- Committen (Modal) -------------------------------------------------

const showCommitModal = ref(false);
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const message = ref("");
const commitBranch = ref<string>("");
const newBranchName = ref("");
const uploadError = ref<string | null>(null);
const uploadResult = ref<{ commit: Commit; diff: GuidDiffSummary } | null>(null);
const uploading = ref(false);

watchEffect(() => {
  if (!commitBranch.value && modelData.value) {
    commitBranch.value = modelData.value.model.defaultBranch;
  }
});

function openCommitModal(): void {
  uploadError.value = null;
  uploadResult.value = null;
  commitBranch.value = selectedBranch.value || modelData.value?.model.defaultBranch || "main";
  showCommitModal.value = true;
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function submitCommit(): Promise<void> {
  if (!file.value) return;
  uploadError.value = null;
  uploadResult.value = null;
  uploading.value = true;
  try {
    const branch =
      commitBranch.value === "__new__" ? newBranchName.value.trim() : commitBranch.value;
    if (!branch) {
      uploadError.value = "Branch-Name fehlt";
      return;
    }
    const form = new FormData();
    form.append("message", message.value);
    form.append("branch", branch);
    form.append("file", file.value);
    const result = await api<{ commit: Commit; diff: GuidDiffSummary }>(
      `${base}/commits`,
      { method: "POST", body: form },
    );
    uploadResult.value = result;
    message.value = "";
    file.value = null;
    if (fileInput.value) fileInput.value.value = "";
    showCommitModal.value = false;
    selectedBranch.value = branch;
    await Promise.all([refreshModel(), refreshCommits()]);
  } catch (e) {
    uploadError.value = apiErrorMessage(e);
  } finally {
    uploading.value = false;
  }
}

// ---- Branch anlegen (Modal) --------------------------------------------

const showBranchModal = ref(false);
const branchName = ref("");
const branchFrom = ref("");
const branchError = ref<string | null>(null);

function openBranchModal(): void {
  branchError.value = null;
  branchFrom.value =
    selectedBranch.value || modelData.value?.model.defaultBranch || "main";
  showBranchModal.value = true;
}

async function createBranch(): Promise<void> {
  branchError.value = null;
  try {
    await api(`${base}/branches`, {
      method: "POST",
      body: { name: branchName.value.trim(), from: branchFrom.value },
    });
    branchName.value = "";
    showBranchModal.value = false;
    await refreshModel();
  } catch (e) {
    branchError.value = apiErrorMessage(e);
  }
}

// ---- Markdown-Inhalt (nur kind "md") ----------------------------------

const contentText = ref<string | null>(null);
const contentHtml = ref<string | null>(null);
const editing = ref(false);
const editDraft = ref("");
const editMessage = ref("");
const editBusy = ref(false);

const headCommit = computed(() => commitsData.value?.commits[0] ?? null);

watch(
  [headCommit, isMd],
  async () => {
    contentHtml.value = null;
    contentText.value = null;
    if (!isMd.value || !headCommit.value) return;
    try {
      const text = await $fetch<string>(
        `/api${base}/commits/${headCommit.value.id}/file`,
        {
          responseType: "text",
          headers: token.value
            ? { authorization: `Bearer ${token.value}` }
            : {},
        },
      );
      contentText.value = text;
      contentHtml.value = renderMarkdown(text);
    } catch {
      contentHtml.value = null;
    }
  },
  { immediate: true },
);

function startEdit(): void {
  editDraft.value = contentText.value ?? "";
  editMessage.value = "";
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  uploadError.value = null;
  editBusy.value = true;
  try {
    await $fetch(`/api${base}/commits`, {
      method: "POST",
      query: {
        branch: selectedBranch.value || modelData.value?.model.defaultBranch,
        message: editMessage.value.trim() || "Aktualisiert",
      },
      body: editDraft.value,
      headers: {
        "content-type": "text/markdown",
        ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
      },
    });
    editing.value = false;
    await Promise.all([refreshModel(), refreshCommits()]);
  } catch (e) {
    uploadError.value = apiErrorMessage(e);
  } finally {
    editBusy.value = false;
  }
}

// ---- Einstellungen -----------------------------------------------------

const settingsError = ref<string | null>(null);
const settingsNotice = ref<string | null>(null);
const folderDraft = ref<string | null>(null);

watchEffect(() => {
  if (folderDraft.value === null && modelData.value) {
    folderDraft.value = modelData.value.model.folder ?? "";
  }
});

async function patchModel(patch: {
  visibility?: "private" | "public";
  defaultBranch?: string;
  folder?: string;
}): Promise<void> {
  settingsError.value = null;
  settingsNotice.value = null;
  try {
    await api(base, { method: "PATCH", body: patch });
    settingsNotice.value = "Gespeichert.";
    await refreshModel();
  } catch (e) {
    settingsError.value = apiErrorMessage(e);
  }
}

async function deleteModel(): Promise<void> {
  const model = modelData.value?.model;
  if (!model) return;
  if (
    !window.confirm(
      `„${model.name}" mit allen Branches und Versionsständen unwiderruflich löschen?`,
    )
  ) {
    return;
  }
  settingsError.value = null;
  try {
    await api(base, { method: "DELETE" });
    await navigateTo(`/p/${slug}`);
  } catch (e) {
    settingsError.value = apiErrorMessage(e);
  }
}

// ---- Download ----------------------------------------------------------

async function downloadCommit(commit: Commit): Promise<void> {
  const blob = await $fetch<Blob>(`/api${base}/commits/${commit.id}/file`, {
    responseType: "blob",
    headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${modelSlug}-${commit.id.slice(0, 8)}.${isMd.value ? "md" : "ifc"}`;
  a.click();
  URL.revokeObjectURL(url);
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
</script>

<template>
  <div v-if="modelData">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">
        {{ projectData?.project.name ?? slug }}
      </NuxtLink>
      <template v-for="crumb in folderCrumbs" :key="crumb.path">
        <span>/</span>
        <NuxtLink :to="{ path: `/p/${slug}`, query: { path: crumb.path } }">
          {{ crumb.label }}
        </NuxtLink>
      </template>
      <span>/</span>
      <strong>{{ modelData.model.name }}</strong>
      <span
        class="badge"
        :class="modelData.model.visibility === 'public' ? 'success' : ''"
      >
        {{ modelData.model.visibility === "public" ? "öffentlich" : "privat" }}
      </span>
      <span v-if="isMd" class="badge">Markdown</span>
    </nav>

    <nav class="gh-tabs">
      <button
        v-if="isMd"
        :class="{ active: tab === 'inhalt' }"
        @click="goTab('inhalt')"
      >
        <PhBookOpen :size="16" aria-hidden="true" />
        Inhalt
      </button>
      <button :class="{ active: tab === 'commits' }" @click="goTab('commits')">
        <PhGitCommit :size="16" aria-hidden="true" />
        Commits
        <span class="counter">{{ commitsData?.commits.length ?? 0 }}</span>
      </button>
      <button
        v-if="!isMd"
        :class="{ active: tab === '3d' }"
        @click="goTab('3d')"
      >
        <PhCubeTransparent :size="16" aria-hidden="true" />
        3D
      </button>
      <button
        v-if="isAdmin"
        :class="{ active: tab === 'einstellungen' }"
        @click="goTab('einstellungen')"
      >
        <PhGear :size="16" aria-hidden="true" />
        Einstellungen
      </button>
    </nav>

    <div v-if="uploadResult" class="alert success">
      Commit {{ uploadResult.commit.id.slice(0, 8) }} angelegt —
      {{ uploadResult.diff.added.length }} neu,
      {{ uploadResult.diff.modified.length }} geändert,
      {{ uploadResult.diff.removed.length }} entfernt<span
        v-if="uploadResult.diff.identical"
      >
        (inhaltlich identisch mit dem Vorgänger)</span
      >.
    </div>
    <div v-if="uploadError && !showCommitModal" class="alert error">
      {{ uploadError }}
    </div>

    <!-- ================= Tab: Inhalt (Markdown) ================= -->
    <div v-if="tab === 'inhalt' && isMd" class="card">
      <div class="card-header">
        <strong>{{ modelData.model.name }}</strong>
        <span v-if="selectedBranch" class="badge">{{ selectedBranch }}</span>
        <span class="topbar-spacer" />
        <button v-if="!editing && canWrite" @click="startEdit">
          <PhPencilSimple :size="14" aria-hidden="true" />
          Bearbeiten
        </button>
      </div>
      <template v-if="!editing">
        <div
          v-if="contentHtml"
          class="card-body markdown-body"
          v-html="contentHtml"
        ></div>
        <div v-else class="empty">
          Noch kein Inhalt auf diesem Branch — über „Bearbeiten“ die erste
          Version committen.
        </div>
      </template>
      <div v-else class="card-body">
        <div class="form-row">
          <textarea
            v-model="editDraft"
            rows="14"
            style="font-family: var(--mono); font-size: 0.85rem"
          ></textarea>
        </div>
        <div class="form-inline">
          <div>
            <label for="edit-message">Commit-Nachricht</label>
            <input
              id="edit-message"
              v-model="editMessage"
              type="text"
              placeholder="Was hat sich geändert?"
            />
          </div>
          <div class="shrink">
            <button class="primary" :disabled="editBusy" @click="saveEdit">
              Committen
            </button>
          </div>
          <div class="shrink">
            <button :disabled="editBusy" @click="editing = false">
              Abbrechen
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Tab: Commits (Graph) ================= -->
    <div v-else-if="tab === 'commits'" class="card">
      <div class="card-header">
        <div class="tabs">
          <button
            v-for="branch in modelData.branches"
            :key="branch.id"
            :class="{ active: selectedBranch === branch.name }"
            @click="selectedBranch = branch.name"
          >
            {{ branch.name }}
          </button>
          <button
            :class="{ active: selectedBranch === '' }"
            @click="selectedBranch = ''"
          >
            alle
          </button>
        </div>
        <span class="topbar-spacer" />
        <template v-if="canWrite">
          <button @click="openBranchModal">
            <PhGitBranch :size="14" aria-hidden="true" />
            Neuer Branch
          </button>
          <button v-if="!isMd" class="primary" @click="openCommitModal">
            <PhUploadSimple :size="14" aria-hidden="true" />
            Neuen Stand committen
          </button>
          <button
            v-else
            class="primary"
            @click="goTab('inhalt'); startEdit()"
          >
            Bearbeiten
          </button>
        </template>
      </div>

      <div v-if="graph.rows.length" class="cg-wrap">
        <svg
          class="cg-svg"
          :width="graph.width"
          :height="graph.height"
          aria-hidden="true"
        >
          <path
            v-for="(edge, i) in graph.edges"
            :key="i"
            :d="edge.path"
            :stroke="edge.color"
            stroke-width="2"
            fill="none"
          />
          <circle
            v-for="row in graph.rows"
            :key="row.commit.id"
            :cx="laneX(row.lane)"
            :cy="rowY(row.index)"
            r="4.5"
            :fill="laneColor(row.lane)"
          />
        </svg>
        <div class="cg-rows">
          <div v-for="row in graph.rows" :key="row.commit.id" class="cg-row">
            <div class="cg-main">
              <NuxtLink
                class="cg-msg"
                :to="`/p/${slug}/m/${modelSlug}/c/${row.commit.id}`"
              >
                {{ row.commit.message || "(ohne Nachricht)" }}
              </NuxtLink>
              <div class="cg-meta">
                <span
                  class="cg-branch"
                  :style="{ color: laneColor(row.lane), borderColor: laneColor(row.lane) }"
                >{{ row.commit.branchName }}</span>
                {{ row.commit.author?.name ?? "?" }} ·
                {{ dateFmt.format(new Date(row.commit.createdAt)) }} ·
                <span class="mono">{{ row.commit.id.slice(0, 8) }}</span>
              </div>
            </div>
            <span v-if="!isMd" class="diffstat">
              <span class="add">+{{ row.commit.added }}</span>
              <span class="mod">~{{ row.commit.modified }}</span>
              <span class="del">−{{ row.commit.removed }}</span>
            </span>
            <span v-if="!isMd" class="muted small cg-entities">
              {{ row.commit.entityCount }} Entities
            </span>
            <button class="link" @click="downloadCommit(row.commit)">
              .{{ isMd ? "md" : "ifc" }}
            </button>
          </div>
        </div>
      </div>
      <div v-else class="empty">
        Noch keine Commits auf diesem Branch.
      </div>
    </div>

    <!-- ================= Tab: 3D-Vorschau ================= -->
    <div v-else-if="tab === '3d'" class="card">
      <div class="card-header">
        <strong>3D-Vorschau</strong>
        <span v-if="selectedBranch" class="badge">{{ selectedBranch }}</span>
        <span v-if="headCommit" class="commit-id">
          {{ headCommit.message || "(ohne Nachricht)" }} ·
          {{ headCommit.id.slice(0, 8) }}
        </span>
      </div>
      <ModelViewer
        v-if="headCommit"
        :key="headCommit.id"
        :src="`/api${base}/commits/${headCommit.id}/fragments`"
      />
      <div v-else class="empty">
        Noch keine Commits auf diesem Branch — erst einen Stand committen.
      </div>
    </div>

    <!-- ================= Tab: Einstellungen ================= -->
    <template v-else-if="tab === 'einstellungen'">
      <div class="card">
        <div class="card-header"><h2>Einstellungen</h2></div>
        <div class="card-body">
          <div v-if="settingsError" class="alert error">{{ settingsError }}</div>
          <div v-if="settingsNotice" class="alert success">{{ settingsNotice }}</div>
          <div class="form-inline">
            <div class="shrink">
              <label for="settings-visibility">Sichtbarkeit</label>
              <select
                id="settings-visibility"
                style="width: auto"
                :value="modelData.model.visibility"
                @change="
                  patchModel({
                    visibility: ($event.target as HTMLSelectElement)
                      .value as 'private' | 'public',
                  })
                "
              >
                <option value="private">privat</option>
                <option value="public">öffentlich</option>
              </select>
            </div>
            <div class="shrink">
              <label for="settings-default-branch">Standard-Branch</label>
              <select
                id="settings-default-branch"
                style="width: auto"
                :value="modelData.model.defaultBranch"
                @change="
                  patchModel({
                    defaultBranch: ($event.target as HTMLSelectElement).value,
                  })
                "
              >
                <option
                  v-for="branch in modelData.branches"
                  :key="branch.id"
                  :value="branch.name"
                >
                  {{ branch.name }}
                </option>
              </select>
            </div>
            <div>
              <label for="settings-folder">Ordner ("" = Wurzel)</label>
              <div class="form-inline" style="align-items: center">
                <input
                  id="settings-folder"
                  v-model="folderDraft"
                  type="text"
                  list="project-folders"
                  placeholder="z.B. Hochbau/EG"
                  style="max-width: 260px"
                />
                <datalist id="project-folders">
                  <option
                    v-for="folder in projectData?.folders ?? []"
                    :key="folder"
                    :value="folder"
                  />
                </datalist>
                <button
                  class="shrink"
                  :disabled="folderDraft === (modelData.model.folder ?? '')"
                  @click="patchModel({ folder: folderDraft ?? '' })"
                >
                  Verschieben
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="border-color: var(--danger)">
        <div class="card-header">
          <h2 style="color: var(--danger)">Gefahrenzone</h2>
        </div>
        <div class="card-body">
          <p class="muted small" style="margin-top: 0">
            Löscht „{{ modelData.model.name }}“ mit allen Branches und
            Versionsständen — unwiderruflich.
          </p>
          <button class="danger" @click="deleteModel">
            {{ isMd ? "Datei" : "Modell" }} löschen
          </button>
        </div>
      </div>
    </template>

    <!-- ================= Modal: Committen ================= -->
    <div v-if="showCommitModal" class="modal-backdrop" @click.self="showCommitModal = false">
      <div class="card modal">
        <div class="card-header">
          <h2>Neuen Stand committen</h2>
          <span class="topbar-spacer" />
          <button class="link" @click="showCommitModal = false">✕</button>
        </div>
        <div class="card-body">
          <div v-if="uploadError" class="alert error">{{ uploadError }}</div>
          <form @submit.prevent="submitCommit">
            <div class="form-row">
              <label for="commit-file">IFC-Datei</label>
              <input
                id="commit-file"
                ref="fileInput"
                type="file"
                accept=".ifc,application/x-step"
                required
                @change="onFileChange"
              />
            </div>
            <div class="form-row">
              <label for="commit-message">Commit-Nachricht</label>
              <input
                id="commit-message"
                v-model="message"
                type="text"
                placeholder="Was hat sich geändert?"
              />
            </div>
            <div class="form-inline">
              <div class="shrink">
                <label for="commit-branch">Branch</label>
                <select id="commit-branch" v-model="commitBranch" style="width: auto">
                  <option
                    v-for="branch in modelData.branches"
                    :key="branch.id"
                    :value="branch.name"
                  >
                    {{ branch.name }}
                  </option>
                  <option
                    v-if="!modelData.branches.length"
                    :value="modelData.model.defaultBranch"
                  >
                    {{ modelData.model.defaultBranch }}
                  </option>
                  <option value="__new__">neuer Branch …</option>
                </select>
              </div>
              <div v-if="commitBranch === '__new__'">
                <label for="new-branch-name">Name des neuen Branch</label>
                <input
                  id="new-branch-name"
                  v-model="newBranchName"
                  type="text"
                  placeholder="variante-a"
                />
              </div>
              <div class="shrink" style="margin-left: auto">
                <button class="primary" type="submit" :disabled="uploading || !file">
                  {{ uploading ? "Lädt hoch …" : "Committen" }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- ================= Modal: Branch anlegen ================= -->
    <div v-if="showBranchModal" class="modal-backdrop" @click.self="showBranchModal = false">
      <div class="card modal">
        <div class="card-header">
          <h2>Branch anlegen</h2>
          <span class="topbar-spacer" />
          <button class="link" @click="showBranchModal = false">✕</button>
        </div>
        <div class="card-body">
          <div v-if="branchError" class="alert error">{{ branchError }}</div>
          <form class="form-inline" @submit.prevent="createBranch">
            <div>
              <label for="branch-name">Name</label>
              <input
                id="branch-name"
                v-model="branchName"
                type="text"
                required
                placeholder="variante-a"
              />
            </div>
            <div class="shrink">
              <label for="branch-from">Ausgehend von</label>
              <select id="branch-from" v-model="branchFrom" style="width: auto">
                <option
                  v-for="branch in modelData.branches"
                  :key="branch.id"
                  :value="branch.name"
                >
                  {{ branch.name }}
                </option>
              </select>
            </div>
            <div class="shrink">
              <button class="primary" type="submit">Anlegen</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
