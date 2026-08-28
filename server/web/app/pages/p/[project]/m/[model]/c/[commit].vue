<script setup lang="ts">
import type {
  Commit,
  EntityFieldDiff,
  GuidDiffEntry,
  GuidDiffSummary,
} from "~/types/api";

const route = useRoute();
const router = useRouter();
const { api } = useApi();
const { token } = useAuth();
const slug = route.params.project as string;
const modelSlug = route.params.model as string;
const commitId = route.params.commit as string;
const base = `/projects/${slug}/models/${modelSlug}`;

const { data: commitData } = await useAsyncData(`commit-${commitId}`, () =>
  api<{ commit: Commit }>(`${base}/commits/${commitId}`),
);
const { data: commitsData } = await useAsyncData(
  `commits-all-${slug}-${modelSlug}`,
  () => api<{ commits: Commit[] }>(`${base}/commits`),
);

/** Base of the shown diff: ?from= override, else the parent commit. */
const fromId = computed(
  () =>
    (route.query.from as string | undefined) ??
    commitData.value?.commit.parentCommitId ??
    null,
);

const { data: diffData, status: diffStatus } = await useAsyncData(
  `diff-${commitId}`,
  async () => {
    if (!fromId.value) return null;
    return api<{ diff: GuidDiffSummary }>(`${base}/diff`, {
      query: { from: fromId.value, to: commitId },
    });
  },
  { watch: [fromId] },
);

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
  router.replace({ query: value ? { from: value } : {} });
}

async function download(): Promise<void> {
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
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "long",
  timeStyle: "short",
});

// ---- Gruppierung: Typ -> Name -> Entities -----------------------------

interface NameGroup {
  name: string;
  entries: GuidDiffEntry[];
}

interface TypeGroup {
  type: string;
  count: number;
  names: NameGroup[];
}

