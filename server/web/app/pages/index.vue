<script setup lang="ts">
import {
  PhClockCounterClockwise,
  PhCube,
  PhFolderSimple,
  PhKeyboard,
  PhLockSimple,
  PhMagnifyingGlass,
  PhPlayCircle,
  PhPlus,
  PhRecord,
} from "@phosphor-icons/vue";

import type { ActivityEvent, ActivityPage, Contributions, MyIssue, Project } from "~/types/api";

/**
 * Dashboard wie GitHubs Startseite: links die eigenen Projekte und
 * zugewiesene Issues, in der Mitte Begrüßung, Beitragskalender und der
 * Aktivitäts-Feed aller Projekte, rechts zuletzt Besuchtes und Tipps.
 */
const { api } = useApi();
const { user } = useAuth();
const { entries: recent } = useRecent();
const { openPalette, helpOpen } = useShortcuts();

useHead({ title: "Dashboard · IFC Hub" });

const { data: projectsData, status: projectsStatus } = useAsyncData(
  "projects",
  () => api<{ projects: Project[] }>("/projects"),
  { lazy: true },
);
const { data: myIssues } = useAsyncData(
  "me-issues",
  () => api<{ assigned: MyIssue[]; created: MyIssue[] }>("/me/issues"),
  { lazy: true },
);
const { data: contributions, status: contributionsStatus } = useAsyncData(
  "contributions-me",
  () => api<Contributions>("/contributions", { query: { user: "me" } }),
  { lazy: true },
);

const projects = computed(() =>
  [...(projectsData.value?.projects ?? [])].sort((a, b) =>
    (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt),
  ),
);
const projectFilter = ref("");
const sideProjects = computed(() => {
  const needle = projectFilter.value.trim().toLowerCase();
  return projects.value
    .filter((project) => !needle || project.name.toLowerCase().includes(needle))
    .slice(0, needle ? 20 : 8);
});

// ---- Feed ----------------------------------------------------------------------

const scope = ref<"all" | "me">("all");
const events = ref<ActivityEvent[]>([]);
const nextBefore = ref<string | null>(null);
const feedLoading = ref(false);
const feedLoaded = ref(false);

// Jeder Neuladen (Bereichswechsel) beginnt eine neue Generation; Antworten
// älterer Generationen — auch „Mehr laden“ — werden verworfen.
let feedGeneration = 0;

async function loadFeed(more = false): Promise<void> {
  if (!more) feedGeneration += 1;
  const generation = feedGeneration;
  feedLoading.value = true;
  try {
    const page = await api<ActivityPage>("/activity", {
      query: {
        limit: "30",
        user: scope.value === "me" ? "me" : undefined,
        before: more ? (nextBefore.value ?? undefined) : undefined,
      },
    });
    if (generation !== feedGeneration) return;
    events.value = more ? [...events.value, ...page.events] : page.events;
    nextBefore.value = page.nextBefore;
  } catch {
    if (generation === feedGeneration && !more) events.value = [];
  } finally {
    if (generation === feedGeneration) {
      feedLoading.value = false;
      feedLoaded.value = true;
    }
  }
}
onMounted(() => void loadFeed());
watch(scope, () => {
  feedLoaded.value = false;
  void loadFeed();
});

const runningChecks = computed(
  () => events.value.filter((event) => event.type === "run" && (event.run?.status === "running" || event.run?.status === "queued")).length,
);
const firstName = computed(() => (user.value?.name ?? "").split(/\s+/)[0] || "zurück");
</script>

