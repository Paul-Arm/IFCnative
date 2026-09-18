<script setup lang="ts">
import {
  PhCheckCircle,
  PhCopy,
  PhDownloadSimple,
  PhGitCommit,
  PhGitDiff,
} from "@phosphor-icons/vue";

import {
  actionAppliesTo,
  type Action,
  type ActionRun,
  type Commit,
  type Model,
  type Role,
} from "~/types/api";

// Breites Layout: Liste und 3D-Vergleich stehen nebeneinander.
definePageMeta({ wide: true });

const route = useRoute();
const router = useRouter();
const { api } = useApi();
const { token } = useAuth();
const slug = route.params.project as string;
const modelSlug = route.params.model as string;
const commitId = route.params.commit as string;
const base = `/projects/${slug}/models/${modelSlug}`;

// Alle Daten laden "lazy": Die Seite rendert sofort mit Platzhaltern und
// füllt sich, sobald die einzelnen Antworten eintreffen — statt bis zur
// langsamsten Antwort (Diff großer Modelle) komplett leer zu bleiben.
const {
  data: commitData,
  status: commitStatus,
  error: commitError,
} = useAsyncData(
  `commit-${commitId}`,
  () => api<{ commit: Commit }>(`${base}/commits/${commitId}`),
  { lazy: true },
);

// Commit-Liste nur für die Vergleichsbasis-Auswahl — erst beim Öffnen laden.
const {
  data: commitsData,
  status: commitsStatus,
  execute: loadCommits,
} = useAsyncData(
  `commits-all-${slug}-${modelSlug}`,
  () => api<{ commits: Commit[] }>(`${base}/commits`),
  { lazy: true, immediate: false },
);

function ensureCommits(): void {
  if (commitsStatus.value === "idle") {
    void loadCommits();
  }
}

/** Base of the shown diff: ?from= override, else the parent commit. */
const fromId = computed(
  () =>
    (route.query.from as string | undefined) ??
    commitData.value?.commit.parentCommitId ??
    null,
);

function changeBase(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  router.replace({ query: value ? { from: value } : {} });
}

