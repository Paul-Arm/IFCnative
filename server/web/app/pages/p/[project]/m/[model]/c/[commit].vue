<script setup lang="ts">
import {
  PhArrowLeft,
  PhArrowRight,
  PhCheck,
  PhCheckCircle,
  PhCopy,
  PhCubeTransparent,
  PhDownloadSimple,
  PhGitBranch,
  PhGitDiff,
  PhPlay,
  PhShieldCheck,
} from "@phosphor-icons/vue";

import { actionAppliesTo, type Action, type Commit, type Model } from "~/types/api";

// Breites Layout: Liste und 3D-Vergleich stehen nebeneinander.
definePageMeta({ wide: true });

/**
 * Ein Commit (Stand) eines Modells: Kopf mit Nachricht, Autor, Vorgänger,
 * Prüfstatus; darunter die Änderungen (objektzentrierter Diff mit
 * 3D-Vergleich) und die Prüfungen (Action-Runs) dieses Stands.
 */
const route = useRoute();
const router = useRouter();
const project = useProject();
const { slug, canWrite } = project;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();
const modelSlug = route.params.model as string;
const commitId = route.params.commit as string;
const base = `/projects/${slug}/models/${modelSlug}`;

const {
  data: commitData,
  status: commitStatus,
  error: commitError,
} = useAsyncData(`commit-${commitId}`, () => api<{ commit: Commit }>(`${base}/commits/${commitId}`), {
  lazy: true,
});
const commit = computed(() => commitData.value?.commit ?? null);

const { data: modelData } = useAsyncData(
  `model-${slug}-${modelSlug}`,
  () => api<{ model: Model }>(base),
  { lazy: true },
);
const model = computed(() => modelData.value?.model ?? null);

// Commit-Liste für Vergleichsbasis und Vor/Zurück — erst bei Bedarf laden.
const {
  data: commitsData,
  status: commitsStatus,
  execute: loadCommits,
} = useAsyncData(`commits-all-${slug}-${modelSlug}`, () => api<{ commits: Commit[] }>(`${base}/commits`), {
  lazy: true,
});

function ensureCommits(): void {
  if (commitsStatus.value === "idle") void loadCommits();
}

const isIfc = computed(() => {
  const schema = commit.value?.schema;
  return schema !== "markdown" && schema !== "file";
});
const isFile = computed(() => commit.value?.schema === "file");
const downloadExt = computed(() => {
  if (isIfc.value) return "ifc";
  if (!isFile.value) return "md";
  return fileExtension(model.value?.name ?? "") || "bin";
});

useHead({
  title: computed(() =>
    commit.value ? `${commit.value.message || shortSha(commitId)} · ${model.value?.name ?? modelSlug}` : "Commit",
  ),
});

/** Vergleichsbasis: ?from= oder der Vorgänger. */
const fromId = computed(
  () => (route.query.from as string | undefined) ?? commit.value?.parentCommitId ?? null,
);

function changeBase(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  void router.replace({ query: { ...route.query, from: value || undefined } });
}

/** Nachfolger auf demselben Branch (für „Nächster Stand“) — Abzweigungen zählen nicht. */
const child = computed(
  () =>
    (commitsData.value?.commits ?? []).find(
      (entry) => entry.parentCommitId === commitId && entry.branchName === commit.value?.branchName,
    ) ?? null,
);

// ---- Tabs ---------------------------------------------------------------

type Tab = "changes" | "checks";
const tab = computed<Tab>(() =>
  route.query.tab === "pruefungen" && isIfc.value ? "checks" : "changes",
);
function goTab(next: Tab): void {
  void router.replace({ query: { ...route.query, tab: next === "checks" ? "pruefungen" : undefined } });
}

// ---- Prüfungen ---------------------------------------------------------------

const { data: actionsData } = useAsyncData(
  `actions-${slug}`,
  () => api<{ actions: Action[] }>(`/projects/${slug}/actions`),
  { lazy: true },
);
const applicable = computed(() => {
  if (!model.value) return [];
  return (actionsData.value?.actions ?? []).filter((action) => actionAppliesTo(action, model.value!));
});
const runsApi = useProjectRuns(slug, () => ({ commit: commitId }));
const runs = runsApi.runs;
const check = computed(() => runsApi.checks.value.get(commitId) ?? null);

const selected = reactive(new Set<string>());
watch(
  applicable,
  (list) => {
    if (!selected.size) for (const action of list) selected.add(action.id);
  },
  { immediate: true },
);
const validating = ref(false);

async function validate(close: () => void): Promise<void> {
  if (!selected.size) return;
  validating.value = true;
  close();
  try {
    await api(`${base}/commits/${commitId}/validate`, {
      method: "POST",
      body: { actionIds: [...selected] },
    });
    await runsApi.refresh();
    goTab("checks");
    toast.success(`${selected.size} Prüfung(en) gestartet.`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    validating.value = false;
  }
}

const openRuns = reactive(new Set<string>());
function toggleRun(id: string): void {
  if (openRuns.has(id)) openRuns.delete(id);
  else openRuns.add(id);
}

// ---- Kopieren / Download ------------------------------------------------------

const copied = ref(false);
async function copyId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(commitId);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Zwischenablage nicht verfügbar
  }
}

