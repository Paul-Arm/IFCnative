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

const sections = computed(() => {
  const diff = diffData.value?.diff;
  if (!diff) return [];
  return [
    { key: "added", label: "Neu", entries: diff.added, cls: "status-added" },
    { key: "modified", label: "Geändert", entries: diff.modified, cls: "status-modified" },
    { key: "removed", label: "Entfernt", entries: diff.removed, cls: "status-removed" },
  ].filter((section) => section.entries.length > 0);
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
              {{ section.label }} ({{ section.entries.length }})
            </h3>
          </div>
          <ul class="list">
            <li
              v-for="entry in section.entries"
              :key="entry.globalId"
              class="list-item"
              style="display: block"
            >
              <template v-if="section.key === 'modified'">
                <details
                  class="entity-detail"
                  @toggle="(e: Event) => (e.target as HTMLDetailsElement).open && loadDetail(entry)"
                >
                  <summary>
                    <strong>{{ entry.type }}</strong>
                    {{ entry.name || "(ohne Name)" }}
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
              <template v-else>
                <strong>{{ entry.type }}</strong>
                {{ entry.name || "(ohne Name)" }}
                <span class="commit-id">{{ entry.globalId }}</span>
              </template>
            </li>
          </ul>
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
