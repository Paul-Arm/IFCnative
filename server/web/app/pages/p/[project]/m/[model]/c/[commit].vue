<script setup lang="ts">
import {
  actionAppliesTo,
  type Action,
  type ActionRun,
  type Commit,
  type DiffOverview,
  type DiffPage,
  type EntityFieldDiff,
  type GuidChangeStatus,
  type GuidDiffEntry,
  type Model,
} from "~/types/api";

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

// Übersicht: nur Zähler je Status und IFC-Typ. Die Einträge selbst kommen
// seitenweise beim Aufklappen eines Typs (siehe loadTypePage).
const { data: diffData, status: diffStatus, error: diffError } = useAsyncData(
  `diff-${commitId}`,
  async () => {
    if (!fromId.value) return null;
    return api<{ diff: DiffOverview }>(`${base}/diff`, {
      query: { from: fromId.value, to: commitId },
    });
  },
  { lazy: true, watch: [fromId] },
);

// ---- Diff-Einträge seitenweise --------------------------------------------

const PAGE_SIZE = 200;

interface TypePage {
  entries: GuidDiffEntry[];
  total: number;
  loading: boolean;
  error: string | null;
}

const typePages = reactive(new Map<string, TypePage>());

function pageKey(status: GuidChangeStatus, type: string): string {
  return `${fromId.value}:${status}:${type}`;
}

async function loadTypePage(status: GuidChangeStatus, type: string): Promise<void> {
  if (!fromId.value) return;
  const key = pageKey(status, type);
  const existing = typePages.get(key);
  if (existing && (existing.loading || existing.entries.length >= existing.total)) {
    return;
  }
  const page: TypePage = existing ?? {
    entries: [],
    total: Number.POSITIVE_INFINITY,
    loading: false,
    error: null,
  };
  page.loading = true;
  page.error = null;
  typePages.set(key, page);
  try {
    const result = await api<{ page: DiffPage }>(`${base}/diff/entries`, {
      query: {
        from: fromId.value,
        to: commitId,
        status,
        type,
        offset: String(page.entries.length),
        limit: String(PAGE_SIZE),
      },
    });
    page.entries.push(...result.page.entries);
    page.total = result.page.total;
  } catch (e) {
    page.error = apiErrorMessage(e);
  } finally {
    page.loading = false;
  }
}

function onTypeToggle(event: Event, status: GuidChangeStatus, type: string): void {
  if ((event.target as HTMLDetailsElement).open) {
    void loadTypePage(status, type);
  }
}

// ---- Volltextfilter (serverseitig, entprellt) ------------------------------

const SEARCH_LIMIT = 300;
const filterText = ref("");
const filterActive = computed(() => filterText.value.trim().length > 0);
const search = reactive<{
  query: string;
  entries: GuidDiffEntry[];
  total: number;
  loading: boolean;
}>({ query: "", entries: [], total: 0, loading: false });

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;
watch([filterText, fromId], () => {
  clearTimeout(searchTimer);
  const query = filterText.value.trim();
  if (!query || !fromId.value) {
    search.query = "";
    search.entries = [];
    search.total = 0;
    search.loading = false;
    return;
  }
  search.loading = true;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const result = await api<{ page: DiffPage }>(`${base}/diff/entries`, {
        query: {
          from: fromId.value ?? undefined,
          to: commitId,
          q: query,
          limit: String(SEARCH_LIMIT),
        },
      });
      if (seq !== searchSeq) return;
      search.query = query;
      search.entries = result.page.entries;
      search.total = result.page.total;
    } catch {
      if (seq !== searchSeq) return;
      search.entries = [];
      search.total = 0;
    } finally {
      if (seq === searchSeq) search.loading = false;
    }
  }, 300);
});

// ---- entity field detail (lazy per entity) ----------------------------

const details = reactive(new Map<string, EntityFieldDiff | "loading">());

async function loadDetail(entry: GuidDiffEntry): Promise<void> {
  if (!fromId.value || details.has(entry.globalId)) return;
  details.set(entry.globalId, "loading");
  try {
    const result = await api<{ detail: EntityFieldDiff }>(`${base}/diff/entity`, {
      query: { from: fromId.value, to: commitId, globalId: entry.globalId },
    });
    details.set(entry.globalId, result.detail);
  } catch {
    details.delete(entry.globalId);
  }
}