function groupEntries(entries: GuidDiffEntry[]): TypeGroup[] {
  const byType = new Map<string, GuidDiffEntry[]>();
  for (const entry of entries) {
    let list = byType.get(entry.type);
    if (!list) {
      list = [];
      byType.set(entry.type, list);
    }
    list.push(entry);
  }
  return [...byType.entries()]
    .map(([type, list]) => {
      const byName = new Map<string, GuidDiffEntry[]>();
      for (const entry of list) {
        const key = entry.name || "(ohne Name)";
        let nameList = byName.get(key);
        if (!nameList) {
          nameList = [];
          byName.set(key, nameList);
        }
        nameList.push(entry);
      }
      return {
        type,
        count: list.length,
        names: [...byName.entries()]
          .map(([name, nameEntries]) => ({ name, entries: nameEntries }))
          .sort(
            (a, b) =>
              b.entries.length - a.entries.length || a.name.localeCompare(b.name),
          ),
      };
    })
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

const filterText = ref("");
const filterActive = computed(() => filterText.value.trim().length > 0);

function matchesFilter(entry: GuidDiffEntry): boolean {
  const query = filterText.value.trim().toLowerCase();
  if (!query) return true;
  return (
    entry.type.toLowerCase().includes(query) ||
    entry.name.toLowerCase().includes(query) ||
    entry.globalId.toLowerCase().includes(query)
  );
}

const sections = computed(() => {
  const diff = diffData.value?.diff;
  if (!diff) return [];
  return [
    { key: "added", label: "Neu", entries: diff.added, cls: "status-added" },
    { key: "modified", label: "Geändert", entries: diff.modified, cls: "status-modified" },
    { key: "removed", label: "Entfernt", entries: diff.removed, cls: "status-removed" },
  ]
    .map((section) => {
      const filtered = section.entries.filter(matchesFilter);
      return {
        ...section,
        total: section.entries.length,
        filteredCount: filtered.length,
        groups: groupEntries(filtered),
      };
    })
    .filter((section) => section.total > 0);
});
</script>

<template>
  <div v-if="commitData">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">{{ slug }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}/m/${modelSlug}`">{{ modelSlug }}</NuxtLink>
      <span>/</span>
      <span class="commit-id">{{ commitId.slice(0, 8) }}</span>
    </nav>

    <div class="card">
      <div class="card-header">
        <h2>{{ commitData.commit.message || "(ohne Nachricht)" }}</h2>
        <span class="topbar-spacer" />
        <button @click="download">.ifc herunterladen</button>
      </div>
      <div class="card-body">
        <div class="muted small">
          <strong>{{ commitData.commit.author?.name ?? "?" }}</strong>
          committete am
          {{ dateFmt.format(new Date(commitData.commit.createdAt)) }}
          auf Branch <span class="badge">{{ commitData.commit.branchName }}</span>
          · Schema {{ commitData.commit.schema }}
          · {{ commitData.commit.entityCount }} Entities
        </div>
        <div style="margin-top: 0.5rem">
          <span class="diffstat">
            <span class="add">+{{ commitData.commit.added }}</span>
            <span class="mod">~{{ commitData.commit.modified }}</span>
            <span class="del">−{{ commitData.commit.removed }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Änderungen</h2>
        <span class="topbar-spacer" />
        <input
          v-model="filterText"
          type="search"
          placeholder="Filtern: Typ, Name oder GUID …"
          style="width: 240px"
        />
        <label for="diff-base" class="muted small" style="margin: 0">
          Vergleichsbasis:
        </label>
        <select
          id="diff-base"
          style="width: auto"
          :value="fromId ?? ''"
          @change="changeBase"
        >
          <option
            v-if="commitData.commit.parentCommitId"
            :value="commitData.commit.parentCommitId"
          >
            Vorgänger-Commit
          </option>
          <option
            v-for="other in commitsData?.commits.filter((c) => c.id !== commitId)"
            :key="other.id"
            :value="other.id"
          >
            {{ other.id.slice(0, 8) }} · {{ other.message || "(ohne Nachricht)" }}
          </option>
        </select>
      </div>

      <div v-if="!fromId" class="empty">
        Erster Commit dieses Modells — alle
        {{ commitData.commit.entityCount }} Entities sind neu.
      </div>
      <div v-else-if="diffStatus === 'pending'" class="empty">Diff wird berechnet …</div>
      <template v-else-if="diffData">
        <div v-if="diffData.diff.identical" class="card-body">
          <div class="alert success" style="margin: 0">
            Beide Stände sind semantisch identisch (gleicher Manifest-Hash) —
            ein Re-Export ohne inhaltliche Änderung.
          </div>
        </div>
        <div v-for="section in sections" :key="section.key">
          <div class="card-header">
            <h3 :class="section.cls" style="margin: 0">
              {{ section.label }}
              <span v-if="filterActive" class="muted">
                ({{ section.filteredCount }} von {{ section.total }})
              </span>
              <template v-else>({{ section.total }})</template>
            </h3>
          </div>
          <div v-if="!section.groups.length" class="empty">
            Keine Treffer für den Filter.
          </div>
          <details
            v-for="group in section.groups"
            :key="group.type"
            class="tree-group"
            :open="filterActive ? true : undefined"
          >
            <summary>
              <strong :class="section.cls">{{ group.type }}</strong>
              <span class="badge">{{ group.count }}</span>
              <span class="muted small">
                {{ group.names.length }}
                {{ group.names.length === 1 ? "Name" : "Namen" }}
              </span>
            </summary>
            <div class="tree-children">
              <template v-for="nameGroup in group.names" :key="nameGroup.name">
                <!-- Geändert: jede Entity einzeln aufklappbar (Feld-Diff) -->
                <template v-if="section.key === 'modified'">
                  <details
                    v-for="entry in nameGroup.entries"
                    :key="entry.globalId"
                    class="entity-detail tree-leaf"
                    @toggle="(e: Event) => (e.target as HTMLDetailsElement).open && loadDetail(entry)"
                  >
                    <summary>
                      {{ nameGroup.name }}
                      <span class="commit-id">{{ entry.globalId }}</span>
                    </summary>
                    <div style="margin-top: 0.5rem">
                      <div
                        v-if="details.get(entry.globalId) === 'loading'"
                        class="muted small"
                      >
                        Lade Details …
                      </div>
                      <div
                        v-else-if="details.get(entry.globalId)"
                        class="table-wrap"
                      >
                        <table>
                          <thead>
                            <tr>
                              <th>Gruppe</th>
                              <th>Feld</th>
                              <th>Vorher</th>
                              <th>Nachher</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="change in (details.get(entry.globalId) as EntityFieldDiff).changes"
                              :key="`${change.group}:${change.field}`"
                            >
                              <td class="small">{{ change.group }}</td>
                              <td class="small"><strong>{{ change.field }}</strong></td>
                              <td class="small mono diff-row-removed">
                                {{ change.before ?? "—" }}
                              </td>
                              <td class="small mono diff-row-added">
                                {{ change.after ?? "—" }}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                </template>
                <!-- Neu/Entfernt: gleiche Namen zusammengefasst -->
                <details
                  v-else-if="nameGroup.entries.length > 1"
                  class="tree-name"
                >
                  <summary>
                    {{ nameGroup.name }}
                    <span class="badge">{{ nameGroup.entries.length }}</span>
                  </summary>
                  <ul class="tree-guids">
                    <li
                      v-for="entry in nameGroup.entries"
                      :key="entry.globalId"
                      class="commit-id"
                    >
                      {{ entry.globalId }}
                    </li>
                  </ul>
                </details>
                <div v-else class="tree-leaf">
                  {{ nameGroup.name }}
                  <span class="commit-id">{{ nameGroup.entries[0]!.globalId }}</span>
                </div>
              </template>
            </div>
          </details>
        </div>
        <div
          v-if="!sections.length && !diffData.diff.identical"
          class="empty"
        >
          Keine Unterschiede zwischen den gewählten Ständen.
        </div>
        <div class="card-body muted small">
          {{ diffData.diff.unchanged }} Entities unverändert.
        </div>
      </template>
    </div>
  </div>
</template>
