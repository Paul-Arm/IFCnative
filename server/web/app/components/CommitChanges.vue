<script setup lang="ts">
import {
  PhArrowsOutCardinal,
  PhCube,
  PhCubeTransparent,
  PhListBullets,
  PhMagnifyingGlass,
  PhTag,
  PhTreeStructure,
  PhX,
} from "@phosphor-icons/vue";

import type {
  ChangeFacet,
  ChangeItem,
  ChangesGuids,
  ChangesOverview,
  ChangesPage,
  GuidChangeStatus,
  ObjectChangeDetail,
  ObjectFieldChange,
} from "~/types/api";

interface ViewerPick {
  globalId: string;
  name: string;
  category: string;
}

/**
 * Die "Änderungen" eines Commits: Übersicht -> Filter -> Liste mit konkreten
 * Vorher/Nachher-Werten, optional daneben der 3D-Vergleich (neu = grün,
 * geändert = gelb, entfernt = rot; Unverändertes abgeblendet).
 *
 * Alles kommt seitenweise aus dem Objekt-Index des Servers — auch bei
 * 100k+ Objekten wird nie der ganze Diff geladen oder gerendert.
 */
const props = defineProps<{
  /** API-Basis des Modells: /projects/:slug/models/:model */
  base: string;
  commitId: string;
  /** Vergleichsbasis; null = erster Stand (alles neu). */
  fromId: string | null;
  modelName: string;
}>();

const { api } = useApi();
const numberFmt = new Intl.NumberFormat("de-DE");

const FACETS: { key: ChangeFacet; label: string; icon: unknown }[] = [
  { key: "attributes", label: "Attribute", icon: PhTag },
  { key: "properties", label: "Eigenschaften", icon: PhListBullets },
  { key: "placement", label: "Lage", icon: PhArrowsOutCardinal },
  { key: "geometry", label: "Geometrie", icon: PhCube },
  { key: "relations", label: "Beziehungen", icon: PhTreeStructure },
];
const FACET_LABELS = Object.fromEntries(
  FACETS.map((facet) => [facet.key, facet.label]),
) as Record<ChangeFacet, string>;

const STATUSES: { key: GuidChangeStatus; label: string }[] = [
  { key: "modified", label: "Geändert" },
  { key: "added", label: "Neu" },
  { key: "removed", label: "Entfernt" },
];

// ---- Übersicht ---------------------------------------------------------

const range = computed(() => ({
  from: props.fromId ?? undefined,
  to: props.commitId,
}));

const {
  data: overviewData,
  status: overviewStatus,
  error: overviewError,
} = useAsyncData(
  `changes-${props.commitId}-${props.fromId ?? ""}`,
  () => api<{ changes: ChangesOverview }>(`${props.base}/changes`, { query: range.value }),
  { lazy: true, watch: [() => props.fromId] },
);
const overview = computed(() => overviewData.value?.changes ?? null);
const changedTotal = computed(() =>
  overview.value
    ? overview.value.added.count +
      overview.value.modified.count +
      overview.value.removed.count
    : 0,
);

/** Anteile für den Balken (mind. 1,5 %, damit kleine Anteile sichtbar sind). */
const bar = computed(() => {
  const o = overview.value;
  if (!o) return [];
  const total = changedTotal.value + o.unchanged;
  if (!total) return [];
  return [
    { key: "modified", count: o.modified.count },
    { key: "added", count: o.added.count },
    { key: "removed", count: o.removed.count },
    { key: "unchanged", count: o.unchanged },
  ]
    .filter((part) => part.count > 0)
    .map((part) => ({
      ...part,
      width: Math.max(1.5, (part.count / total) * 100),
    }));
});

// ---- Filter ------------------------------------------------------------

const status = ref<GuidChangeStatus | null>(null);
const facet = ref<ChangeFacet | null>(null);
const type = ref("");
/** undefined = alle; "" = ohne räumliche Zuordnung. */
const container = ref<string | undefined>(undefined);
const searchText = ref("");
const search = ref("");

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchText, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => (search.value = value.trim()), 250);
});

const hasFilter = computed(
  () =>
    status.value !== null ||
    facet.value !== null ||
    type.value !== "" ||
    container.value !== undefined ||
    search.value !== "",
);

