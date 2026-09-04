<script setup lang="ts">
// Unter-Issue-Explorer: durchsuchbare, gruppierte Liste der Unter-Issues
// eines Sammel-Issues neben einem festen 3D-Viewer. Ausgelegt auf viele
// Einträge (150+ Portal-Befunde): Filter nach Zustand, Fehlerart und
// Verortung, Volltextsuche, Tastaturnavigation, seitenweises Nachladen.
// Die Auswahl markiert die Objekte des Unter-Issues im Viewer; ohne
// Auswahl sind die Objekte ALLER gefilterten Unter-Issues markiert.
import {
  PhArrowSquareOut,
  PhCaretDown,
  PhCaretLeft,
  PhCaretRight,
  PhCheckCircle,
  PhCrosshairSimple,
  PhCube,
  PhCursorClick,
  PhMagnifyingGlass,
  PhRecord,
  PhWarning,
  PhX,
} from "@phosphor-icons/vue";

import type { Issue } from "~/types/api";

interface ViewerSource {
  key: string;
  src: string;
  label?: string;
}

const props = defineProps<{
  slug: string;
  subIssues: Issue[];
  /** Viewer-Quellen (verknüpfte IFC-Modelle mit Head-Commit). */
  sources: ViewerSource[];
}>();

interface ViewerHandle {
  highlightGuids(guids: string[], zoom?: boolean): Promise<number>;
  isolateGuids(guids: string[]): Promise<number>;
  showAll(): Promise<void>;
}

// ---- Ableitungen je Unter-Issue (einmal berechnet) ----------------------

interface Row {
  issue: Issue;
  core: string;
  category: string;
  object: string | null;
  ifcClass: string | null;
  /** Suchtext (kleingeschrieben). */
  haystack: string;
}

const rows = computed<Row[]>(() =>
  props.subIssues.map((issue) => {
    const core = issueTitleCore(issue.title);
    const object = issueObjectName(issue.body);
    return {
      issue,
      core,
      category: issueCategory(issue.title),
      object,
      ifcClass: issueObjectClass(issue.body),
      haystack: [
        `#${issue.number}`,
        issue.title,
        issue.body,
        object ?? "",
        ...issue.guids,
        ...issue.labels.map((label) => label.name),
        ...issue.assignees.map((a) => a.name),
      ]
        .join("\n")
        .toLowerCase(),
    };
  }),
);

interface Category {
  key: string;
  count: number;
  open: number;
  hue: number;
}

/** Fehlerarten nach Häufigkeit. */
const categories = computed<Category[]>(() => {
  const map = new Map<string, Category>();
  for (const row of rows.value) {
    const entry = map.get(row.category) ?? {
      key: row.category,
      count: 0,
      open: 0,
      hue: hueFor(row.category),
    };
    entry.count += 1;
    if (row.issue.state === "open") entry.open += 1;
    map.set(row.category, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
});
const hueByCategory = computed(
  () => new Map(categories.value.map((c) => [c.key, c.hue])),
);

// ---- Gruppierung nach betroffenem Objekt ---------------------------------

interface ObjectGroup {
  key: string;
  label: string;
  ifcClass: string | null;
  count: number;
  open: number;
  guids: string[];
}

/** Schlüssel des betroffenen Objekts: Name aus dem Text, sonst erste GUID. */
function objectKeyOf(row: Row): string | null {
  return row.object ?? row.issue.guids[0] ?? null;
}

const OBJECT_NONE = "\u0000none";

/** Betroffene Objekte nach Zahl der Befunde. */
const objects = computed<ObjectGroup[]>(() => {
  const map = new Map<string, ObjectGroup>();
  for (const row of rows.value) {
    const key = objectKeyOf(row) ?? OBJECT_NONE;
    const entry = map.get(key) ?? {
      key,
      label: row.object ?? (row.issue.guids[0] ?? "ohne Objekt"),
      ifcClass: row.ifcClass,
      count: 0,
      open: 0,
      guids: [],
    };
    entry.count += 1;
    if (row.issue.state === "open") entry.open += 1;
    for (const guid of row.issue.guids) {
      if (!entry.guids.includes(guid)) entry.guids.push(guid);
    }
    if (!entry.ifcClass && row.ifcClass) entry.ifcClass = row.ifcClass;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === OBJECT_NONE) return 1;
    if (b.key === OBJECT_NONE) return -1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });
});
/** Objektgruppe je GUID (für die Rückkopplung aus dem Viewer). */
const objectByGuid = computed(() => {
  const map = new Map<string, ObjectGroup>();
  for (const group of objects.value) {
    for (const guid of group.guids) {
      if (!map.has(guid)) map.set(guid, group);
    }
  }
  return map;
});

