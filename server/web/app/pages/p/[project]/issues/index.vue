<script setup lang="ts">
import {
  PhCaretDown,
  PhCheck,
  PhDotsThree,
  PhDownloadSimple,
  PhFunnel,
  PhMagnifyingGlass,
  PhPlus,
  PhRecord,
  PhTag,
  PhUploadSimple,
  PhX,
} from "@phosphor-icons/vue";

import type { Issue, Label } from "~/types/api";
import type { IssueSort } from "~/utils/issueQuery";

/**
 * Issue-Liste wie bei GitHub: Filterzeile mit Qualifiern (in der URL als
 * ?q=…, also teilbar), Offen/Geschlossen, Filtermenüs, Sammel-Issues mit
 * aufklappbaren Unter-Issues, BCF-Import/-Export.
 */
const route = useRoute();
const router = useRouter();
const project = useProject();
const { slug, detail, models, canWrite } = project;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();

useHead({ title: computed(() => `Issues · ${detail.value?.project.name ?? slug}`) });

const {
  data: issuesData,
  refresh: refreshIssues,
  status: issuesStatus,
} = useAsyncData(
  `issues-${slug}`,
  () => api<{ issues: Issue[]; openCount: number; closedCount: number }>(`/projects/${slug}/issues`),
  { lazy: true },
);
const { data: labelsData } = useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
  { lazy: true },
);
const pending = computed(
  () => (issuesStatus.value === "pending" || issuesStatus.value === "idle") && !issuesData.value,
);

// ---- Filter (URL-gebunden) ----------------------------------------------------

const DEFAULT_Q = "is:open";
const QUALIFIER_EXAMPLES = ["is:open", 'label:"…"', "author:…", "assignee:…", "no:assignee", "model:…", "kind:bcf"];
const q = ref(typeof route.query.q === "string" ? route.query.q : DEFAULT_Q);
watch(
  () => route.query.q,
  (value) => {
    const next = typeof value === "string" ? value : DEFAULT_Q;
    // Getrimmt vergleichen: Die URL speichert ohne Leerzeichen am Ende — sonst
    // verschluckt das Feld das gerade getippte Leerzeichen.
    if (next !== q.value.trim()) q.value = next;
  },
);

let urlTimer: ReturnType<typeof setTimeout> | undefined;
watch(q, (value) => {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    void router.replace({ query: value.trim() === DEFAULT_Q ? {} : { q: value.trim() } });
  }, 250);
});
onBeforeUnmount(() => clearTimeout(urlTimer));

const query = computed(() => parseIssueQuery(q.value));
const state = computed(() => query.value.state ?? "open");
const hasFilter = computed(() => q.value.trim() !== DEFAULT_Q);

const all = computed(() => issuesData.value?.issues ?? []);
/** Treffer ohne Statusfilter — für die Zähler der Tabs. */
const matching = computed(() => all.value.filter((issue) => matchesIssue(issue, query.value)));
const openCount = computed(() => matching.value.filter((issue) => issue.state === "open").length);
const closedCount = computed(() => matching.value.length - openCount.value);

/** Nur Status + Sortierung → Unter-Issues klappen unter ihrem Sammel-Issue auf. */
const onlyState = computed(() => {
  const qy = query.value;
  return (
    !qy.text &&
    !qy.labels.length &&
    !qy.authors.length &&
    !qy.assignees.length &&
    !qy.noAssignee &&
    !qy.models.length &&
    !qy.kind
  );
});

const rows = computed(() => {
  const list = matching.value.filter((issue) => issue.state === state.value);
  const visible = onlyState.value
    ? (() => {
        const ids = new Set(list.map((issue) => issue.id));
        return list.filter((issue) => !issue.parentId || !ids.has(issue.parentId));
      })()
    : list;
  return sortIssues(visible, query.value.sort);
});

const PAGE = 50;
const limit = ref(PAGE);
watch(q, () => (limit.value = PAGE));

const childrenByParent = computed(() => {
  const map = new Map<string, Issue[]>();
  for (const issue of all.value) {
    if (!issue.parentId) continue;
    map.set(issue.parentId, [...(map.get(issue.parentId) ?? []), issue]);
  }
  for (const list of map.values()) list.sort((a, b) => a.number - b.number);
  return map;
});
const expanded = reactive(new Set<string>());
const CHILD_PREVIEW = 8;

