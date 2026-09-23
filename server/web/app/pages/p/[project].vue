<script setup lang="ts">
import {
  PhCubeTransparent,
  PhFolderSimple,
  PhGear,
  PhGlobeSimple,
  PhLockSimple,
  PhPlayCircle,
  PhPulse,
  PhRecord,
  PhUploadSimple,
  PhWarningCircle,
} from "@phosphor-icons/vue";

/**
 * Rahmen aller Projektseiten (wie ein GitHub-Repository): Titelband mit
 * Tabs, darunter die jeweilige Unterseite. Lädt Projekt, Modelle und
 * Kennzahlen einmal und stellt sie per useProject() bereit.
 */
const route = useRoute();
const slug = route.params.project as string;
const project = provideProject(slug);
const { detail, stats, models, error, canWrite, isAdmin } = project;

const base = `/p/${slug}`;

type TabKey = "files" | "issues" | "actions" | "3d" | "activity" | "settings";

const activeTab = computed<TabKey>(() => {
  const rest = route.path.slice(base.length);
  if (rest.startsWith("/issues") || rest.startsWith("/i/")) return "issues";
  if (rest.startsWith("/actions")) return "actions";
  if (rest.startsWith("/3d")) return "3d";
  if (rest.startsWith("/activity")) return "activity";
  if (rest.startsWith("/settings")) return "settings";
  return "files";
});

const ifcCount = computed(
  () => (models.value ?? []).filter((model) => model.kind === "ifc" && model.head).length,
);
const runsActive = computed(
  () => (stats.value?.runs.running ?? 0) + (stats.value?.runs.queued ?? 0) > 0,
);
const runsFailed = computed(() => (stats.value?.runs.failed ?? 0) > 0);

// Kennzahlen nach Seitenwechseln im Projekt auffrischen (neue Issues,
// Commits, Runs) — leichtgewichtig, ohne die Seite zu blockieren.
watch(
  () => route.path,
  (next, previous) => {
    if (previous && next !== previous) void project.refreshStats();
  },
);

const { track } = useRecent();
watch(
  () => detail.value?.project,
  (value) => {
    if (value) {
      track({ type: "project", title: value.name, subtitle: value.description || value.slug, to: base });
    }
  },
  { immediate: true },
);
useHead({
  title: computed(() =>
    detail.value?.project ? `${detail.value.project.name} · IFC Hub` : "IFC Hub",
  ),
});

const notFound = computed(() => {
  const status = (error.value as { statusCode?: number; status?: number } | null)?.statusCode ??
    (error.value as { status?: number } | null)?.status;
  return status === 404 || status === 403;
});
</script>

<template>
  <div>
    <div class="project-band">
      <div class="project-band-top">
        <div class="project-title">
          <ProjectMark :project="detail?.project ?? null" :size="36" />
          <template v-if="detail">
            <h1>
              <NuxtLink :to="base">{{ detail.project.name }}</NuxtLink>
            </h1>
            <span class="tag" :title="detail.project.visibility === 'public' ? 'Alle angemeldeten Benutzer sehen das Projekt' : 'Nur Mitglieder sehen das Projekt'">
              <PhGlobeSimple v-if="detail.project.visibility === 'public'" :size="12" />
              <PhLockSimple v-else :size="12" />
              {{ detail.project.visibility === "public" ? "Öffentlich" : "Privat" }}
            </span>
            <span v-if="detail.role" class="tag tag-accent hide-sm" :title="`Deine Rolle: ${roleHint(detail.role)}`">
              {{ roleLabel(detail.role) }}
            </span>
          </template>
          <span v-else-if="!error" class="skeleton" style="width: 220px; height: 20px" />
        </div>
        <div v-if="detail" class="project-band-actions">
          <NuxtLink v-if="ifcCount" :to="`${base}/3d`" class="btn btn-sm hide-sm">
            <PhCubeTransparent :size="16" />
            3D-Szene
            <span class="counter">{{ ifcCount }}</span>
          </NuxtLink>
          <NuxtLink v-if="canWrite" :to="`${base}?upload=1`" class="btn btn-sm btn-primary">
            <PhUploadSimple :size="16" />
            Hochladen
          </NuxtLink>
        </div>
      </div>
      <nav class="unav" aria-label="Projekt">
        <NuxtLink :to="base" class="unav-item" :class="{ active: activeTab === 'files' }">
          <PhFolderSimple :size="16" />
          Dateien
          <span v-if="models" class="counter">{{ models.length }}</span>
        </NuxtLink>
        <NuxtLink :to="`${base}/issues`" class="unav-item" :class="{ active: activeTab === 'issues' }">
          <PhRecord :size="16" />
          Issues
          <span v-if="stats" class="counter">{{ stats.issues.open }}</span>
        </NuxtLink>
        <NuxtLink :to="`${base}/actions`" class="unav-item" :class="{ active: activeTab === 'actions' }">
          <PhPlayCircle :size="16" />
          Actions
          <span v-if="runsActive" class="band-dot running" title="Prüfungen laufen" />
          <span v-else-if="runsFailed" class="band-dot failed" title="Fehlgeschlagene Prüfungen" />
        </NuxtLink>
        <NuxtLink :to="`${base}/3d`" class="unav-item" :class="{ active: activeTab === '3d' }">
          <PhCubeTransparent :size="16" />
          3D
        </NuxtLink>
        <NuxtLink :to="`${base}/activity`" class="unav-item" :class="{ active: activeTab === 'activity' }">
          <PhPulse :size="16" />
          Aktivität
        </NuxtLink>
        <NuxtLink
          v-if="isAdmin"
          :to="`${base}/settings`"
          class="unav-item"
          :class="{ active: activeTab === 'settings' }"
        >
          <PhGear :size="16" />
          Einstellungen
        </NuxtLink>
      </nav>
    </div>

    <div v-if="error && !detail" class="page">
      <div class="box">
        <Blankslate
          :icon="PhWarningCircle"
          :title="notFound ? 'Projekt nicht gefunden' : 'Projekt konnte nicht geladen werden'"
        >
          <template v-if="notFound">
            Das Projekt „{{ slug }}“ existiert nicht oder ist privat.
          </template>
          <template v-else>{{ apiErrorMessage(error) }}</template>
          <template #actions>
            <NuxtLink to="/projects" class="btn">Alle Projekte</NuxtLink>
          </template>
        </Blankslate>
      </div>
    </div>
    <div
      v-else
      class="page"
      :class="{ wide: route.meta.wide || route.meta.fullBleed, flush: route.meta.fullBleed }"
    >
      <NuxtPage />
    </div>
  </div>
</template>