function resetFilters(): void {
  status.value = null;
  facet.value = null;
  type.value = "";
  container.value = undefined;
  searchText.value = "";
  search.value = "";
}

function toggleStatus(key: GuidChangeStatus): void {
  status.value = status.value === key ? null : key;
  if (status.value && status.value !== "modified") facet.value = null;
}

function toggleFacet(key: ChangeFacet): void {
  facet.value = facet.value === key ? null : key;
  // Facetten gibt es nur an geänderten Objekten.
  if (facet.value && status.value && status.value !== "modified") {
    status.value = null;
  }
}

/** Typen passend zum gewählten Status, mit Anzahl. */
const typeOptions = computed(() => {
  const o = overview.value;
  if (!o) return [];
  const counts = new Map<string, number>();
  for (const key of ["modified", "added", "removed"] as const) {
    if (status.value && status.value !== key) continue;
    for (const entry of o[key].types) {
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + entry.count);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});

const filterQuery = computed(() => ({
  ...range.value,
  status: status.value ?? undefined,
  facet: facet.value ?? undefined,
  type: type.value || undefined,
  container: container.value,
  q: search.value || undefined,
}));

// ---- Liste (seitenweise, lädt beim Scrollen nach) ----------------------

const PAGE_SIZE = 50;
const items = ref<ChangeItem[]>([]);
const total = ref(0);
const listLoading = ref(false);
const listError = ref<string | null>(null);
let listSeq = 0;

async function loadPage(reset: boolean): Promise<void> {
  if (!overview.value) return;
  const seq = reset ? ++listSeq : listSeq;
  if (!reset && (listLoading.value || items.value.length >= total.value)) return;
  listLoading.value = true;
  listError.value = null;
  try {
    const result = await api<{ page: ChangesPage }>(`${props.base}/changes/items`, {
      query: {
        ...filterQuery.value,
        offset: String(reset ? 0 : items.value.length),
        limit: String(PAGE_SIZE),
      },
    });
    if (seq !== listSeq) return;
    items.value = reset
      ? result.page.items
      : [...items.value, ...result.page.items];
    total.value = result.page.total;
  } catch (e) {
    if (seq !== listSeq) return;
    listError.value = apiErrorMessage(e);
  } finally {
    if (seq === listSeq) listLoading.value = false;
  }
}

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadPage(false);
      }
    },
    { rootMargin: "400px" },
  );
  watch(
    sentinel,
    (element, previous) => {
      if (previous) observer?.unobserve(previous);
      if (element) observer?.observe(element);
    },
    { immediate: true },
  );
});
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(searchTimer);
  clearTimeout(colorTimer);
});

// ---- Aufklappen: vollständige Feldliste --------------------------------

const expanded = reactive(new Set<string>());
const details = reactive(
  new Map<string, ObjectFieldChange[] | "loading" | "error">(),
);

watch(
  () => props.fromId,
  () => details.clear(),
);

// immediate: Die Übersicht kann beim Zurücknavigieren schon im Cache liegen.
watch(
  [overview, filterQuery],
  () => {
    expanded.clear();
    void loadPage(true);
  },
  { immediate: true },
);

async function toggleItem(item: ChangeItem): Promise<void> {
  if (expanded.has(item.globalId)) {
    expanded.delete(item.globalId);
    return;
  }
  expanded.add(item.globalId);
  if (Array.isArray(details.get(item.globalId))) return;
  details.set(item.globalId, "loading");
  try {
    const result = await api<{ detail: ObjectChangeDetail }>(
      `${props.base}/changes/item`,
      { query: { ...range.value, globalId: item.globalId } },
    );
    details.set(item.globalId, result.detail.changes);
  } catch {
    details.set(item.globalId, "error");
  }
}

// ---- 3D-Vergleich --------------------------------------------------------

const SHOW_3D_KEY = "ifc-hub:changes-3d";
const show3d = ref(false);
onMounted(() => {
  try {
    show3d.value = localStorage.getItem(SHOW_3D_KEY) === "1";
  } catch {
    // Ohne localStorage bleibt der 3D-Vergleich zunächst zu.
  }
});
function toggle3d(): void {
  show3d.value = !show3d.value;
  viewerReady.value = false;
  try {
    localStorage.setItem(SHOW_3D_KEY, show3d.value ? "1" : "0");
  } catch {
    // nur Komfort
  }
}