const downloadBusy = ref(false);
async function download(): Promise<void> {
  downloadBusy.value = true;
  try {
    const blob = await $fetch<Blob>(`/api${base}/commits/${commitId}/file`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${modelSlug}-${commitId.slice(0, 8)}.${isIfc.value ? "ifc" : "md"}`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    downloadBusy.value = false;
  }
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "long",
  timeStyle: "short",
});
const numberFmt = new Intl.NumberFormat("de-DE");

// ---- Prüfungen (Actions) ----------------------------------------------

const isIfc = computed(() => commitData.value?.commit.schema !== "markdown");

const { data: actionsData } = useAsyncData(
  `actions-${slug}`,
  () => api<{ actions: Action[] }>(`/projects/${slug}/actions`),
  { lazy: true },
);
const { data: modelData } = useAsyncData(
  `model-${slug}-${modelSlug}`,
  () => api<{ model: Model }>(base),
  { lazy: true },
);
// Rolle im Projekt — nur Schreibende dürfen Runs abbrechen/wiederholen.
const { data: projectRole } = useAsyncData(
  `project-role-${slug}`,
  () => api<{ role: Role | null }>(`/projects/${slug}`),
  { lazy: true },
);
const canWrite = computed(() =>
  ["owner", "maintainer", "contributor"].includes(projectRole.value?.role ?? ""),
);

/** Nur Actions, deren Geltungsbereich dieses Modell abdeckt. */
const applicableActions = computed(() => {
  const model = modelData.value?.model;
  if (!model) return [];
  return (actionsData.value?.actions ?? []).filter((action) =>
    actionAppliesTo(action, model),
  );
});
const actionCount = computed(() => applicableActions.value.length);
const actionsReady = computed(
  () => !!modelData.value && !!actionsData.value,
);
const {
  data: runsData,
  status: runsStatus,
  refresh: refreshRuns,
} = useAsyncData(
  `runs-${commitId}`,
  () => api<{ runs: ActionRun[] }>(`/projects/${slug}/runs`, {
    query: { commit: commitId },
  }),
  { lazy: true },
);

const RUN_STATUS: Record<
  ActionRun["status"],
  { label: string; cls: string }
> = {
  queued: { label: "Wartet", cls: "" },
  running: { label: "Läuft …", cls: "accent" },
  success: { label: "Bestanden", cls: "success" },
  failed: { label: "Fehlgeschlagen", cls: "danger" },
  error: { label: "Fehler", cls: "warn" },
  cancelled: { label: "Abgebrochen", cls: "" },
};

const validateBusy = ref(false);
const validateError = ref<string | null>(null);

// Auswahl, WELCHE Actions laufen sollen (Standard: alle).
const selectedActions = reactive(new Set<string>());
watch(
  applicableActions,
  (actions) => {
    if (!selectedActions.size) {
      for (const action of actions) {
        selectedActions.add(action.id);
      }
    }
  },
  { immediate: true },
);
const validateMenu = ref<HTMLDetailsElement | null>(null);

function toggleAction(id: string, on: boolean): void {
  if (on) {
    selectedActions.add(id);
  } else {
    selectedActions.delete(id);
  }
}

async function validateCommit(): Promise<void> {
  if (!selectedActions.size) return;
  validateError.value = null;
  validateBusy.value = true;
  if (validateMenu.value) {
    validateMenu.value.open = false;
  }
  try {
    await api(`${base}/commits/${commitId}/validate`, {
      method: "POST",
      body: { actionIds: [...selectedActions] },
    });
    await refreshRuns();
  } catch (e) {
    validateError.value = apiErrorMessage(e);
  } finally {
    validateBusy.value = false;
  }
}

// Run-Details (Protokoll, Live-Stream, Abbrechen) erst beim Aufklappen mounten.
const openRuns = reactive(new Set<string>());

function onRunToggle(event: Event, run: ActionRun): void {
  if ((event.target as HTMLDetailsElement).open) {
    openRuns.add(run.id);
  } else {
    openRuns.delete(run.id);
  }
}

/** Statuswechsel aus dem Live-Stream direkt in die Liste übernehmen. */
function applyRunUpdate(updated: ActionRun): void {
  const current = runsData.value?.runs.find((run) => run.id === updated.id);
  if (current) {
    Object.assign(current, updated);
  }
}

async function onRunRetried(): Promise<void> {
  await refreshRuns();
}

// Solange Runs laufen, alle 3 s nachladen (Fallback zum Live-Stream).
const hasPendingRuns = computed(() =>
  (runsData.value?.runs ?? []).some(
    (run) => run.status === "queued" || run.status === "running",
  ),
);
let runsTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  runsTimer = setInterval(() => {
    if (hasPendingRuns.value) {
      void refreshRuns();
    }
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(runsTimer);
});

// ---- Tabs -----------------------------------------------------------------

type Tab = "aenderungen" | "pruefungen";
const tab = computed<Tab>(() =>
  route.query.tab === "pruefungen" && isIfc.value ? "pruefungen" : "aenderungen",
);
function goTab(next: Tab): void {
  router.replace({
    query: { ...route.query, tab: next === "aenderungen" ? undefined : next },
  });
}

/** Schlechtester Status der jüngsten Runs je Action — Punkt am Tab. */
const runsBadge = computed<{ cls: string; label: string } | null>(() => {
  const runs = runsData.value?.runs ?? [];
  if (!runs.length) return null;
  const latest = new Map<string, ActionRun>();
  for (const run of runs) {
    const known = latest.get(run.actionId);
    if (!known || known.number < run.number) latest.set(run.actionId, run);
  }
  const states = [...latest.values()].map((run) => run.status);
  if (states.some((state) => state === "running" || state === "queued")) {
    return { cls: "accent", label: "läuft" };
  }
  if (states.some((state) => state === "failed")) {
    return { cls: "danger", label: "fehlgeschlagen" };
  }
  if (states.some((state) => state === "error")) {
    return { cls: "warn", label: "Fehler" };
  }
  if (states.every((state) => state === "success")) {
    return { cls: "success", label: "bestanden" };
  }
  return null;
});

const idCopied = ref(false);
async function copyCommitId(): Promise<void> {
  try {
    await navigator.clipboard.writeText(commitId);
    idCopied.value = true;
    setTimeout(() => (idCopied.value = false), 1500);
  } catch {
    // Zwischenablage nicht verfügbar
  }
}

function initials(name: string | undefined): string {
  return (name ?? "?")
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
</script>

<template>
  <div>
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">{{ slug }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}/m/${modelSlug}`">{{ modelSlug }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}/m/${modelSlug}?tab=commits`">Commits</NuxtLink>
      <span>/</span>
      <span class="commit-id">{{ commitId.slice(0, 8) }}</span>
    </nav>

    <div v-if="commitError" class="alert error">
      Commit konnte nicht geladen werden: {{ apiErrorMessage(commitError) }}
    </div>

    <!-- ================= Kopf ================= -->
    <header class="commit-head">
      <template v-if="commitData">
        <div class="commit-head-main">
          <h1 class="commit-title">
            <PhGitCommit :size="22" aria-hidden="true" />
            {{ commitData.commit.message || "(ohne Nachricht)" }}
          </h1>
          <div class="commit-meta">
            <span class="avatar" aria-hidden="true">{{
              initials(commitData.commit.author?.name)
            }}</span>
            <strong>{{ commitData.commit.author?.name ?? "?" }}</strong>
            <span class="muted">
              am {{ dateFmt.format(new Date(commitData.commit.createdAt)) }}
            </span>
            <span class="badge">{{ commitData.commit.branchName }}</span>
            <button
              class="commit-id commit-id-copy"
              type="button"
              title="Commit-Id kopieren"
              @click="copyCommitId"
            >
              {{ commitId.slice(0, 8) }}
              <PhCheckCircle v-if="idCopied" :size="13" aria-hidden="true" />
              <PhCopy v-else :size="13" aria-hidden="true" />
            </button>
            <span v-if="isIfc" class="muted small">
              {{ commitData.commit.schema }} ·
              {{ numberFmt.format(commitData.commit.entityCount) }} Entities
            </span>
          </div>
        </div>
        <div class="commit-head-actions">
          <div class="compare-select">
            <label for="diff-base" class="muted small">
              <PhGitDiff :size="14" aria-hidden="true" />
              Vergleichen mit
            </label>
            <select
              id="diff-base"
              :value="fromId ?? ''"
              @focus="ensureCommits"
              @mousedown="ensureCommits"
              @change="changeBase"
            >
              <option
                v-if="commitData.commit.parentCommitId"
                :value="commitData.commit.parentCommitId"
              >
                Vorgänger-Commit
              </option>
              <option v-else-if="!fromId" value="">(kein Vorgänger)</option>
              <option
                v-if="fromId && fromId !== commitData.commit.parentCommitId && !commitsData"
                :value="fromId"
              >
                {{ fromId.slice(0, 8) }}
              </option>
              <option v-if="commitsStatus === 'pending'" disabled value="__loading">
                Lade Commits …
              </option>
              <option
                v-for="other in (commitsData?.commits ?? []).filter((c) => c.id !== commitId && c.id !== commitData?.commit.parentCommitId)"
                :key="other.id"
                :value="other.id"
              >
                {{ other.id.slice(0, 8) }} · {{ other.message || "(ohne Nachricht)" }}
              </option>
            </select>
          </div>
          <button :disabled="downloadBusy" @click="download">
            <span v-if="downloadBusy" class="spinner" aria-hidden="true" />
            <PhDownloadSimple v-else :size="15" aria-hidden="true" />
            {{ downloadBusy ? "Wird geladen …" : isIfc ? ".ifc" : ".md" }}
          </button>
        </div>
      </template>
      <template v-else-if="commitStatus === 'pending' || commitStatus === 'idle'">
        <div class="commit-head-main">
          <span class="skeleton" style="width: 45%; height: 1.6em" />
          <span class="skeleton" style="width: 30%; height: 1em; margin-top: 0.6rem" />
        </div>
      </template>
    </header>

    <nav v-if="isIfc && commitData" class="gh-tabs">
      <button :class="{ active: tab === 'aenderungen' }" @click="goTab('aenderungen')">
        <PhGitDiff :size="16" aria-hidden="true" />
        Änderungen
      </button>
      <button :class="{ active: tab === 'pruefungen' }" @click="goTab('pruefungen')">
        <PhCheckCircle :size="16" aria-hidden="true" />
        Prüfungen
        <span v-if="runsBadge" class="badge" :class="runsBadge.cls">
          {{ runsBadge.label }}
        </span>
        <span v-else-if="runsData" class="counter">{{ runsData.runs.length }}</span>
      </button>
    </nav>

    <!-- ================= Prüfungen (Actions) ================= -->
    <div v-if="isIfc && tab === 'pruefungen'" class="card">
      <div class="card-header">
        <h2>Prüfungen</h2>
        <span v-if="hasPendingRuns" class="badge accent">läuft …</span>
        <span class="topbar-spacer" />
        <details v-if="actionCount" ref="validateMenu" class="menu">
          <summary class="btn primary">
            {{ validateBusy ? "Wird gestartet …" : "Jetzt prüfen" }}
          </summary>
          <div class="menu-list validate-menu">
            <p class="muted small" style="margin: 0 0 0.25rem">
              Mit welchen Actions prüfen?
            </p>
            <label
              v-for="action in applicableActions"
              :key="action.id"
              class="pv-item"
            >
              <input
                type="checkbox"
                :checked="selectedActions.has(action.id)"
                @change="
                  toggleAction(
                    action.id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span class="pv-label">{{ action.name }}</span>
              <span class="badge" :class="action.kind === 'ids' ? 'accent' : ''">
                {{ action.kind === "ids" ? "IDS" : "Python" }}
              </span>
            </label>
            <button
              class="primary"
              style="margin-top: 0.5rem; width: 100%"
              :disabled="validateBusy || !selectedActions.size"
              @click="validateCommit"
            >
              Prüfung starten ({{ selectedActions.size }})
            </button>
          </div>
        </details>
      </div>
      <div v-if="validateError" class="card-body">
        <div class="alert error" style="margin: 0">{{ validateError }}</div>
      </div>
      <LoadingState
        v-if="!actionsReady || ((runsStatus === 'pending' || runsStatus === 'idle') && !runsData)"
        text="Lade Prüfungen …"
      />
      <div v-else-if="!actionCount" class="empty">
        Keine Actions mit passendem Geltungsbereich für dieses Modell —
        <NuxtLink :to="`/p/${slug}?tab=actions`">im Tab „Actions"</NuxtLink>
        eine anlegen (alle Modelle, Ordner oder dieses Modell).
      </div>
      <div v-else-if="!runsData?.runs.length" class="empty">
        Dieser Commit wurde noch nicht geprüft.
      </div>
      <div v-else>
        <details
          v-for="run in runsData.runs"
          :key="run.id"
          class="tree-group"
          @toggle="onRunToggle($event, run)"
        >
          <summary>
            <span class="muted small">#{{ run.number }}</span>
            <span class="badge" :class="RUN_STATUS[run.status].cls">
              <span
                v-if="run.status === 'running' || run.status === 'queued'"
                class="spinner"
                aria-hidden="true"
              />
              {{ RUN_STATUS[run.status].label }}
            </span>
            <strong>{{ run.action?.name ?? "(gelöschte Action)" }}</strong>
            <span class="muted small">
              {{ dateFmt.format(new Date(run.createdAt)) }}
              <template v-if="run.triggeredBy">
                · {{ run.triggeredBy.name }}
              </template>
            </span>
          </summary>
          <div class="tree-children">
            <RunDetails
              v-if="openRuns.has(run.id)"
              :slug="slug"
              :run="run"
              :can-write="canWrite"
              @updated="applyRunUpdate"
              @retried="onRunRetried"
            >
              <template #actions>
                <template v-if="run.status === 'failed' || run.status === 'error'">
                  <NuxtLink
                    class="btn small"
                    :to="`/p/${slug}?tab=issues&fromRun=${run.id}`"
                    title="Issue mit Prüfbericht, Modell-Verknüpfung und den GUIDs der Verstöße anlegen"
                  >
                    Issue aus Run erstellen
                  </NuxtLink>
                  <span v-if="run.failedGuids.length" class="muted small">
                    {{ run.failedGuids.length }} betroffene Objekte werden verlinkt
                  </span>
                </template>
              </template>
            </RunDetails>
          </div>
        </details>
      </div>
    </div>

    <!-- ================= Änderungen ================= -->
    <div v-if="tab === 'aenderungen'" class="card">
      <SkeletonRows v-if="!commitData" :rows="4" />
      <div v-else-if="!isIfc" class="card-body">
        <div class="alert" style="margin: 0">
          Markdown-Datei — es gibt keinen Objekt-Diff. Der Inhalt dieses Stands
          lässt sich oben herunterladen.
        </div>
      </div>
      <CommitChanges
        v-else
        :key="`${commitId}:${fromId ?? ''}`"
        :base="base"
        :commit-id="commitId"
        :from-id="fromId"
        :model-name="modelData?.model.name ?? modelSlug"
      />
    </div>
  </div>
</template>