const groupMode = ref<"category" | "object">("category");
const activeObject = ref<string | null>(null);
const activeObjectGroup = computed(() =>
  activeObject.value
    ? objects.value.find((group) => group.key === activeObject.value) ?? null
    : null,
);

function toggleObject(key: string): void {
  activeObject.value = activeObject.value === key ? null : key;
}

const total = computed(() => props.subIssues.length);
const closedCount = computed(
  () => props.subIssues.filter((issue) => issue.state === "closed").length,
);
const locatedCount = computed(
  () => props.subIssues.filter((issue) => issue.guids.length > 0).length,
);

// ---- Filter -------------------------------------------------------------

const query = ref("");
const stateFilter = ref<"all" | "open" | "closed">("all");
const locatedOnly = ref(false);
const activeCategory = ref<string | null>(null);
const showCategories = ref(true);
const PAGE = 60;
const limit = ref(PAGE);

const filtered = computed<Row[]>(() => {
  const needle = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (stateFilter.value !== "all" && row.issue.state !== stateFilter.value) {
      return false;
    }
    if (locatedOnly.value && !row.issue.guids.length) return false;
    if (activeCategory.value && row.category !== activeCategory.value) {
      return false;
    }
    if (
      activeObject.value &&
      (objectKeyOf(row) ?? OBJECT_NONE) !== activeObject.value
    ) {
      return false;
    }
    return !needle || row.haystack.includes(needle);
  });
});
const visible = computed(() => filtered.value.slice(0, limit.value));
const hasFilter = computed(
  () =>
    Boolean(query.value.trim()) ||
    stateFilter.value !== "all" ||
    locatedOnly.value ||
    activeCategory.value !== null ||
    activeObject.value !== null,
);

function resetFilters(): void {
  query.value = "";
  stateFilter.value = "all";
  locatedOnly.value = false;
  activeCategory.value = null;
  activeObject.value = null;
  pickedWithoutIssue.value = null;
}

function toggleCategory(key: string): void {
  activeCategory.value = activeCategory.value === key ? null : key;
}

watch([query, stateFilter, locatedOnly, activeCategory, activeObject], () => {
  limit.value = PAGE;
});

// ---- Auswahl + Viewer ---------------------------------------------------

const viewerRef = ref<ViewerHandle | null>(null);
const viewerReady = ref(false);
const selectedId = ref<string | null>(null);
const isolateOnly = ref(false);
/** Treffer der letzten Markierung im geladenen Stand. */
const foundCount = ref<number | null>(null);
const listRef = ref<HTMLElement | null>(null);

const selectedIndex = computed(() =>
  filtered.value.findIndex((row) => row.issue.id === selectedId.value),
);
const selected = computed(() =>
  selectedIndex.value >= 0 ? filtered.value[selectedIndex.value]! : null,
);

/** GUIDs der aktuellen Markierung: Auswahl oder alle gefilterten. */
const markedGuids = computed(() => {
  if (selected.value) return selected.value.issue.guids;
  const set = new Set<string>();
  for (const row of filtered.value) {
    for (const guid of row.issue.guids) set.add(guid);
  }
  return [...set];
});

/** Wie viele GUIDs zuletzt markiert werden sollten (für "nicht gefunden"). */
const requestedCount = ref(0);
const missingCount = computed(() =>
  foundCount.value === null
    ? 0
    : Math.max(0, requestedCount.value - foundCount.value),
);