function toggleExpanded(id: string): void {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}

// ---- Filtermenüs -------------------------------------------------------------

const authors = computed(() => {
  const map = new Map<string, NonNullable<Issue["author"]>>();
  for (const issue of all.value) if (issue.author) map.set(issue.author.id, issue.author);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
});
const members = computed(() => (detail.value?.members ?? []).filter((member) => member.user));
const linkedModels = computed(() => {
  const ids = new Set(all.value.flatMap((issue) => issue.models.map((model) => model.id)));
  return (models.value ?? []).filter((model) => ids.has(model.id));
});

function toggle(key: string, value: string): void {
  q.value = toggleQualifier(q.value, key, value);
}
function has(key: "labels" | "authors" | "assignees" | "models", value: string): boolean {
  return query.value[key].some((entry) => entry.toLowerCase() === value.toLowerCase());
}
function setState(next: "open" | "closed"): void {
  q.value = setQualifier(q.value, "is", next, ["open", "closed"]);
}
function setKind(kind: "bcf" | "virtual" | null): void {
  // Auch die Kurzform is:bcf / is:virtual entfernen — sonst überstimmt sie die Wahl.
  q.value = setQualifier(setQualifier(q.value, "is", null, ["bcf", "virtual"]), "kind", kind);
}
function setSort(sort: IssueSort): void {
  q.value = setQualifier(q.value, "sort", sort === "created-desc" ? null : sort);
}
function toggleNoAssignee(): void {
  q.value = query.value.noAssignee
    ? setQualifier(q.value, "no", null)
    : `${q.value.trim()} no:assignee`;
}
function onLabelClick(name: string): void {
  if (!has("labels", name)) toggle("label", name);
}

// ---- BCF --------------------------------------------------------------------

const hasBcf = computed(() => all.value.some((issue) => issue.kind === "bcf"));
const importing = ref(false);

async function importBcf(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importing.value = true;
  try {
    const result = await $fetch<{
      imported: number;
      skipped: number;
      located: number;
      parent: { id: string; number: number } | null;
    }>(`/api/projects/${slug}/issues/bcf?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: {
        "content-type": "application/zip",
        ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
      },
    });
    await Promise.all([refreshIssues(), project.refreshStats()]);
    if (result.parent) {
      expanded.add(result.parent.id);
      toast.success(
        `BCF-Import: ${result.imported} Unter-Issue(s), ${result.located} davon in 3D verortet${result.skipped ? `, ${result.skipped} übersprungen` : ""}.`,
        { action: { label: `#${result.parent.number} öffnen`, to: `/p/${slug}/i/${result.parent.number}` } },
      );
    } else {
      toast.info(`BCF-Import: nichts Neues — ${result.skipped} Topic(s) bereits vorhanden.`);
    }
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    importing.value = false;
  }
}

