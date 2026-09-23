<script setup lang="ts">
import {
  PhArrowLeft,
  PhBookOpen,
  PhCheck,
  PhClockCounterClockwise,
  PhCopy,
  PhCubeTransparent,
  PhDownloadSimple,
  PhEye,
  PhGear,
  PhGitBranch,
  PhGlobeSimple,
  PhPencilSimple,
  PhPlus,
  PhRecord,
  PhUploadSimple,
  PhWarningCircle,
} from "@phosphor-icons/vue";

import type { Branch, Commit, Issue, Model } from "~/types/api";

/**
 * Eine Datei bzw. ein Modell (GitHubs „Blob“-Ansicht): Inhalt (3D, Vorschau
 * oder Markdown), Versionsverlauf mit Branch-Graph, verknüpfte Issues und
 * Einstellungen. `?at=<commit>` zeigt einen älteren Stand.
 */
const route = useRoute();
const router = useRouter();
const project = useProject();
const { slug, detail, canWrite, isAdmin } = project;
const modelSlug = route.params.model as string;
const base = `/projects/${slug}/models/${modelSlug}`;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();
const { track } = useRecent();

const {
  data: modelData,
  refresh: refreshModel,
  error: modelError,
} = useAsyncData(
  `model-${slug}-${modelSlug}`,
  () => api<{ model: Model; branches: Branch[] }>(base),
  { lazy: true },
);
const model = computed(() => modelData.value?.model ?? null);
const branches = computed(() => modelData.value?.branches ?? []);

const isMd = computed(() => model.value?.kind === "md");
const isFile = computed(() => model.value?.kind === "file");
const isIfc = computed(() => model.value?.kind === "ifc");
const extension = computed(() => fileExtension(model.value?.name ?? ""));
const downloadExt = computed(() => (isMd.value ? "md" : isIfc.value ? "ifc" : extension.value || "bin"));

watch(
  model,
  (value) => {
    if (value) {
      track({
        type: "model",
        title: value.name,
        subtitle: `${detail.value?.project.name ?? slug}${value.folder ? ` / ${value.folder}` : ""}`,
        to: `/p/${slug}/m/${value.slug}`,
        kind: value.kind,
      });
    }
  },
  { immediate: true },
);
useHead({ title: computed(() => (model.value ? `${model.value.name} · IFC Hub` : "IFC Hub")) });

// ---- Tabs -----------------------------------------------------------------

type Tab = "view" | "commits" | "issues" | "settings";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  if (value === "commits") return "commits";
  if (value === "issues") return "issues";
  if (value === "einstellungen" || value === "settings") return "settings";
  return "view";
});

function goTab(next: Tab): void {
  const query: Record<string, string> = {};
  if (next !== "view") query.tab = next;
  if (next === "view" && typeof route.query.at === "string") query.at = route.query.at;
  void router.replace({ query });
}

const viewLabel = computed(() => (isIfc.value ? "3D" : isMd.value ? "Inhalt" : "Vorschau"));

// ---- Branch + Commits ------------------------------------------------------

const selectedBranch = ref<string | null>(null);
watch(
  model,
  (value) => {
    if (value && selectedBranch.value === null) selectedBranch.value = value.defaultBranch;
  },
  { immediate: true },
);

const {
  data: commitsData,
  refresh: refreshCommits,
  status: commitsStatus,
} = useAsyncData(
  `commits-${slug}-${modelSlug}`,
  async () => {
    if (selectedBranch.value === null) return null;
    return api<{ commits: Commit[] }>(`${base}/commits`, {
      query: selectedBranch.value ? { branch: selectedBranch.value } : {},
    });
  },
  { lazy: true, watch: [selectedBranch] },
);
const commits = computed(() => commitsData.value?.commits ?? []);