const downloading = ref(false);
async function download(): Promise<void> {
  downloading.value = true;
  try {
    const blob = await $fetch<Blob>(`/api${base}/commits/${commitId}/file`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${modelSlug}-${shortSha(commitId)}.${downloadExt.value}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    downloading.value = false;
  }
}

onMounted(ensureCommits);
</script>

<template>
  <div class="commit-page">
    <div v-if="commitError" class="flash flash-danger">
      Commit konnte nicht geladen werden: {{ apiErrorMessage(commitError) }}
    </div>

    <!-- ============ Kopf ============ -->
    <div class="compare-bar">
      <NuxtLink :to="`/p/${slug}/m/${modelSlug}?tab=commits`" class="btn btn-sm btn-invisible">
        <PhArrowLeft :size="14" /> Verlauf von {{ model?.name ?? modelSlug }}
      </NuxtLink>
    </div>

    <div class="box commit-hero">
      <template v-if="commit">
        <div class="commit-hero-top">
          <h1 class="commit-title" :class="{ untitled: !commit.message }">
            {{ commit.message || "(ohne Nachricht)" }}
          </h1>
          <div class="commit-hero-actions">
            <NuxtLink
              v-if="isIfc"
              :to="`/p/${slug}/m/${modelSlug}?at=${commitId}`"
              class="btn"
            >
              <PhCubeTransparent :size="16" /> Stand in 3D
            </NuxtLink>
            <NuxtLink v-else :to="`/p/${slug}/m/${modelSlug}?at=${commitId}`" class="btn">
              Stand ansehen
            </NuxtLink>
            <button type="button" class="btn" :disabled="downloading" @click="download">
              <span v-if="downloading" class="spinner" />
              <PhDownloadSimple v-else :size="16" />
              .{{ downloadExt }}
            </button>
          </div>
        </div>
        <div class="commit-hero-meta">
          <UserAvatar :user="commit.author ?? null" :size="20" />
          <span class="author">{{ commit.author?.name ?? "?" }}</span>
          committete <RelTime :date="commit.createdAt" />
          <span class="meta-sep" />
          <span class="tag tag-mono"><PhGitBranch :size="12" /> {{ commit.branchName }}</span>
          <CommitStatus :check="check" :slug="slug" />
          <span class="commit-stats">
            <template v-if="commit.parentCommitId">
              <span class="hide-sm">Vorgänger</span>
              <NuxtLink :to="`/p/${slug}/m/${modelSlug}/c/${commit.parentCommitId}`" class="sha">
                {{ shortSha(commit.parentCommitId) }}
              </NuxtLink>
            </template>
            <span v-else class="muted">erster Stand</span>
            <span class="hide-sm">Commit</span>
            <button type="button" class="sha" :title="`${commitId} kopieren`" @click="copyId">
              {{ shortSha(commitId) }}
              <PhCheck v-if="copied" :size="12" class="color-success" />
              <PhCopy v-else :size="12" />
            </button>
          </span>
        </div>
      </template>
      <div v-else-if="commitStatus === 'pending' || commitStatus === 'idle'" class="commit-hero-top">
        <span class="skeleton" style="width: 45%; height: 24px" />
      </div>
    </div>

    <!-- ============ Tabs ============ -->
    <div v-if="commit" class="commit-tabs">
      <nav class="subnav">
        <button
          type="button"
          class="subnav-item"
          :class="{ active: tab === 'changes' }"
          @click="goTab('changes')"
        >
          <PhGitDiff :size="16" /> Änderungen
          <template v-if="isIfc">
            <span class="diffstat">
              <span class="add">+{{ formatNumber(commit.added) }}</span>
              <span class="mod">~{{ formatNumber(commit.modified) }}</span>
              <span class="del">−{{ formatNumber(commit.removed) }}</span>
            </span>
          </template>
        </button>
        <button
          v-if="isIfc"
          type="button"
          class="subnav-item"
          :class="{ active: tab === 'checks' }"
          @click="goTab('checks')"
        >
          <PhShieldCheck :size="16" /> Prüfungen
          <RunStatusIcon v-if="check" :status="check.status" :size="14" />
          <span v-else class="counter">{{ runs.length }}</span>
        </button>
      </nav>
      <span class="spacer" />
      <template v-if="tab === 'changes' && isIfc">
        <label for="diff-base" class="muted small nowrap">Vergleich mit</label>
        <select
          id="diff-base"
          class="auto input-sm"
          :value="fromId ?? ''"
          @focus="ensureCommits"
          @change="changeBase"
        >
          <option v-if="commit.parentCommitId" :value="commit.parentCommitId">
            Vorgänger ({{ shortSha(commit.parentCommitId) }})
          </option>
          <option v-else-if="!fromId" value="">— erster Stand —</option>
          <option v-if="fromId && fromId !== commit.parentCommitId && !commitsData" :value="fromId">
            {{ shortSha(fromId) }}
          </option>
          <option
            v-for="other in (commitsData?.commits ?? []).filter(
              (c) => c.id !== commitId && c.id !== commit!.parentCommitId,
            )"
            :key="other.id"
            :value="other.id"
          >
            {{ shortSha(other.id) }} · {{ other.branchName }} · {{ other.message || "(ohne Nachricht)" }}
          </option>
        </select>
        <NuxtLink
          v-if="child"
          :to="`/p/${slug}/m/${modelSlug}/c/${child.id}`"
          class="btn btn-sm"
          title="Nächster Stand auf diesem Branch"
        >
          Nächster <PhArrowRight :size="14" />
        </NuxtLink>
      </template>
      <UiMenu v-if="tab === 'checks' && applicable.length && canWrite" align="right" :close-on-click="false">
        <template #trigger="{ toggle }">
          <button type="button" class="btn btn-primary btn-sm" :disabled="validating" @click="toggle">
            <span v-if="validating" class="spinner" />
            <PhPlay v-else :size="14" />
            Jetzt prüfen
          </button>
        </template>
        <template #default="{ close }">
          <div class="menu-heading">Mit welchen Actions prüfen?</div>
          <label v-for="action in applicable" :key="action.id" class="menu-item" data-keep-open>
            <input
              type="checkbox"
              :checked="selected.has(action.id)"
              @change="
                ($event.target as HTMLInputElement).checked
                  ? selected.add(action.id)
                  : selected.delete(action.id)
              "
            />
            <span class="truncate" style="flex: 1">{{ action.name }}</span>
            <span class="tag tag-mono">{{ action.kind === "ids" ? "IDS" : "PY" }}</span>
          </label>
          <div style="padding: 8px 12px 4px">
            <button
              type="button"
              class="btn btn-primary btn-block btn-sm"
              :disabled="!selected.size"
              @click="validate(close)"
            >
              Prüfung starten ({{ selected.size }})
            </button>
          </div>
        </template>
      </UiMenu>
    </div>

    <!-- ============ Änderungen ============ -->
    <div v-if="tab === 'changes'" class="box">
      <SkeletonRows v-if="!commit" :rows="4" />
      <div v-else-if="!isIfc" class="box-body">
        <div class="flash" style="margin: 0">
          {{ isFile ? "Datei" : "Markdown-Datei" }} — es gibt keinen Objekt-Diff. Diesen Stand kannst du oben
          ansehen oder herunterladen.
        </div>
      </div>
      <CommitChanges
        v-else
        :key="`${commitId}:${fromId ?? ''}`"
        :base="base"
        :commit-id="commitId"
        :from-id="fromId"
        :model-name="model?.name ?? modelSlug"
      />
    </div>

    <!-- ============ Prüfungen ============ -->
    <div v-else class="box">
      <LoadingState v-if="runsApi.pending.value" text="Lade Prüfungen …" />
      <Blankslate
        v-else-if="!applicable.length && !runs.length"
        :icon="PhShieldCheck"
        title="Keine passenden Actions"
        compact
      >
        Für dieses Modell ist keine Prüfung eingerichtet.
        <template #actions>
          <NuxtLink :to="`/p/${slug}/actions`" class="btn">Actions einrichten</NuxtLink>
        </template>
      </Blankslate>
      <Blankslate v-else-if="!runs.length" :icon="PhShieldCheck" title="Noch nicht geprüft" compact>
        Starte die Prüfung oben rechts mit „Jetzt prüfen“.
      </Blankslate>
      <template v-else>
        <div v-for="run in runs" :key="run.id" class="run-item" :class="{ open: openRuns.has(run.id) }">
          <button type="button" class="run-head" @click="toggleRun(run.id)">
            <RunStatusIcon :status="run.status" :size="18" />
            <span class="run-title">
              <strong>{{ run.action?.name ?? "(gelöschte Action)" }}</strong>
              <span class="muted">#{{ run.number }}</span>
            </span>
            <span class="run-summary truncate muted">{{ run.summary || RUN_STATUS_LABEL[run.status] }}</span>
            <span class="muted small nowrap">
              <RelTime :date="run.createdAt" />
              <template v-if="runDuration(run) !== null"> · {{ formatDuration(runDuration(run)!) }}</template>
            </span>
          </button>
          <div v-if="openRuns.has(run.id)" class="run-body">
            <RunDetails
              :slug="slug"
              :run="run"
              :can-write="canWrite"
              @updated="runsApi.apply"
              @retried="() => runsApi.refresh()"
            >
              <template #actions>
                <NuxtLink
                  v-if="run.status === 'failed' || run.status === 'error'"
                  class="btn btn-sm"
                  :to="`/p/${slug}/issues/new?fromRun=${run.id}`"
                >
                  <PhCheckCircle :size="14" /> Issue aus Run erstellen
                </NuxtLink>
                <span v-if="run.failedGuids.length" class="muted small">
                  {{ run.failedGuids.length }} betroffene Objekte werden verlinkt
                </span>
              </template>
            </RunDetails>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