async function exportBcf(): Promise<void> {
  try {
    const blob = await $fetch<Blob>(`/api/projects/${slug}/issues/bcf`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-issues.bcfzip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

const bcfInput = ref<HTMLInputElement | null>(null);
</script>

<template>
  <div class="issues-page">
    <!-- ============ Werkzeugleiste ============ -->
    <div class="issues-toolbar">
      <div class="input-icon issues-search">
        <PhMagnifyingGlass :size="16" />
        <input
          v-model="q"
          type="search"
          spellcheck="false"
          aria-label="Issues filtern"
          placeholder='z. B. is:open label:"Brandschutz" assignee:Paula'
        />
      </div>
      <NuxtLink :to="`/p/${slug}/settings/labels`" class="btn">
        <PhTag :size="16" />
        Labels
        <span v-if="labelsData" class="counter">{{ labelsData.labels.length }}</span>
      </NuxtLink>
      <UiMenu align="right">
        <template #trigger="{ toggle: open }">
          <button type="button" class="btn btn-icon" aria-label="Weitere Aktionen" data-tip="BCF" @click="open">
            <span v-if="importing" class="spinner" />
            <PhDotsThree v-else :size="16" weight="bold" />
          </button>
        </template>
        <div class="menu-heading">BCF (BIM Collaboration Format)</div>
        <button v-if="canWrite" type="button" class="menu-item" @click="bcfInput?.click()">
          <PhUploadSimple :size="16" />
          <span>BCF importieren<span class="menu-item-desc">.bcfzip → Sammel-Issue mit Unter-Issues</span></span>
        </button>
        <button type="button" class="menu-item" :disabled="!hasBcf" @click="exportBcf">
          <PhDownloadSimple :size="16" />
          <span>Als BCF exportieren<span class="menu-item-desc">alle IFC-Issues des Projekts</span></span>
        </button>
      </UiMenu>
      <input ref="bcfInput" type="file" accept=".bcf,.bcfzip,.zip" hidden @change="importBcf" />
      <NuxtLink :to="`/p/${slug}/issues/new`" class="btn btn-primary">
        <PhPlus :size="16" /> Neues Issue
      </NuxtLink>
    </div>

    <button v-if="hasFilter" type="button" class="issues-reset" @click="q = DEFAULT_Q">
      <span class="issues-reset-x"><PhX :size="12" weight="bold" /></span>
      Filter und Sortierung zurücksetzen
    </button>

    <!-- ============ Liste ============ -->
    <div class="box">
      <div class="box-header issues-head">
        <nav class="subnav" aria-label="Status">
          <button type="button" class="subnav-item" :class="{ active: state === 'open' }" @click="setState('open')">
            <PhRecord :size="16" /> {{ openCount }} Offen
          </button>
          <button
            type="button"
            class="subnav-item"
            :class="{ active: state === 'closed' }"
            @click="setState('closed')"
          >
            <PhCheck :size="16" /> {{ closedCount }} Geschlossen
          </button>
        </nav>
        <span class="spacer" />
        <div class="issues-filters">
          <UiMenu align="right" :close-on-click="false">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                Autor <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Nach Autor filtern</div>
            <button
              v-for="user in authors"
              :key="user.id"
              type="button"
              class="menu-item"
              @click="toggle('author', user.name)"
            >
              <UserAvatar :user="user" :size="18" :titled="false" />
              <span class="truncate" style="flex: 1">{{ user.name }}</span>
              <PhCheck v-if="has('authors', user.name)" :size="14" class="check-mark" />
            </button>
          </UiMenu>
          <UiMenu align="right" :close-on-click="false">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                Label <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Nach Label filtern</div>
            <button
              v-for="label in labelsData?.labels ?? []"
              :key="label.id"
              type="button"
              class="menu-item"
              @click="toggle('label', label.name)"
            >
              <span class="label-dot" :style="{ '--lc': label.color }" />
              <span class="truncate" style="flex: 1">
                {{ label.name }}
                <span v-if="label.description" class="menu-item-desc truncate">{{ label.description }}</span>
              </span>
              <PhCheck v-if="has('labels', label.name)" :size="14" class="check-mark" />
            </button>
            <div v-if="!labelsData?.labels.length" class="menu-empty">Noch keine Labels.</div>
          </UiMenu>
          <UiMenu align="right" :close-on-click="false">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                Modell <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Nach Modell filtern</div>
            <button
              v-for="model in linkedModels"
              :key="model.id"
              type="button"
              class="menu-item"
              @click="toggle('model', model.slug)"
            >
              <ModelIcon :kind="model.kind" :name="model.name" />
              <span class="truncate" style="flex: 1">{{ model.name }}</span>
              <PhCheck v-if="has('models', model.slug)" :size="14" class="check-mark" />
            </button>
            <div v-if="!linkedModels.length" class="menu-empty">Keine Issues mit Modellbezug.</div>
          </UiMenu>
          <UiMenu align="right" :close-on-click="false">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                Zugewiesen <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Nach Bearbeiter filtern</div>
            <button type="button" class="menu-item" @click="toggleNoAssignee">
              <span class="truncate" style="flex: 1">Niemandem zugewiesen</span>
              <PhCheck v-if="query.noAssignee" :size="14" class="check-mark" />
            </button>
            <div class="menu-sep" />
            <button
              v-for="member in members"
              :key="member.userId"
              type="button"
              class="menu-item"
              @click="toggle('assignee', member.user!.name)"
            >
              <UserAvatar :user="member.user" :size="18" :titled="false" />
              <span class="truncate" style="flex: 1">{{ member.user!.name }}</span>
              <PhCheck v-if="has('assignees', member.user!.name)" :size="14" class="check-mark" />
            </button>
          </UiMenu>
          <UiMenu align="right">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                Art <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Issue-Art</div>
            <button type="button" class="menu-item" @click="setKind(null)">
              <span style="flex: 1">Alle</span>
              <PhCheck v-if="!query.kind" :size="14" class="check-mark" />
            </button>
            <button type="button" class="menu-item" @click="setKind('bcf')">
              <span style="flex: 1">IFC-Issues (BCF)<span class="menu-item-desc">exportierbar, mit Viewpoint</span></span>
              <PhCheck v-if="query.kind === 'bcf'" :size="14" class="check-mark" />
            </button>
            <button type="button" class="menu-item" @click="setKind('virtual')">
              <span style="flex: 1">Virtuell<span class="menu-item-desc">nur im Hub</span></span>
              <PhCheck v-if="query.kind === 'virtual'" :size="14" class="check-mark" />
            </button>
          </UiMenu>
          <UiMenu align="right">
            <template #trigger="{ toggle: open }">
              <button type="button" class="btn btn-invisible btn-sm" @click="open">
                <PhFunnel :size="14" /> {{ SORT_LABELS[query.sort] }} <PhCaretDown :size="12" />
              </button>
            </template>
            <div class="menu-heading">Sortieren</div>
            <button
              v-for="(label, key) in SORT_LABELS"
              :key="key"
              type="button"
              class="menu-item"
              @click="setSort(key as IssueSort)"
            >
              <span style="flex: 1">{{ label }}</span>
              <PhCheck v-if="query.sort === key" :size="14" class="check-mark" />
            </button>
          </UiMenu>
        </div>
      </div>

      <SkeletonRows v-if="pending" :rows="5" dots />
      <template v-else-if="rows.length">
        <IssueRow
          v-for="issue in rows.slice(0, limit)"
          :key="issue.id"
          :issue="issue"
          :slug="slug"
          :expandable="onlyState && issue.subIssueCount > 0"
          :expanded="expanded.has(issue.id)"
          @toggle="toggleExpanded(issue.id)"
          @label="onLabelClick"
        >
          <template v-if="onlyState && expanded.has(issue.id)" #children>
            <ul class="issue-children">
              <li v-for="child in (childrenByParent.get(issue.id) ?? []).slice(0, CHILD_PREVIEW)" :key="child.id">
                <IssueStateIcon :state="child.state" :size="14" />
                <span class="mono muted">#{{ child.number }}</span>
                <NuxtLink :to="`/p/${slug}/i/${child.number}`" class="truncate" :title="child.title">
                  {{ issueTitleCore(child.title) }}
                </NuxtLink>
                <span v-if="issueObjectName(child.body)" class="sie-object">{{ issueObjectName(child.body) }}</span>
              </li>
              <li v-if="(childrenByParent.get(issue.id)?.length ?? 0) > CHILD_PREVIEW" class="issue-children-more">
                <NuxtLink :to="`/p/${slug}/i/${issue.number}`">
                  Alle {{ issue.subIssueCount }} Unter-Issues mit Suche und 3D-Verortung öffnen →
                </NuxtLink>
              </li>
            </ul>
          </template>
        </IssueRow>
        <div v-if="rows.length > limit" class="box-footer" style="text-align: center">
          <button type="button" class="btn btn-sm" @click="limit += PAGE">
            Weitere {{ Math.min(PAGE, rows.length - limit) }} anzeigen
          </button>
        </div>
      </template>
      <Blankslate
        v-else
        :icon="PhRecord"
        :title="hasFilter ? 'Keine Issues für diesen Filter' : state === 'open' ? 'Keine offenen Issues' : 'Keine geschlossenen Issues'"
      >
        <template v-if="hasFilter">Passe den Filter an oder setze ihn zurück.</template>
        <template v-else>
          Issues sammeln Befunde, Fragen und Aufgaben — verknüpft mit Modellständen und in 3D verortet.
        </template>
        <template #actions>
          <button v-if="hasFilter" type="button" class="btn" @click="q = DEFAULT_Q">Filter zurücksetzen</button>
          <NuxtLink v-else :to="`/p/${slug}/issues/new`" class="btn btn-primary">
            <PhPlus :size="16" /> Neues Issue
          </NuxtLink>
        </template>
      </Blankslate>
    </div>
    <p class="issues-tip muted small">
      <kbd>c</kbd> legt ein neues Issue an · Qualifier:
      <template v-for="example in QUALIFIER_EXAMPLES" :key="example">{{ " " }}<code>{{ example }}</code></template>
    </p>
  </div>
</template>