function changeBase(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  details.clear();
  typePages.clear();
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
    a.download = `${modelSlug}-${commitId.slice(0, 8)}.ifc`;
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

// Run-Log wird erst beim Aufklappen geladen.
const runLogs = reactive(new Map<string, string | "loading">());

async function loadRunLog(run: ActionRun): Promise<void> {
  if (runLogs.has(run.id)) return;
  runLogs.set(run.id, "loading");
  try {
    const result = await api<{ run: ActionRun }>(
      `/projects/${slug}/runs/${run.id}`,
    );
    runLogs.set(run.id, result.run.log ?? "");
  } catch {
    runLogs.delete(run.id);
  }
}

// Solange Runs laufen, alle 3 s nachladen.
const hasPendingRuns = computed(() =>
  (runsData.value?.runs ?? []).some(
    (run) => run.status === "queued" || run.status === "running",
  ),
);
let runsTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  runsTimer = setInterval(() => {
    if (hasPendingRuns.value) {
      for (const run of runsData.value?.runs ?? []) {
        if (run.status === "queued" || run.status === "running") {
          runLogs.delete(run.id);
        }
      }
      void refreshRuns();
    }
  }, 3000);
});
onBeforeUnmount(() => {
  clearInterval(runsTimer);
  clearTimeout(searchTimer);
});

// ---- Gruppierung: Name -> Entities (innerhalb einer geladenen Seite) --------

interface NameGroup {
  name: string;
  entries: GuidDiffEntry[];
}

function groupByName(entries: GuidDiffEntry[]): NameGroup[] {
  const byName = new Map<string, GuidDiffEntry[]>();
  for (const entry of entries) {
    const key = entry.name || "(ohne Name)";
    let list = byName.get(key);
    if (!list) {
      list = [];
      byName.set(key, list);
    }
    list.push(entry);
  }
  return [...byName.entries()]
    .map(([name, nameEntries]) => ({ name, entries: nameEntries }))
    .sort(
      (a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name),
    );
}

interface Section {
  key: GuidChangeStatus;
  label: string;
  cls: string;
  count: number;
  types: { type: string; count: number }[];
}

const SECTION_META: { key: GuidChangeStatus; label: string; cls: string }[] = [
  { key: "added", label: "Neu", cls: "status-added" },
  { key: "modified", label: "Geändert", cls: "status-modified" },
  { key: "removed", label: "Entfernt", cls: "status-removed" },
];

const sections = computed<Section[]>(() => {
  const diff = diffData.value?.diff;
  if (!diff) return [];
  return SECTION_META.map((meta) => ({
    ...meta,
    count: diff[meta.key].count,
    types: diff[meta.key].types,
  })).filter((section) => section.count > 0);
});