let markTimer: ReturnType<typeof setTimeout> | null = null;
async function applyMark(zoom = true): Promise<void> {
  const viewer = viewerRef.value;
  if (!viewer || !viewerReady.value) return;
  const guids = markedGuids.value;
  requestedCount.value = guids.length;
  foundCount.value = await viewer.highlightGuids(guids, zoom);
  if (isolateOnly.value && guids.length) {
    await viewer.isolateGuids(guids);
  } else {
    await viewer.showAll();
  }
}

/** Kamera erneut auf die aktuelle Markierung fahren. */
function zoomToMarked(): void {
  void applyMark(true);
}

/** Im Viewer angeklicktes Objekt ohne zugehöriges Unter-Issue. */
const pickedWithoutIssue = ref<{ name: string; category: string } | null>(null);

/**
 * Rückkopplung aus dem 3D-Viewer: Klick auf ein Objekt filtert die Liste
 * auf dessen Unter-Issues (Gruppierung "Objekt"). Objekte ohne Befund
 * werden in der Statusleiste gemeldet.
 */
function onViewerPick(pick: { globalId: string; name: string; category: string } | null): void {
  if (!pick) {
    pickedWithoutIssue.value = null;
    return;
  }
  // Erst über den Objektnamen (wie im Befundtext), dann über die GUID.
  const group =
    objects.value.find((entry) => entry.label === pick.name) ??
    objectByGuid.value.get(pick.globalId);
  if (group) {
    pickedWithoutIssue.value = null;
    groupMode.value = "object";
    activeObject.value = group.key;
    selectedId.value = null;
    // Markierung nachziehen, Kamera bleibt, wo der Nutzer gerade ist.
    if (markTimer) clearTimeout(markTimer);
    markTimer = setTimeout(() => void applyMark(false), 50);
  } else {
    pickedWithoutIssue.value = { name: pick.name, category: pick.category };
  }
}
function scheduleMark(): void {
  if (markTimer) clearTimeout(markTimer);
  markTimer = setTimeout(() => void applyMark(), 150);
}

watch(markedGuids, scheduleMark);
watch(isolateOnly, scheduleMark);

function onViewerReady(): void {
  viewerReady.value = true;
  // Kurz warten, bis die Szene steht, dann alle gefilterten markieren.
  setTimeout(() => void applyMark(), 400);
}