interface ViewerApi {
  colorize(
    groups: { id: string; color: number; guids: string[] }[],
    dim?: boolean,
  ): Promise<Record<string, number>>;
  focusGuids(guids: string[]): Promise<number>;
  fitToColored(): Promise<void>;
  addSource(
    source: { key: string; src: string; label?: string },
    onlyGuids?: string[],
  ): Promise<boolean>;
}
const viewer = ref<ViewerApi | null>(null);
const viewerReady = ref(false);
const dimRest = ref(true);
const found3d = ref<Record<string, number> | null>(null);
const guidsTruncated = ref(false);
const locatedId = ref<string | null>(null);
const locateNote = ref<string | null>(null);
let removedLoaded = false;
let colorTimer: ReturnType<typeof setTimeout> | undefined;
let colorSeq = 0;

const COLORS = { added: 0x2da44e, modified: 0xe3a008, removed: 0xe5484d };

async function applyColors(zoom: boolean): Promise<void> {
  const api3d = viewer.value;
  if (!api3d || !viewerReady.value || !props.fromId) return;
  const seq = ++colorSeq;
  try {
    const { guids } = await api<{ guids: ChangesGuids }>(
      `${props.base}/changes/guids`,
      { query: filterQuery.value },
    );
    if (seq !== colorSeq) return;
    guidsTruncated.value = guids.truncated;
    // Entfernte Objekte gibt es nur im alten Stand: der wird einmalig
    // nachgeladen und bis auf genau diese Objekte ausgeblendet.
    if (!removedLoaded && guids.removed.length) {
      removedLoaded = true;
      const all = hasFilter.value
        ? (
            await api<{ guids: ChangesGuids }>(`${props.base}/changes/guids`, {
              query: range.value,
            })
          ).guids.removed
        : guids.removed;
      await api3d.addSource(
        {
          key: props.fromId,
          src: `/api${props.base}/commits/${props.fromId}/fragments`,
          label: "Vorheriger Stand",
        },
        all,
      );
      if (seq !== colorSeq) return;
    }
    found3d.value = await api3d.colorize(
      [
        { id: "modified", color: COLORS.modified, guids: guids.modified },
        { id: "added", color: COLORS.added, guids: guids.added },
        { id: "removed", color: COLORS.removed, guids: guids.removed },
      ],
      dimRest.value,
    );
    if (zoom) await api3d.fitToColored();
  } catch {
    // Der 3D-Vergleich ist Zusatz — die Liste bleibt maßgeblich.
  }
}

function onViewerReady(): void {
  viewerReady.value = true;
  removedLoaded = false;
  void applyColors(true);
}

watch([filterQuery, dimRest], () => {
  clearTimeout(colorTimer);
  colorTimer = setTimeout(() => void applyColors(false), 300);
});

async function locate(item: ChangeItem): Promise<void> {
  locateNote.value = null;
  locatedId.value = item.globalId;
  const count = (await viewer.value?.focusGuids([item.globalId])) ?? 0;
  if (!count) {
    locateNote.value = `„${item.name || item.type}“ hat in diesem Stand keine 3D-Geometrie.`;
  }
}

/** Klick im 3D: die Liste zeigt genau dieses Objekt und seine Änderungen. */
function onViewerSelect(pick: ViewerPick | null): void {
  if (pick?.globalId) {
    searchText.value = pick.globalId;
  }
}
</script>