/** Suchtreffer: Status -> Typ -> Name (aus der flachen Trefferseite). */
const searchSections = computed(() => {
  return SECTION_META.map((meta) => {
    const entries = search.entries.filter((entry) => entry.status === meta.key);
    const byType = new Map<string, GuidDiffEntry[]>();
    for (const entry of entries) {
      let list = byType.get(entry.type);
      if (!list) {
        list = [];
        byType.set(entry.type, list);
      }
      list.push(entry);
    }
    return {
      ...meta,
      count: entries.length,
      groups: [...byType.entries()]
        .map(([type, list]) => ({
          type,
          count: list.length,
          names: groupByName(list),
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    };
  }).filter((section) => section.count > 0);
});
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
      <span class="commit-id">{{ commitId.slice(0, 8) }}</span>
    </nav>

    <div v-if="commitError" class="alert error">
      Commit konnte nicht geladen werden: {{ apiErrorMessage(commitError) }}
    </div>

    <!-- ================= Kopf ================= -->
    <div class="card">
      <template v-if="commitData">
        <div class="card-header">
          <h2>{{ commitData.commit.message || "(ohne Nachricht)" }}</h2>
          <span class="topbar-spacer" />
          <button :disabled="downloadBusy" @click="download">
            <span v-if="downloadBusy" class="spinner" aria-hidden="true" />
            {{ downloadBusy ? "Wird geladen …" : ".ifc herunterladen" }}
          </button>
        </div>
        <div class="card-body">
          <div class="muted small">
            <strong>{{ commitData.commit.author?.name ?? "?" }}</strong>
            committete am
            {{ dateFmt.format(new Date(commitData.commit.createdAt)) }}
            auf Branch <span class="badge">{{ commitData.commit.branchName }}</span>
            · Schema {{ commitData.commit.schema }}
            · {{ numberFmt.format(commitData.commit.entityCount) }} Entities
          </div>
          <div style="margin-top: 0.5rem">
            <span class="diffstat">
              <span class="add">+{{ numberFmt.format(commitData.commit.added) }}</span>
              <span class="mod">~{{ numberFmt.format(commitData.commit.modified) }}</span>
              <span class="del">−{{ numberFmt.format(commitData.commit.removed) }}</span>
            </span>
          </div>
        </div>
      </template>
      <template v-else-if="commitStatus === 'pending' || commitStatus === 'idle'">
        <div class="card-header">
          <span class="skeleton" style="width: 40%; height: 1.2em" />
        </div>
        <SkeletonRows :rows="2" />
      </template>
    </div>

    <!-- ================= Prüfungen (Actions) ================= -->
    <div v-if="isIfc" class="card">
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
        v-if="!actionsReady || runsStatus === 'pending' || runsStatus === 'idle'"
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
          @toggle="(e: Event) => (e.target as HTMLDetailsElement).open && loadRunLog(run)"
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
            <p v-if="run.summary" class="small" style="margin: 0.5rem 0">
              {{ run.summary }}
            </p>
            <p
              v-if="run.status === 'failed' || run.status === 'error'"
              style="margin: 0.5rem 0"
            >
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
            </p>
            <LoadingState
              v-if="runLogs.get(run.id) === 'loading'"
              text="Lade Protokoll …"
            />
            <pre v-else-if="runLogs.get(run.id)" class="run-log">{{ runLogs.get(run.id) }}</pre>
            <div v-else class="muted small">Kein Protokoll vorhanden.</div>
          </div>
        </details>
      </div>
    </div>

    <!-- ================= Änderungen ================= -->
    <div class="card">
      <div class="card-header">
        <h2>Änderungen</h2>
        <span class="topbar-spacer" />
        <input
          v-model="filterText"
          type="search"
          placeholder="Filtern: Typ, Name oder GUID …"
          style="width: 240px"
          :disabled="!fromId"
        />
        <label for="diff-base" class="muted small" style="margin: 0">
          Vergleichsbasis:
        </label>
        <select
          id="diff-base"
          style="width: auto"
          :value="fromId ?? ''"
          :disabled="!commitData"
          @focus="ensureCommits"
          @mousedown="ensureCommits"
          @change="changeBase"
        >
          <option
            v-if="commitData?.commit.parentCommitId"
            :value="commitData.commit.parentCommitId"
          >
            Vorgänger-Commit
          </option>
          <option v-else-if="!fromId" value="">(kein Vorgänger)</option>
          <option
            v-if="fromId && fromId !== commitData?.commit.parentCommitId && !commitsData"
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

      <template v-if="!commitData">
        <SkeletonRows :rows="3" />
      </template>
      <div v-else-if="commitData.commit.schema === 'markdown'" class="card-body">
        <div class="alert" :class="diffData?.diff.identical ? 'success' : ''" style="margin: 0">
          Markdown-Datei — es gibt keinen Objekt-Diff.
          <template v-if="diffData?.diff.identical">
            Der Inhalt ist identisch mit der Vergleichsbasis.
          </template>
          <template v-else-if="fromId">Der Inhalt hat sich geändert.</template>
        </div>
      </div>
      <div v-else-if="!fromId" class="empty">
        Erster Commit dieses Modells — alle
        {{ numberFmt.format(commitData.commit.entityCount) }} Entities sind neu.
      </div>
      <LoadingState
        v-else-if="diffStatus === 'pending' || diffStatus === 'idle' || (!diffData && !diffError)"
        center
        large
        text="Diff wird berechnet …"
      >
        <span class="muted small">
          Bei großen Modellen kann das einen Moment dauern.
        </span>
      </LoadingState>
      <div v-else-if="diffError" class="card-body">
        <div class="alert error" style="margin: 0">
          Diff konnte nicht geladen werden: {{ apiErrorMessage(diffError) }}
        </div>
      </div>
      <template v-else-if="diffData">
        <div v-if="diffData.diff.identical" class="card-body">
          <div class="alert success" style="margin: 0">
            Beide Stände sind semantisch identisch (gleicher Manifest-Hash) —
            ein Re-Export ohne inhaltliche Änderung.
          </div>
        </div>

        <!-- ---- Filtermodus: Treffer vom Server ---- -->
        <template v-if="filterActive">
          <LoadingState v-if="search.loading" text="Suche …" />
          <div v-else-if="!search.entries.length" class="empty">
            Keine Treffer für „{{ search.query }}“.
          </div>
          <template v-else>
            <div class="card-body muted small" style="padding-bottom: 0">
              <template v-if="search.total > search.entries.length">
                Die ersten {{ numberFmt.format(search.entries.length) }} von
                {{ numberFmt.format(search.total) }} Treffern — Filter weiter
                eingrenzen, um alle zu sehen.
              </template>
              <template v-else>
                {{ numberFmt.format(search.total) }}
                {{ search.total === 1 ? "Treffer" : "Treffer" }}.
              </template>
            </div>
            <div v-for="section in searchSections" :key="section.key">
              <div class="card-header">
                <h3 :class="section.cls" style="margin: 0">
                  {{ section.label }} ({{ numberFmt.format(section.count) }})
                </h3>
              </div>
              <details
                v-for="group in section.groups"
                :key="group.type"
                class="tree-group"
                open
              >
                <summary>
                  <strong :class="section.cls">{{ group.type }}</strong>
                  <span class="badge">{{ numberFmt.format(group.count) }}</span>
                </summary>
                <div class="tree-children">
                  <DiffNameGroups
                    :names="group.names"
                    :status="section.key"
                    :details="details"
                    @load-detail="loadDetail"
                  />
                </div>
              </details>
            </div>
          </template>
        </template>

        <!-- ---- Normalmodus: Status -> Typ (Zähler), Einträge beim Aufklappen ---- -->
        <template v-else>
          <div v-for="section in sections" :key="section.key">
            <div class="card-header">
              <h3 :class="section.cls" style="margin: 0">
                {{ section.label }} ({{ numberFmt.format(section.count) }})
              </h3>
            </div>
            <details
              v-for="group in section.types"
              :key="group.type"
              class="tree-group"
              @toggle="onTypeToggle($event, section.key, group.type)"
            >
              <summary>
                <strong :class="section.cls">{{ group.type }}</strong>
                <span class="badge">{{ numberFmt.format(group.count) }}</span>
              </summary>
              <div class="tree-children">
                <template v-if="typePages.get(pageKey(section.key, group.type)) as TypePage | undefined">
                  <DiffNameGroups
                    :names="groupByName(typePages.get(pageKey(section.key, group.type))!.entries)"
                    :status="section.key"
                    :details="details"
                    @load-detail="loadDetail"
                  />
                  <div
                    v-if="typePages.get(pageKey(section.key, group.type))!.error"
                    class="alert error"
                    style="margin: 0.5rem 0"
                  >
                    {{ typePages.get(pageKey(section.key, group.type))!.error }}
                  </div>
                  <LoadingState
                    v-if="typePages.get(pageKey(section.key, group.type))!.loading"
                    text="Lade Einträge …"
                  />
                  <p
                    v-else-if="typePages.get(pageKey(section.key, group.type))!.entries.length < group.count"
                    style="margin: 0.5rem 0"
                  >
                    <button
                      class="btn small"
                      @click="loadTypePage(section.key, group.type)"
                    >
                      Weitere laden
                      ({{ numberFmt.format(typePages.get(pageKey(section.key, group.type))!.entries.length) }}
                      von {{ numberFmt.format(group.count) }})
                    </button>
                  </p>
                </template>
                <LoadingState v-else text="Lade Einträge …" />
              </div>
            </details>
          </div>
        </template>

        <div
          v-if="!sections.length && !diffData.diff.identical"
          class="empty"
        >
          Keine Unterschiede zwischen den gewählten Ständen.
        </div>
        <div class="card-body muted small">
          {{ numberFmt.format(diffData.diff.unchanged) }} Entities unverändert.
        </div>
      </template>
    </div>
  </div>
</template>