function select(row: Row | null): void {
  selectedId.value = row?.issue.id ?? null;
  if (row) {
    nextTick(() => {
      listRef.value
        ?.querySelector<HTMLElement>(`[data-id="${row.issue.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
}

function step(delta: number): void {
  if (!filtered.value.length) return;
  const next =
    selectedIndex.value < 0
      ? delta > 0
        ? 0
        : filtered.value.length - 1
      : (selectedIndex.value + delta + filtered.value.length) %
        filtered.value.length;
  if (next >= limit.value) limit.value = next + PAGE;
  select(filtered.value[next]!);
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    step(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    step(-1);
  } else if (event.key === "Escape") {
    select(null);
  } else if (event.key === "Enter" && selected.value) {
    navigateTo(`/p/${props.slug}/i/${selected.value.issue.number}`);
  }
}

// Viewer standardmäßig an; Quellen kommen ggf. erst nach dem Modell-Fetch.
const show3d = ref(true);
</script>

<template>
  <section class="sie card">
    <!-- Kopf: Fortschritt + Kennzahlen -->
    <header class="sie-head">
      <div class="sie-head-title">
        <h2>Unter-Issues</h2>
        <span class="sie-count">{{ total }}</span>
      </div>
      <div class="sie-progress" :title="`${closedCount} von ${total} erledigt`">
        <span
          class="sie-progress-fill"
          :style="{ width: `${total ? (closedCount / total) * 100 : 0}%` }"
        />
      </div>
      <div class="sie-stats">
        <span>
          <strong>{{ total - closedCount }}</strong> offen
        </span>
        <span>
          <strong>{{ closedCount }}</strong> erledigt
        </span>
        <span :class="{ muted: !locatedCount }">
          <PhCube :size="13" aria-hidden="true" />
          <strong>{{ locatedCount }}</strong> in 3D
        </span>
        <span v-if="categories.length > 1">
          <strong>{{ categories.length }}</strong> Fehlerarten
        </span>
      </div>
      <span class="topbar-spacer" />
      <button v-if="sources.length" class="btn small" @click="show3d = !show3d">
        {{ show3d ? "3D ausblenden" : "3D anzeigen" }}
      </button>
    </header>

    <div class="sie-body" :class="{ 'with-viewer': show3d && sources.length }">
      <!-- ============ Liste ============ -->
      <div class="sie-panel">
        <div class="sie-toolbar">
          <label class="sie-search">
            <PhMagnifyingGlass :size="14" aria-hidden="true" />
            <input
              v-model="query"
              type="search"
              placeholder="Suchen: Titel, Objekt, GUID, #Nummer …"
              aria-label="Unter-Issues durchsuchen"
            />
          </label>
          <div class="sie-chips">
            <button
              class="sie-chip"
              :class="{ active: stateFilter === 'all' }"
              @click="stateFilter = 'all'"
            >Alle</button>
            <button
              class="sie-chip"
              :class="{ active: stateFilter === 'open' }"
              @click="stateFilter = 'open'"
            >
              <PhRecord :size="12" aria-hidden="true" />
              Offen
            </button>
            <button
              class="sie-chip"
              :class="{ active: stateFilter === 'closed' }"
              @click="stateFilter = 'closed'"
            >
              <PhCheckCircle :size="12" weight="fill" aria-hidden="true" />
              Erledigt
            </button>
            <button
              class="sie-chip"
              :class="{ active: locatedOnly }"
              title="Nur Unter-Issues mit verorteten Objekten"
              @click="locatedOnly = !locatedOnly"
            >
              <PhCube :size="12" aria-hidden="true" />
              mit 3D
            </button>
            <button
              v-if="hasFilter"
              class="sie-chip reset"
              title="Alle Filter zurücksetzen"
              @click="resetFilters"
            >
              <PhX :size="12" aria-hidden="true" />
              zurücksetzen
            </button>
          </div>
        </div>

        <!-- Gruppierung: Fehlerart oder betroffenes Objekt -->
        <div class="sie-groups">
          <div class="sie-groups-head">
            <button class="sie-groups-toggle" @click="showCategories = !showCategories">
              <PhCaretDown v-if="showCategories" :size="12" aria-hidden="true" />
              <PhCaretRight v-else :size="12" aria-hidden="true" />
              Gruppieren
            </button>
            <div class="sie-seg" role="tablist" aria-label="Gruppierung">
              <button
                role="tab"
                :aria-selected="groupMode === 'category'"
                :class="{ active: groupMode === 'category' }"
                @click="groupMode = 'category'; showCategories = true"
              >
                Fehlerart
                <span class="sie-seg-count">{{ categories.length }}</span>
              </button>
              <button
                role="tab"
                :aria-selected="groupMode === 'object'"
                :class="{ active: groupMode === 'object' }"
                @click="groupMode = 'object'; showCategories = true"
              >
                Objekt
                <span class="sie-seg-count">{{ objects.length }}</span>
              </button>
            </div>
          </div>

          <ul v-if="showCategories && groupMode === 'category'" class="sie-group-list">
            <li v-for="cat in categories" :key="cat.key">
              <button
                class="sie-group"
                :class="{ active: activeCategory === cat.key }"
                :title="cat.key"
                @click="toggleCategory(cat.key)"
              >
                <span
                  class="sie-dot"
                  :style="{ background: `hsl(${cat.hue} 65% 50%)` }"
                />
                <span class="sie-group-label">{{ cat.key }}</span>
                <span class="sie-group-count">
                  <span v-if="cat.open !== cat.count" class="muted">{{ cat.count - cat.open }}/</span>{{ cat.count }}
                </span>
              </button>
            </li>
          </ul>

          <ul v-else-if="showCategories" class="sie-group-list">
            <li v-for="group in objects" :key="group.key">
              <button
                class="sie-group"
                :class="{ active: activeObject === group.key, unlocated: !group.guids.length }"
                :title="group.guids.length ? `${group.label} — ${group.count} Befund(e), ${group.guids.length} Objekt(e) in 3D` : `${group.label} — nicht in 3D verortet`"
                @click="toggleObject(group.key)"
              >
                <PhCube v-if="group.guids.length" :size="13" class="sie-group-icon" aria-hidden="true" />
                <span v-else class="sie-dot hollow" />
                <span class="sie-group-label">
                  <span class="mono">{{ group.label }}</span>
                  <span v-if="group.ifcClass" class="muted"> · {{ group.ifcClass.replace(/^Ifc/, "") }}</span>
                </span>
                <span class="sie-group-count">
                  <span v-if="group.open !== group.count" class="muted">{{ group.count - group.open }}/</span>{{ group.count }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <!-- Zeilen -->
        <div class="sie-list-head">
          <span>
            {{ filtered.length === total ? `${total} Unter-Issues` : `${filtered.length} von ${total}` }}
          </span>
          <span class="sie-list-nav">
            <span v-if="selected" class="muted">
              {{ selectedIndex + 1 }}/{{ filtered.length }}
            </span>
            <button
              class="sie-icon-btn"
              title="Vorheriges Unter-Issue (↑)"
              :disabled="!filtered.length"
              @click="step(-1)"
            >
              <PhCaretLeft :size="13" aria-hidden="true" />
            </button>
            <button
              class="sie-icon-btn"
              title="Nächstes Unter-Issue (↓)"
              :disabled="!filtered.length"
              @click="step(1)"
            >
              <PhCaretRight :size="13" aria-hidden="true" />
            </button>
          </span>
        </div>
        <ul
          ref="listRef"
          class="sie-list"
          tabindex="0"
          role="listbox"
          aria-label="Unter-Issues"
          @keydown="onListKeydown"
        >
          <li
            v-for="row in visible"
            :key="row.issue.id"
            :data-id="row.issue.id"
            class="sie-row"
            :class="{
              selected: row.issue.id === selectedId,
              closed: row.issue.state === 'closed',
            }"
            role="option"
            :aria-selected="row.issue.id === selectedId"
            @click="select(row.issue.id === selectedId ? null : row)"
          >
            <span
              class="sie-row-dot"
              :style="{ background: `hsl(${hueByCategory.get(row.category) ?? 0} 65% 50%)` }"
              :title="row.category"
            />
            <span class="issue-state" :class="row.issue.state">
              <PhRecord v-if="row.issue.state === 'open'" :size="14" />
              <PhCheckCircle v-else :size="14" weight="fill" />
            </span>
            <div class="sie-row-main">
              <div class="sie-row-title">
                <span class="mono muted">#{{ row.issue.number }}</span>
                {{ row.core }}
              </div>
              <div class="sie-row-meta">
                <button
                  v-if="row.object"
                  class="sie-object"
                  :class="{ active: activeObject === objectKeyOf(row) }"
                  :title="`Nur Befunde zu ${row.object} zeigen`"
                  @click.stop="groupMode = 'object'; toggleObject(objectKeyOf(row)!)"
                >
                  {{ row.object }}
                </button>
                <span v-if="row.ifcClass" class="muted">{{ row.ifcClass.replace(/^Ifc/, "") }}</span>
                <span
                  v-if="row.issue.guids.length"
                  class="sie-located"
                  :title="`${row.issue.guids.length} Objekt(e) verortet`"
                >
                  <PhCube :size="12" aria-hidden="true" />
                  {{ row.issue.guids.length }}
                </span>
                <span v-else class="muted">ohne 3D</span>
                <span
                  v-for="label in row.issue.labels"
                  :key="label.id"
                  class="label-chip"
                  :style="{
                    backgroundColor: label.color,
                    color: labelTextColor(label.color),
                  }"
                >{{ label.name }}</span>
              </div>
            </div>
            <NuxtLink
              class="sie-row-open"
              :to="`/p/${slug}/i/${row.issue.number}`"
              title="Unter-Issue öffnen"
              @click.stop
            >
              <PhArrowSquareOut :size="15" aria-hidden="true" />
            </NuxtLink>
          </li>
          <li v-if="!filtered.length" class="sie-empty">
            Keine Unter-Issues für diese Filter.
            <button v-if="hasFilter" class="link" @click="resetFilters">Filter zurücksetzen</button>
          </li>
          <li v-if="filtered.length > visible.length" class="sie-more">
            <button class="btn small" @click="limit += PAGE">
              Weitere {{ Math.min(PAGE, filtered.length - visible.length) }} anzeigen
              <span class="muted">({{ visible.length }} von {{ filtered.length }})</span>
            </button>
          </li>
        </ul>
      </div>

      <!-- ============ Viewer ============ -->
      <div v-if="show3d && sources.length" class="sie-viewer">
        <ModelViewer
          ref="viewerRef"
          :sources="sources"
          @ready="onViewerReady"
          @select="onViewerPick"
        />

        <!-- Statusleiste: was ist markiert, was fehlt, Rückkopplung aus 3D -->
        <div class="sie-viewer-bar" :class="{ warn: pickedWithoutIssue }">
          <div class="sie-viewer-status">
            <template v-if="pickedWithoutIssue">
              <PhCursorClick :size="15" aria-hidden="true" />
              <span class="sie-viewer-title">
                <span class="mono">{{ pickedWithoutIssue.name }}</span>
                <span class="muted"> · {{ pickedWithoutIssue.category.replace(/^Ifc/, "") }}</span>
              </span>
              <span class="muted">kein Befund zu diesem Objekt</span>
              <button class="sie-icon-btn" title="Hinweis schließen" @click="pickedWithoutIssue = null">
                <PhX :size="13" aria-hidden="true" />
              </button>
            </template>
            <template v-else-if="selected">
              <span class="sie-status-pill selection">#{{ selected.issue.number }}</span>
              <span class="sie-viewer-title">{{ selected.core }}</span>
              <span v-if="selected.object" class="mono muted">{{ selected.object }}</span>
              <NuxtLink
                :to="`/p/${slug}/i/${selected.issue.number}`"
                class="sie-icon-btn link"
                title="Unter-Issue öffnen"
              >
                <PhArrowSquareOut :size="14" aria-hidden="true" />
              </NuxtLink>
              <button class="sie-icon-btn" title="Auswahl aufheben — alle gefilterten markieren (Esc)" @click="select(null)">
                <PhX :size="13" aria-hidden="true" />
              </button>
            </template>
            <template v-else-if="activeObjectGroup">
              <span class="sie-status-pill object">
                <PhCube :size="12" aria-hidden="true" />
                {{ activeObjectGroup.label }}
              </span>
              <span class="sie-viewer-title">
                {{ activeObjectGroup.count }} {{ activeObjectGroup.count === 1 ? "Befund" : "Befunde" }} zu diesem Objekt
              </span>
              <button class="sie-icon-btn" title="Objektfilter aufheben" @click="activeObject = null">
                <PhX :size="13" aria-hidden="true" />
              </button>
            </template>
            <template v-else>
              <span class="sie-status-pill">{{ filtered.length }}</span>
              <span class="sie-viewer-title">
                {{ filtered.length === total ? "Alle Unter-Issues" : "Gefilterte Unter-Issues" }} markiert
              </span>
              <span class="muted sie-hint">
                <PhCursorClick :size="13" aria-hidden="true" />
                Objekt im Modell anklicken → Befunde dazu
              </span>
            </template>
          </div>

          <span v-if="foundCount !== null && !pickedWithoutIssue" class="sie-found" :class="{ warn: missingCount }">
            <PhWarning v-if="missingCount" :size="13" aria-hidden="true" />
            <PhCube v-else :size="13" aria-hidden="true" />
            {{ foundCount }} {{ foundCount === 1 ? "Objekt" : "Objekte" }}
            <template v-if="missingCount">
              · {{ missingCount }} nicht im geladenen Stand
            </template>
          </span>
          <button
            class="sie-icon-btn"
            title="Kamera auf die markierten Objekte fahren"
            :disabled="!markedGuids.length"
            @click="zoomToMarked"
          >
            <PhCrosshairSimple :size="14" aria-hidden="true" />
          </button>
          <label class="sie-toggle" title="Alle anderen Objekte ausblenden (ThatOpen Hider)">
            <input v-model="isolateOnly" type="checkbox" />
            Nur betroffene
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