<template>
  <div class="chg">
    <LoadingState
      v-if="(overviewStatus === 'pending' || overviewStatus === 'idle') && !overview"
      center
      large
      text="Änderungen werden ermittelt …"
    >
      <span class="muted small">
        Ältere Stände werden beim ersten Vergleich einmalig indiziert — danach
        ist der Diff sofort da.
      </span>
    </LoadingState>
    <div v-else-if="overviewError && !overview" class="card-body">
      <div class="alert error" style="margin: 0">
        Änderungen konnten nicht geladen werden:
        {{ apiErrorMessage(overviewError) }}
      </div>
    </div>

    <template v-else-if="overview">
      <!-- ---- Zusammenfassung ---- -->
      <div class="chg-summary">
        <div v-if="overview.identical" class="alert success" style="margin: 0">
          Beide Stände sind inhaltlich identisch — ein Re-Export ohne Änderung.
        </div>
        <div v-else-if="!changedTotal" class="alert" style="margin: 0">
          Keine Änderungen an Objekten. Die Dateien unterscheiden sich nur
          technisch (z. B. Zeitstempel oder Entity-Nummerierung).
        </div>
        <template v-else>
          <p v-if="!fromId" class="muted small" style="margin: 0 0 0.6rem">
            Erster Stand dieses Modells — alle Objekte sind neu.
          </p>
          <div class="chg-statline">
            <span class="chg-total">
              <strong>{{ numberFmt.format(changedTotal) }}</strong>
              {{ changedTotal === 1 ? "Objekt geändert" : "Objekte geändert" }}
              <span class="muted">
                von {{ numberFmt.format(changedTotal + overview.unchanged) }}
              </span>
            </span>
            <span class="chg-statfilters" role="group" aria-label="Nach Status filtern">
              <button
                v-for="entry in STATUSES"
                :key="entry.key"
                type="button"
                class="chg-statfilter"
                :class="[`is-${entry.key}`, { active: status === entry.key }]"
                :disabled="!overview[entry.key].count"
                :aria-pressed="status === entry.key"
                @click="toggleStatus(entry.key)"
              >
                <span class="chg-dot" aria-hidden="true" />
                <strong>{{ numberFmt.format(overview[entry.key].count) }}</strong>
                {{ entry.label.toLowerCase() }}
              </button>
            </span>
          </div>
          <div class="chg-bar" aria-hidden="true">
            <span
              v-for="part in bar"
              :key="part.key"
              :class="`is-${part.key}`"
              :style="{ flexGrow: part.width }"
            />
          </div>

          <div v-if="overview.modified.count" class="chg-facet-row">
            <span class="muted small">Was wurde geändert?</span>
            <button
              v-for="entry in FACETS"
              :key="entry.key"
              type="button"
              class="facet-chip"
              :class="[`facet-${entry.key}`, { active: facet === entry.key }]"
              :disabled="!overview.facets[entry.key]"
              :aria-pressed="facet === entry.key"
              @click="toggleFacet(entry.key)"
            >
              <component :is="entry.icon" :size="14" aria-hidden="true" />
              {{ entry.label }}
              <span class="facet-count">
                {{ numberFmt.format(overview.facets[entry.key]) }}
              </span>
            </button>
          </div>
        </template>
      </div>

      <!-- ---- Werkzeugleiste ---- -->
      <div v-if="changedTotal" class="chg-toolbar">
        <div class="chg-search">
          <PhMagnifyingGlass :size="15" aria-hidden="true" />
          <input
            v-model="searchText"
            type="search"
            placeholder="Name, Typ, Geschoss oder GUID …"
            aria-label="Änderungen durchsuchen"
          />
        </div>
        <select v-model="type" aria-label="IFC-Typ" style="width: auto">
          <option value="">Alle Typen</option>
          <option v-for="option in typeOptions" :key="option.name" :value="option.name">
            {{ option.name }} ({{ numberFmt.format(option.count) }})
          </option>
        </select>
        <select
          v-if="overview.containers.length > 1"
          aria-label="Räumlicher Bereich"
          style="width: auto"
          :value="container === undefined ? '__all' : container"
          @change="
            container =
              ($event.target as HTMLSelectElement).value === '__all'
                ? undefined
                : ($event.target as HTMLSelectElement).value
          "
        >
          <option value="__all">Alle Bereiche</option>
          <option
            v-for="option in overview.containers"
            :key="option.name"
            :value="option.name"
          >
            {{ option.name || "(ohne Zuordnung)" }}
            ({{ numberFmt.format(option.count) }})
          </option>
        </select>
        <button v-if="hasFilter" class="link small" type="button" @click="resetFilters">
          <PhX :size="12" aria-hidden="true" />
          Filter zurücksetzen
        </button>
        <span class="topbar-spacer" />
        <button
          v-if="fromId"
          class="btn"
          :class="{ primary: show3d }"
          type="button"
          :aria-pressed="show3d"
          @click="toggle3d"
        >
          <PhCubeTransparent :size="15" aria-hidden="true" />
          3D-Vergleich
        </button>
      </div>

      <!-- ---- Liste + 3D ---- -->
      <div v-if="changedTotal" class="chg-split" :class="{ 'with-3d': show3d && fromId }">
        <div class="chg-list-wrap">
          <div class="chg-count muted small">
            <template v-if="listLoading && !items.length">Lade …</template>
            <template v-else>
              {{ numberFmt.format(total) }}
              {{ total === 1 ? "Objekt" : "Objekte" }}
              <template v-if="hasFilter">
                (von {{ numberFmt.format(changedTotal) }})
              </template>
            </template>
          </div>
          <div v-if="listError" class="alert error">{{ listError }}</div>
          <SkeletonRows v-if="listLoading && !items.length" :rows="6" />
          <div v-else-if="!items.length && !listLoading" class="empty">
            <template v-if="search && /^[0-9A-Za-z_$]{22}$/.test(search)">
              Dieses Objekt ist zwischen den beiden Ständen unverändert.
            </template>
            <template v-else>Keine Änderungen für diese Filter.</template>
          </div>
          <ul v-else class="chg-list">
            <ChangeRow
              v-for="item in items"
              :key="`${item.status}:${item.globalId}`"
              :item="item"
              :open="expanded.has(item.globalId)"
              :detail="details.get(item.globalId)"
              :facet-labels="FACET_LABELS"
              :can-locate="show3d && viewerReady"
              :located="locatedId === item.globalId"
              @toggle="toggleItem(item)"
              @locate="locate(item)"
            />
          </ul>
          <div ref="sentinel" class="chg-sentinel">
            <LoadingState v-if="listLoading && items.length" text="Lade weitere …" />
            <button
              v-else-if="items.length < total"
              class="btn small"
              type="button"
              @click="loadPage(false)"
            >
              Weitere laden ({{ numberFmt.format(items.length) }} von
              {{ numberFmt.format(total) }})
            </button>
          </div>
        </div>

        <aside v-if="show3d && fromId" class="chg-3d">
          <ModelViewer
            ref="viewer"
            :key="`${commitId}:${fromId}`"
            :sources="[
              {
                key: commitId,
                src: `/api${base}/commits/${commitId}/fragments`,
                label: modelName,
              },
            ]"
            @ready="onViewerReady"
            @select="onViewerSelect"
          />
          <div class="chg-3d-legend small">
            <span class="legend-dot is-modified" /> geändert
            <template v-if="found3d"> ({{ numberFmt.format(found3d.modified ?? 0) }})</template>
            <span class="legend-dot is-added" /> neu
            <template v-if="found3d"> ({{ numberFmt.format(found3d.added ?? 0) }})</template>
            <span class="legend-dot is-removed" /> entfernt
            <template v-if="found3d"> ({{ numberFmt.format(found3d.removed ?? 0) }})</template>
            <span class="topbar-spacer" />
            <label class="chg-3d-toggle">
              <input v-model="dimRest" type="checkbox" />
              Unverändertes abblenden
            </label>
            <button
              class="link small"
              type="button"
              :disabled="!viewerReady"
              @click="viewer?.fitToColored()"
            >
              Auf Änderungen zoomen
            </button>
          </div>
          <p v-if="locateNote" class="muted small chg-3d-note">{{ locateNote }}</p>
          <p v-else-if="guidsTruncated" class="muted small chg-3d-note">
            Sehr viele Änderungen — im 3D sind je Status nur die ersten 50.000
            eingefärbt. Filter grenzen die Auswahl ein.
          </p>
          <p v-else class="muted small chg-3d-note">
            Klick auf ein Objekt zeigt seine Änderungen in der Liste. Zahlen in
            Klammern: Objekte mit 3D-Geometrie.
          </p>
        </aside>
      </div>
    </template>
  </div>
</template>
