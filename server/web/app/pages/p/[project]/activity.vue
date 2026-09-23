<script setup lang="ts">
import { PhCube, PhGitCommit, PhRecord, PhShieldCheck, PhUsers } from "@phosphor-icons/vue";

import type { ActivityEvent, ActivityPage, Contributions } from "~/types/api";

/**
 * Aktivität eines Projekts (GitHubs „Insights“ + Feed): Kennzahlen,
 * Beitragskalender des Projekts, Verlauf aller Ereignisse, Mitwirkende.
 */
const project = useProject();
const { slug, detail, stats } = project;
const { api } = useApi();

useHead({ title: computed(() => `Aktivität · ${detail.value?.project.name ?? slug}`) });

const { data: contributions, status: contributionsStatus } = useAsyncData(
  `contributions-${slug}`,
  () => api<Contributions>("/contributions", { query: { project: slug } }),
  { lazy: true },
);

// ---- Feed mit „Mehr laden“ -----------------------------------------------------

type FeedFilter = "all" | "commit" | "issue" | "run";
const filter = ref<FeedFilter>("all");
const events = ref<ActivityEvent[]>([]);
const nextBefore = ref<string | null>(null);
const loading = ref(false);
const loaded = ref(false);

async function load(more = false): Promise<void> {
  loading.value = true;
  try {
    const page = await api<ActivityPage>("/activity", {
      query: { project: slug, limit: "40", before: more ? (nextBefore.value ?? undefined) : undefined },
    });
    events.value = more ? [...events.value, ...page.events] : page.events;
    nextBefore.value = page.nextBefore;
  } catch {
    // Feed bleibt leer
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}
onMounted(() => void load());

const filtered = computed(() =>
  events.value.filter((event) => {
    if (filter.value === "all") return true;
    if (filter.value === "commit") return event.type === "commit";
    if (filter.value === "run") return event.type === "run";
    return event.type.startsWith("issue") || event.type === "comment";
  }),
);

const maxCommits = computed(() => Math.max(1, ...(stats.value?.contributors ?? []).map((c) => c.commits)));
const successRate = computed(() => {
  const runs = stats.value?.runs;
  if (!runs) return null;
  const done = runs.success + runs.failed + runs.error;
  return done ? Math.round((runs.success / done) * 100) : null;
});
</script>

<template>
  <div class="activity-page">
    <div class="stat-grid activity-stats">
      <div class="stat-tile">
        <span class="stat-tile-label"><PhGitCommit :size="14" /> Commits</span>
        <span class="stat-tile-value">{{ stats ? formatNumber(stats.commitCount) : "–" }}</span>
        <span class="stat-tile-sub">{{ stats ? plural(stats.branchCount, "Branch", "Branches") : "" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhUsers :size="14" /> Mitwirkende</span>
        <span class="stat-tile-value">{{ stats?.contributors.length ?? "–" }}</span>
        <span class="stat-tile-sub">{{ stats ? plural(stats.memberCount, "Mitglied", "Mitglieder") : "" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhRecord :size="14" /> Offene Issues</span>
        <span class="stat-tile-value">{{ stats?.issues.open ?? "–" }}</span>
        <span class="stat-tile-sub">{{ stats ? `${stats.issues.closed} geschlossen` : "" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhShieldCheck :size="14" /> Prüfungen</span>
        <span class="stat-tile-value">{{ successRate !== null ? `${successRate} %` : "–" }}</span>
        <span class="stat-tile-sub">{{ stats ? `Erfolgsquote aus ${stats.runs.total} Runs` : "" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhCube :size="14" /> IFC-Entities</span>
        <span class="stat-tile-value">{{ stats ? formatCompact(stats.entityCount) : "–" }}</span>
        <span class="stat-tile-sub">in den aktuellen Ständen</span>
      </div>
    </div>

    <ContributionGraph
      class="activity-heat"
      :days="contributions?.days ?? []"
      :loading="contributionsStatus === 'pending'"
    />

    <div class="layout activity-layout">
      <div class="layout-main">
        <div class="section-head">
          <h2>Verlauf</h2>
          <span class="spacer" />
          <div class="seg" role="radiogroup" aria-label="Ereignisse filtern">
            <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">Alle</button>
            <button type="button" :class="{ active: filter === 'commit' }" @click="filter = 'commit'">Commits</button>
            <button type="button" :class="{ active: filter === 'issue' }" @click="filter = 'issue'">Issues</button>
            <button type="button" :class="{ active: filter === 'run' }" @click="filter = 'run'">Prüfungen</button>
          </div>
        </div>
        <ActivityFeed :events="filtered" :show-project="false" :loading="loading && !loaded" />
        <p v-if="loaded && !filtered.length" class="muted">Keine Ereignisse in diesem Zeitraum.</p>
        <div v-if="nextBefore" class="feed-more">
          <button type="button" class="btn" :disabled="loading" @click="load(true)">
            <span v-if="loading" class="spinner" /> Ältere Ereignisse laden
          </button>
        </div>
      </div>
      <aside class="layout-side">
        <div class="section-head"><h2>Mitwirkende</h2></div>
        <div class="box">
          <div v-if="!stats?.contributors.length" class="box-body muted small">Noch keine Commits.</div>
          <div v-for="entry in stats?.contributors ?? []" :key="entry.user?.id ?? 'x'" class="box-row contributor-row">
            <UserAvatar :user="entry.user" :size="28" />
            <div class="contributor-main">
              <div class="row">
                <strong class="truncate">{{ entry.user?.name ?? "Unbekannt" }}</strong>
                <span class="spacer" />
                <span class="muted small nowrap">{{ plural(entry.commits, "Commit", "Commits") }}</span>
              </div>
              <div class="meter contributor-bar">
                <span :style="{ width: `${(entry.commits / maxCommits) * 100}%`, background: 'var(--brand-gradient)' }" />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