<template>
  <div class="page dash">
    <div class="layout three">
      <!-- ============ Links: Projekte + zugewiesene Issues ============ -->
      <aside class="layout-side dash-left">
        <div class="dash-side-head">
          <h2>Projekte</h2>
          <NuxtLink to="/new" class="btn btn-primary btn-sm"><PhFolderSimple :size="14" /> Neu</NuxtLink>
        </div>
        <input v-model="projectFilter" type="search" class="input-sm" placeholder="Projekt finden …" aria-label="Projekte filtern" />
        <SkeletonRows v-if="projectsStatus === 'pending' && !projectsData" :rows="3" dots />
        <ul v-else class="dash-projects">
          <li v-for="project in sideProjects" :key="project.id">
            <NuxtLink :to="`/p/${project.slug}`" class="dash-project">
              <ProjectMark :project="project" :size="20" :radius="5" />
              <span class="dash-project-name">{{ project.name }}</span>
              <PhLockSimple v-if="project.visibility === 'private'" :size="12" class="subtle" aria-label="Privat" />
            </NuxtLink>
          </li>
          <li v-if="!sideProjects.length" class="muted small" style="padding: 6px">
            {{ projectFilter ? "Kein Treffer." : "Noch keine Projekte." }}
          </li>
        </ul>
        <NuxtLink to="/projects" class="small dash-all">Alle Projekte anzeigen →</NuxtLink>

        <div class="dash-section">
          <h3 class="dash-section-title">
            <PhRecord :size="16" class="color-success" /> Dir zugewiesen
            <span v-if="myIssues" class="counter">{{ myIssues.assigned.length }}</span>
          </h3>
          <ul v-if="myIssues?.assigned.length" class="mini-list">
            <li v-for="issue in myIssues.assigned.slice(0, 8)" :key="issue.id" class="mini-item">
              <IssueStateIcon :state="issue.state" :size="14" style="margin-top: 3px" />
              <div class="mini-item-main">
                <NuxtLink :to="`/p/${issue.project.slug}/i/${issue.number}`" class="mini-item-title" :title="issue.title">
                  {{ issue.title }}
                </NuxtLink>
                <div class="mini-item-sub truncate">{{ issue.project.name }} #{{ issue.number }}</div>
              </div>
            </li>
          </ul>
          <p v-else class="muted small">{{ myIssues ? "Nichts offen — gute Arbeit." : "Lädt …" }}</p>
        </div>
      </aside>

      <!-- ============ Mitte: Begrüßung, Kalender, Feed ============ -->
      <div class="layout-main dash-main">
        <section class="hero dash-hero">
          <div class="dash-hero-text">
            <h1>{{ greeting() }}, {{ firstName }}</h1>
            <p class="hero-sub">Hier siehst du, was in deinen Projekten passiert.</p>
            <div class="hero-stats">
              <NuxtLink v-if="myIssues" to="/projects" class="hero-stat">
                <PhRecord :size="16" class="color-success" />
                <strong>{{ myIssues.assigned.length }}</strong> offene Issues für dich
              </NuxtLink>
              <span v-if="runningChecks" class="hero-stat">
                <PhPlayCircle :size="16" class="color-attention" />
                <strong>{{ runningChecks }}</strong> Prüfungen laufen
              </span>
              <NuxtLink to="/projects" class="hero-stat">
                <PhCube :size="16" class="color-accent" />
                <strong>{{ projects.length }}</strong> {{ projects.length === 1 ? "Projekt" : "Projekte" }}
              </NuxtLink>
            </div>
          </div>
          <IsoScene class="hero-art" :size="300" />
        </section>

        <ContributionGraph
          class="dash-heat"
          :days="contributions?.days ?? []"
          :loading="contributionsStatus === 'pending'"
        />

        <div class="section-head">
          <h2>Aktivität</h2>
          <span class="spacer" />
          <div class="seg" role="radiogroup" aria-label="Aktivität filtern">
            <button type="button" :class="{ active: scope === 'all' }" @click="scope = 'all'">Alle Projekte</button>
            <button type="button" :class="{ active: scope === 'me' }" @click="scope = 'me'">Nur meine</button>
          </div>
        </div>
        <ActivityFeed :events="events" :loading="feedLoading && !feedLoaded" />
        <div v-if="feedLoaded && !events.length" class="box">
          <Blankslate :icon="PhClockCounterClockwise" title="Noch keine Aktivität" compact>
            Sobald jemand committet, Issues eröffnet oder Prüfungen laufen, erscheint es hier.
          </Blankslate>
        </div>
        <div v-if="nextBefore" class="feed-more">
          <button type="button" class="btn" :disabled="feedLoading" @click="loadFeed(true)">
            <span v-if="feedLoading" class="spinner" /> Mehr laden
          </button>
        </div>
      </div>

      <!-- ============ Rechts: zuletzt besucht, Tipps ============ -->
      <aside class="layout-side dash-right">
        <div class="box dash-card">
          <h3 class="dash-section-title"><PhClockCounterClockwise :size="16" /> Zuletzt besucht</h3>
          <ul v-if="recent.length" class="mini-list">
            <li v-for="entry in recent.slice(0, 6)" :key="entry.to" class="mini-item">
              <IssueStateIcon v-if="entry.type === 'issue'" :state="entry.state ?? 'open'" :size="14" style="margin-top: 3px" />
              <ModelIcon v-else-if="entry.type === 'model'" :kind="entry.kind ?? 'ifc'" :name="entry.title" :size="14" style="margin-top: 3px" />
              <PhFolderSimple v-else :size="14" style="margin-top: 3px" class="muted" />
              <div class="mini-item-main">
                <NuxtLink :to="entry.to" class="mini-item-title">{{ entry.title }}</NuxtLink>
                <div v-if="entry.subtitle" class="mini-item-sub truncate">{{ entry.subtitle }}</div>
              </div>
            </li>
          </ul>
          <p v-else class="muted small" style="margin: 0">Besuchte Projekte, Modelle und Issues erscheinen hier.</p>
        </div>

        <div class="box dash-card tip-card">
          <h3 class="dash-section-title"><PhKeyboard :size="16" /> Schneller ans Ziel</h3>
          <p>
            Mit <kbd>Strg</kbd> <kbd>K</kbd> oder <kbd>/</kbd> springst du zu jedem Projekt, Modell oder Issue.
            <kbd>g</kbd> <kbd>i</kbd> öffnet die Issues des aktuellen Projekts.
          </p>
          <div class="row" style="margin-top: 12px">
            <button type="button" class="btn btn-sm" @click="openPalette()">
              <PhMagnifyingGlass :size="14" /> Suchen
            </button>
            <button type="button" class="btn btn-sm btn-invisible" @click="helpOpen = true">Alle Tastenkürzel</button>
          </div>
        </div>

        <div v-if="myIssues?.created.length" class="box dash-card">
          <h3 class="dash-section-title"><PhPlus :size="16" /> Von dir eröffnet</h3>
          <ul class="mini-list">
            <li v-for="issue in myIssues.created.slice(0, 5)" :key="issue.id" class="mini-item">
              <IssueStateIcon :state="issue.state" :size="14" style="margin-top: 3px" />
              <div class="mini-item-main">
                <NuxtLink :to="`/p/${issue.project.slug}/i/${issue.number}`" class="mini-item-title" :title="issue.title">
                  {{ issue.title }}
                </NuxtLink>
                <div class="mini-item-sub truncate">
                  {{ issue.project.name }} #{{ issue.number }} · <RelTime :date="issue.updatedAt" />
                </div>
              </div>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