// „Alle Branches“ gibt es nur im Verlauf — die Ansicht zeigt immer einen Branch.
watch(tab, (next) => {
  if (next !== "commits" && selectedBranch.value === "" && model.value) {
    selectedBranch.value = model.value.defaultBranch;
  }
});
const commitsPending = computed(
  () =>
    commitsStatus.value === "pending" ||
    commitsStatus.value === "idle" ||
    (commitsData.value === null && commitsStatus.value !== "error"),
);

async function createBranch(name: string, from: string): Promise<void> {
  try {
    await api(`${base}/branches`, { method: "POST", body: { name, from } });
    await refreshModel();
    selectedBranch.value = name;
    toast.success(`Branch „${name}“ von „${from}“ erstellt.`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- Angezeigter Stand (?at= oder Branch-Head) -----------------------------

const atId = computed(() => (typeof route.query.at === "string" ? route.query.at : null));
const { data: atData } = useAsyncData(
  `commit-at-${slug}-${modelSlug}`,
  async () => (atId.value ? api<{ commit: Commit }>(`${base}/commits/${atId.value}`) : null),
  { lazy: true, watch: [atId] },
);
const branchHead = computed(() => commits.value[0] ?? null);
const shown = computed<Commit | null>(() => (atId.value ? (atData.value?.commit ?? null) : branchHead.value));
const isOld = computed(() => Boolean(atId.value && shown.value && shown.value.id !== branchHead.value?.id));

const { checks } = useProjectRuns(slug, () => ({ model: model.value?.id }));

// ---- Markdown ---------------------------------------------------------------

const mdText = ref<string | null>(null);
const mdHtml = ref<string | null>(null);
const editing = ref(false);
const draft = ref("");
const editMessage = ref("");
/** Branch, aus dem der bearbeitete Inhalt stammt — dorthin wird committet. */
const editBranch = ref("");
const saving = ref(false);

watch(
  () => [shown.value?.id, isMd.value] as const,
  async ([id, md], _previous, onCleanup) => {
    // Schneller ?at=-Wechsel: nur die Antwort zum aktuellen Stand übernehmen.
    let stale = false;
    onCleanup(() => (stale = true));
    mdText.value = null;
    mdHtml.value = null;
    if (!md || !id) return;
    try {
      const text = await $fetch<string>(`/api${base}/commits/${id}/file`, {
        responseType: "text",
        headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
      });
      if (stale) return;
      mdText.value = text;
      mdHtml.value = renderMarkdown(text);
    } catch {
      if (!stale) mdHtml.value = null;
    }
  },
  { immediate: true },
);

/**
 * Bearbeitet wird nur der Kopf eines konkreten Branches: Bei „Alle Branches“
 * kann der neueste Stand aus einem anderen Branch stammen, und ein älterer
 * Stand (?at=) würde den Kopf beim Committen stillschweigend zurückdrehen.
 */
const editBlockedReason = computed(() => {
  if (isOld.value) return "Älterer Stand — zum Bearbeiten zum aktuellen Stand wechseln";
  if (selectedBranch.value === "") return "Zum Bearbeiten einen Branch wählen";
  if (atId.value && !shown.value) return "Stand wird geladen …";
  return null;
});

function startEdit(): void {
  if (editBlockedReason.value) return;
  draft.value = mdText.value ?? "";
  editMessage.value = "";
  editBranch.value = shown.value?.branchName || selectedBranch.value || model.value?.defaultBranch || "";
  editing.value = true;
  goTab("view");
}

/** Inhalt geladen (oder es gibt noch keinen Stand) — erst dann bearbeitbar. */
const mdReady = computed(() => !commitsPending.value && (!shown.value || mdText.value !== null));

// ?edit=1 (nach „Markdown-Datei anlegen“ oder README-Stift)
watch(
  () => [route.query.edit, isMd.value, mdReady.value] as const,
  ([edit, md, ready]) => {
    if (!edit || !md || !ready || editing.value) return;
    startEdit();
    const { edit: _e, ...rest } = route.query;
    void router.replace({ query: rest });
  },
  { immediate: true },
);

async function saveEdit(): Promise<void> {
  saving.value = true;
  try {
    await $fetch(`/api${base}/commits`, {
      method: "POST",
      query: {
        branch: editBranch.value || model.value?.defaultBranch,
        message: editMessage.value.trim() || (mdText.value === null ? "Erstellt" : "Aktualisiert"),
      },
      body: draft.value,
      headers: {
        "content-type": "text/markdown",
        ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
      },
    });
    editing.value = false;
    await Promise.all([refreshModel(), refreshCommits(), project.refreshModels()]);
    toast.success("Änderungen committet.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

// ---- Neue Version -------------------------------------------------------------

const versionOpen = ref(false);

async function onCommitted(commit: Commit): Promise<void> {
  await Promise.all([project.refreshModels(), project.refreshStats()]);
  if (isIfc.value) {
    toast.success("Neuer Stand committet — hier sind die Änderungen.");
    await navigateTo(`/p/${slug}/m/${modelSlug}/c/${commit.id}`);
  } else {
    if (commit.branchName !== selectedBranch.value) selectedBranch.value = commit.branchName;
    await Promise.all([refreshModel(), refreshCommits()]);
    void router.replace({ query: {} });
    toast.success("Neue Version hochgeladen.");
  }
}

// ---- Download ------------------------------------------------------------------

async function download(commit: Commit | null): Promise<void> {
  if (!commit) return;
  try {
    const blob = await $fetch<Blob>(`/api${base}/commits/${commit.id}/file`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      isFile.value || isMd.value
        ? model.value!.name
        : `${modelSlug}-${shortSha(commit.id)}.${downloadExt.value}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- Issues dieses Modells -------------------------------------------------------

const { data: issuesData, status: issuesStatus } = useAsyncData(
  `issues-${slug}`,
  () => api<{ issues: Issue[]; openCount: number; closedCount: number }>(`/projects/${slug}/issues`),
  { lazy: true },
);
const modelIssues = computed(() =>
  (issuesData.value?.issues ?? []).filter((issue) => issue.models.some((m) => m.slug === modelSlug)),
);
const issueState = ref<"open" | "closed">("open");
const openIssues = computed(() => modelIssues.value.filter((issue) => issue.state === "open"));
const shownIssues = computed(() => modelIssues.value.filter((issue) => issue.state === issueState.value));

// ---- Einstellungen -----------------------------------------------------------------

const settingsName = ref("");
const settingsFolder = ref("");
const settingsBusy = ref(false);
watch(
  model,
  (value) => {
    if (value) {
      settingsName.value = value.name;
      settingsFolder.value = value.folder ?? "";
    }
  },
  { immediate: true },
);

/** Neu rendern, damit abgelehnte Select-Änderungen zurückspringen. */
const settingsKey = ref(0);

async function patchModel(patch: Record<string, string>, message = "Gespeichert."): Promise<void> {
  settingsBusy.value = true;
  try {
    await api(base, { method: "PATCH", body: patch });
    await Promise.all([refreshModel(), project.refreshModels(), project.refreshProject()]);
    toast.success(message);
  } catch (e) {
    settingsKey.value += 1;
    toast.error(apiErrorMessage(e));
  } finally {
    settingsBusy.value = false;
  }
}

async function deleteModel(): Promise<void> {
  if (!model.value) return;
  const ok = await confirm({
    title: `„${model.value.name}“ löschen?`,
    message: "Alle Branches und Versionsstände werden unwiderruflich gelöscht. Verknüpfte Issues bleiben bestehen.",
    confirmLabel: "Endgültig löschen",
    danger: true,
    typeToConfirm: model.value.name,
  });
  if (!ok) return;
  try {
    await api(base, { method: "DELETE" });
    await Promise.all([project.refreshModels(), project.refreshStats()]);
    toast.success(`„${model.value.name}“ gelöscht.`);
    await navigateTo(`/p/${slug}${model.value.folder ? `?path=${encodeURIComponent(model.value.folder)}` : ""}`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- Pfad kopieren ------------------------------------------------------------------

const crumbs = computed(() => {
  const folder = model.value?.folder ?? "";
  if (!folder) return [];
  const segments = folder.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
  }));
});

const pathCopied = ref(false);
async function copyPath(): Promise<void> {
  if (!model.value) return;
  try {
    await navigator.clipboard.writeText(`${model.value.folder ? `${model.value.folder}/` : ""}${model.value.name}`);
    pathCopied.value = true;
    setTimeout(() => (pathCopied.value = false), 1500);
  } catch {
    // Zwischenablage nicht verfügbar
  }
}
</script>

<template>
  <div v-if="modelError" class="box">
    <Blankslate :icon="PhWarningCircle" title="Datei nicht gefunden">
      {{ apiErrorMessage(modelError) }}
      <template #actions>
        <NuxtLink :to="`/p/${slug}`" class="btn">Zurück zu den Dateien</NuxtLink>
      </template>
    </Blankslate>
  </div>

  <div v-else class="model-page">
    <!-- ============ Kopf: Pfad + Werkzeuge ============ -->
    <div class="model-head">
      <nav class="crumbs model-crumbs" aria-label="Pfad">
        <NuxtLink :to="`/p/${slug}`">{{ detail?.project.name ?? slug }}</NuxtLink>
        <template v-for="crumb in crumbs" :key="crumb.path">
          <span class="sep">/</span>
          <NuxtLink :to="{ path: `/p/${slug}`, query: { path: crumb.path } }">{{ crumb.label }}</NuxtLink>
        </template>
        <span class="sep">/</span>
        <span v-if="model" class="current model-name">
          <ModelIcon :kind="model.kind" :name="model.name" :size="18" />
          {{ model.name }}
        </span>
        <span v-else class="skeleton" style="width: 160px; height: 18px" />
        <button
          v-if="model"
          type="button"
          class="btn btn-invisible btn-sm btn-icon"
          :aria-label="pathCopied ? 'Kopiert' : 'Pfad kopieren'"
          :data-tip="pathCopied ? 'Kopiert!' : 'Pfad kopieren'"
          @click="copyPath"
        >
          <PhCheck v-if="pathCopied" :size="14" class="color-success" />
          <PhCopy v-else :size="14" />
        </button>
      </nav>
      <span v-if="model?.visibility === 'public'" class="tag" title="Auch ohne Anmeldung abrufbar">
        <PhGlobeSimple :size="12" /> Öffentlich
      </span>
    </div>

    <div class="model-toolbar">
      <BranchMenu
        v-if="model"
        :model-value="selectedBranch ?? ''"
        @update:model-value="(value) => (selectedBranch = value)"
        :branches="branches"
        :default-branch="model.defaultBranch"
        :can-create="canWrite"
        :allow-all="tab === 'commits'"
        @create="createBranch"
      />
      <nav class="seg" aria-label="Ansicht">
        <button type="button" :class="{ active: tab === 'view' }" @click="goTab('view')">
          <PhCubeTransparent v-if="isIfc" :size="14" />
          <PhBookOpen v-else-if="isMd" :size="14" />
          <PhEye v-else :size="14" />
          {{ viewLabel }}
        </button>
        <button type="button" :class="{ active: tab === 'commits' }" @click="goTab('commits')">
          <PhClockCounterClockwise :size="14" />
          Verlauf
          <span v-if="commitsData" class="counter">{{ commits.length }}</span>
        </button>
        <button type="button" :class="{ active: tab === 'issues' }" @click="goTab('issues')">
          <PhRecord :size="14" />
          Issues
          <span v-if="issuesData" class="counter">{{ openIssues.length }}</span>
        </button>
        <button
          v-if="isAdmin"
          type="button"
          aria-label="Einstellungen"
          :class="{ active: tab === 'settings' }"
          @click="goTab('settings')"
        >
          <PhGear :size="14" />
          <span class="hide-sm">Einstellungen</span>
        </button>
      </nav>
      <span class="spacer" />
      <button
        type="button"
        class="btn"
        :disabled="!shown"
        :aria-label="`${downloadExt} herunterladen`"
        @click="download(shown)"
      >
        <PhDownloadSimple :size="16" />
        <span class="hide-sm">.{{ downloadExt }}</span>
      </button>
      <template v-if="canWrite && model">
        <button
          v-if="isMd"
          type="button"
          class="btn btn-primary"
          :disabled="editing || !mdReady || Boolean(editBlockedReason)"
          :title="editBlockedReason ?? undefined"
          @click="startEdit"
        >
          <PhPencilSimple :size="16" /> Bearbeiten
        </button>
        <button v-else type="button" class="btn btn-primary" @click="versionOpen = true">
          <PhUploadSimple :size="16" />
          {{ isIfc ? "Neuer Stand" : "Neue Version" }}
        </button>
      </template>
    </div>

    <!-- ============ Älterer Stand ============ -->
    <div v-if="isOld && tab === 'view'" class="flash flash-warn">
      <PhClockCounterClockwise :size="16" />
      <div class="flash-body">
        Du siehst einen älteren Stand vom <strong>{{ formatDateTime(shown!.createdAt) }}</strong>
        (<span class="mono">{{ shortSha(shown!.id) }}</span> · {{ shown!.message || "ohne Nachricht" }}).
      </div>
      <NuxtLink :to="`/p/${slug}/m/${modelSlug}`" class="btn btn-sm">
        <PhArrowLeft :size="14" /> Zum aktuellen Stand
      </NuxtLink>
    </div>

    <!-- ============ Ansicht ============ -->
    <div v-if="tab === 'view'" class="box model-view">
      <div class="box-header model-commitbar">
        <template v-if="shown">
          <UserAvatar :user="shown.author ?? null" :size="24" />
          <strong class="nowrap">{{ shown.author?.name ?? "?" }}</strong>
          <NuxtLink
            :to="isIfc ? `/p/${slug}/m/${modelSlug}/c/${shown.id}` : `/p/${slug}/m/${modelSlug}?tab=commits`"
            class="model-commitbar-msg truncate"
          >
            {{ shown.message || "(ohne Nachricht)" }}
          </NuxtLink>
          <CommitStatus :check="checks.get(shown.id)" :slug="slug" />
          <span class="spacer" />
          <span v-if="isIfc" class="muted small nowrap hide-sm">
            {{ shown.schema }} · {{ formatNumber(shown.entityCount) }} Entities
          </span>
          <NuxtLink
            :to="isIfc ? `/p/${slug}/m/${modelSlug}/c/${shown.id}` : `/p/${slug}/m/${modelSlug}?tab=commits`"
            class="sha"
          >{{ shortSha(shown.id) }}</NuxtLink>
          <span class="muted small nowrap"><RelTime :date="shown.createdAt" /></span>
        </template>
        <template v-else-if="commitsPending || !model">
          <span class="skeleton dot" />
          <span class="skeleton" style="max-width: 320px" />
        </template>
        <span v-else class="muted">Noch keine Version auf „{{ selectedBranch }}“.</span>
      </div>

      <template v-if="!model || (commitsPending && !shown)">
        <LoadingState center large text="Lade Stand …" />
      </template>
      <template v-else-if="!shown">
        <Blankslate
          :icon="isIfc ? PhCubeTransparent : PhUploadSimple"
          :title="isIfc ? 'Noch kein Stand committet' : 'Noch keine Version'"
          blueprint
        >
          {{
            isIfc
              ? "Committe die erste IFC-Datei — danach siehst du hier das Modell in 3D und bei jedem weiteren Stand, was sich geändert hat."
              : isMd
                ? "Schreibe den ersten Inhalt direkt im Browser."
                : "Lade die erste Version hoch — PDF, Word, DWG/DXF und Bilder bekommen eine Vorschau."
          }}
          <template v-if="canWrite" #actions>
            <button v-if="isMd" type="button" class="btn btn-primary" @click="startEdit">
              <PhPencilSimple :size="16" /> Inhalt schreiben
            </button>
            <button v-else type="button" class="btn btn-primary" @click="versionOpen = true">
              <PhUploadSimple :size="16" /> {{ isIfc ? "Ersten Stand committen" : "Datei hochladen" }}
            </button>
          </template>
        </Blankslate>
        <div v-if="isMd && editing" class="box-body md-edit">
          <MarkdownEditor v-model="draft" min-height="22rem" />
          <div class="md-edit-foot">
            <span class="tag" title="Ziel-Branch"><PhGitBranch :size="12" /> {{ editBranch }}</span>
            <input v-model="editMessage" type="text" placeholder="Commit-Nachricht (optional)" />
            <button type="button" class="btn" :disabled="saving" @click="editing = false">Abbrechen</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveEdit">
              <span v-if="saving" class="spinner" /> Committen
            </button>
          </div>
        </div>
      </template>

      <!-- IFC: 3D -->
      <ModelViewer
        v-else-if="isIfc"
        :key="shown.id"
        class="model-viewer"
        :sources="[{ key: shown.id, src: `/api${base}/commits/${shown.id}/fragments`, label: model.name }]"
      />

      <!-- Datei: Vorschau -->
      <FilePreview
        v-else-if="isFile"
        :key="shown.id"
        :src="`/api${base}/commits/${shown.id}/file`"
        :name="model.name"
      />

      <!-- Markdown: Inhalt / Bearbeiten -->
      <template v-else>
        <div v-if="editing" class="box-body md-edit">
          <MarkdownEditor v-model="draft" min-height="22rem" />
          <div class="md-edit-foot">
            <span class="tag" title="Ziel-Branch"><PhGitBranch :size="12" /> {{ editBranch }}</span>
            <input v-model="editMessage" type="text" placeholder="Was hat sich geändert? (optional)" />
            <button type="button" class="btn" :disabled="saving" @click="editing = false">Abbrechen</button>
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveEdit">
              <span v-if="saving" class="spinner" /> Committen
            </button>
          </div>
        </div>
        <article v-else-if="mdHtml" class="box-body markdown-body readme-body" v-html="mdHtml" />
        <LoadingState v-else center text="Lade Inhalt …" />
      </template>
    </div>

    <!-- ============ Verlauf ============ -->
    <template v-else-if="tab === 'commits'">
      <SkeletonRows v-if="commitsPending && !commits.length" class="box" :rows="5" dots />
      <CommitHistory
        v-else-if="commits.length && model"
        :commits="commits"
        :slug="slug"
        :model-slug="modelSlug"
        :default-branch="model.defaultBranch"
        :is-ifc="isIfc"
        :show-branches="selectedBranch === ''"
        :checks="checks"
        :download-ext="downloadExt"
        @download="download"
      />
      <div v-else class="box">
        <Blankslate :icon="PhClockCounterClockwise" title="Noch keine Commits" compact>
          Auf diesem Branch gibt es noch keinen Stand.
        </Blankslate>
      </div>
    </template>

    <!-- ============ Issues ============ -->
    <div v-else-if="tab === 'issues'" class="box">
      <div class="box-header">
        <div class="subnav">
          <button type="button" class="subnav-item" :class="{ active: issueState === 'open' }" @click="issueState = 'open'">
            <PhRecord :size="16" /> {{ openIssues.length }} offen
          </button>
          <button
            type="button"
            class="subnav-item"
            :class="{ active: issueState === 'closed' }"
            @click="issueState = 'closed'"
          >
            <PhCheck :size="16" /> {{ modelIssues.length - openIssues.length }} geschlossen
          </button>
        </div>
        <span class="spacer" />
        <NuxtLink
          v-if="model"
          :to="`/p/${slug}/issues/new?forModel=${model.id}`"
          class="btn btn-primary btn-sm"
        >
          <PhPlus :size="14" /> Neues Issue
        </NuxtLink>
      </div>
      <SkeletonRows v-if="issuesStatus === 'pending' && !issuesData" :rows="3" dots />
      <template v-else-if="shownIssues.length">
        <IssueRow
          v-for="issue in shownIssues"
          :key="issue.id"
          :issue="issue"
          :slug="slug"
          :model-slug="modelSlug"
        />
      </template>
      <Blankslate v-else :icon="PhRecord" :title="issueState === 'open' ? 'Keine offenen Issues' : 'Keine geschlossenen Issues'" compact>
        Issues zu diesem Modell entstehen hier oder direkt aus fehlgeschlagenen Prüfungen.
      </Blankslate>
    </div>

    <!-- ============ Einstellungen ============ -->
    <div v-else-if="tab === 'settings' && model" class="settings-stack">
      <div class="box">
        <div class="box-header"><h2 class="box-title">Allgemein</h2></div>
        <div class="box-body">
          <form class="form-group" @submit.prevent="patchModel({ name: settingsName.trim() }, 'Umbenannt.')">
            <label class="form-label" for="model-name">Name</label>
            <div class="row">
              <input id="model-name" v-model="settingsName" type="text" style="max-width: 360px" />
              <button
                type="submit"
                class="btn"
                :disabled="settingsBusy || !settingsName.trim() || settingsName.trim() === model.name"
              >
                Umbenennen
              </button>
            </div>
            <p class="form-hint">Die Adresse (<code>/m/{{ model.slug }}</code>) bleibt gleich.</p>
          </form>
          <form class="form-group" @submit.prevent="patchModel({ folder: settingsFolder.trim() }, 'Verschoben.')">
            <label class="form-label" for="model-folder">Ordner</label>
            <div class="row">
              <input
                id="model-folder"
                v-model="settingsFolder"
                type="text"
                list="model-folders"
                placeholder="leer = Projektwurzel"
                style="max-width: 360px"
              />
              <datalist id="model-folders">
                <option v-for="folder in detail?.folders ?? []" :key="folder" :value="folder" />
              </datalist>
              <button type="submit" class="btn" :disabled="settingsBusy || settingsFolder.trim() === (model.folder ?? '')">
                Verschieben
              </button>
            </div>
          </form>
          <div :key="settingsKey" class="form-row">
            <div class="shrink">
              <label class="form-label" for="model-branch">Standard-Branch</label>
              <select
                id="model-branch"
                class="auto"
                :value="model.defaultBranch"
                @change="patchModel({ defaultBranch: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="branch in branches" :key="branch.id" :value="branch.name">{{ branch.name }}</option>
              </select>
            </div>
            <div class="shrink">
              <label class="form-label" for="model-visibility">Sichtbarkeit</label>
              <select
                id="model-visibility"
                class="auto"
                :value="model.visibility"
                @change="patchModel({ visibility: ($event.target as HTMLSelectElement).value })"
              >
                <option value="private">Nur angemeldete Projektleser</option>
                <option value="public">Öffentlich (auch ohne Anmeldung)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="box box-danger">
        <div class="box-header"><h2 class="box-title">Gefahrenzone</h2></div>
        <div class="box-row danger-row">
          <div>
            <strong>{{ isIfc ? "Modell" : "Datei" }} löschen</strong>
            <p class="muted small" style="margin: 2px 0 0">
              Löscht „{{ model.name }}“ mit allen Branches und Versionsständen — unwiderruflich.
            </p>
          </div>
          <button type="button" class="btn btn-danger" @click="deleteModel">Löschen</button>
        </div>
      </div>
    </div>

    <NewVersionDialog
      v-if="model"
      v-model:open="versionOpen"
      :slug="slug"
      :model="model"
      :branches="branches"
      :branch="selectedBranch ?? model.defaultBranch"
      @committed="onCommitted"
    />
  </div>
</template>
