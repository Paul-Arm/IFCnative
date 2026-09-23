<script setup lang="ts">
import {
  PhClockCounterClockwise,
  PhFiles,
  PhFolderSimple,
  PhGlobeSimple,
  PhLockSimple,
  PhMagnifyingGlass,
  PhPlus,
  PhRecord,
  PhUsers,
} from "@phosphor-icons/vue";

import type { Project } from "~/types/api";

/** Alle sichtbaren Projekte als Karten mit 3D-Vorschaubild. */
const { api } = useApi();
const { load, imageFor } = useProjectImage();

useHead({ title: "Projekte · IFC Hub" });

const { data, status, error } = useAsyncData("projects", () => api<{ projects: Project[] }>("/projects"), {
  lazy: true,
});

const query = ref("");
const filter = ref<"all" | "mine" | "public" | "private">("all");
const sort = ref<"activity" | "name" | "new">("activity");

const projects = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const list = (data.value?.projects ?? []).filter((project) => {
    if (filter.value === "mine" && !project.role) return false;
    if (filter.value === "public" && project.visibility !== "public") return false;
    if (filter.value === "private" && project.visibility !== "private") return false;
    return (
      !needle ||
      `${project.name} ${project.slug} ${project.description ?? ""}`.toLowerCase().includes(needle)
    );
  });
  return list.sort((a, b) => {
    if (sort.value === "name") return a.name.localeCompare(b.name, "de");
    if (sort.value === "new") return b.createdAt.localeCompare(a.createdAt);
    return (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt);
  });
});

watch(
  () => data.value?.projects,
  (list) => {
    for (const project of list ?? []) if (project.hasImage) load(project.slug);
  },
  { immediate: true },
);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Projekte</h1>
      <span v-if="data" class="counter">{{ data.projects.length }}</span>
      <span class="spacer" />
      <NuxtLink to="/new" class="btn btn-primary"><PhPlus :size="16" /> Neues Projekt</NuxtLink>
    </div>

    <div class="projects-toolbar">
      <div class="input-icon" style="flex: 1 1 260px">
        <PhMagnifyingGlass :size="16" />
        <input v-model="query" type="search" placeholder="Projekte durchsuchen …" aria-label="Projekte durchsuchen" />
      </div>
      <div class="seg" role="radiogroup" aria-label="Filter">
        <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">Alle</button>
        <button type="button" :class="{ active: filter === 'mine' }" @click="filter = 'mine'">Meine</button>
        <button type="button" :class="{ active: filter === 'public' }" @click="filter = 'public'">Öffentlich</button>
        <button type="button" :class="{ active: filter === 'private' }" @click="filter = 'private'">Privat</button>
      </div>
      <select v-model="sort" class="auto" aria-label="Sortierung">
        <option value="activity">Zuletzt aktiv</option>
        <option value="name">Name</option>
        <option value="new">Neueste</option>
      </select>
    </div>

    <div v-if="error" class="flash flash-danger">Projekte konnten nicht geladen werden: {{ apiErrorMessage(error) }}</div>

    <div v-if="status === 'pending' && !data" class="project-grid">
      <div v-for="index in 6" :key="index" class="project-card">
        <div class="project-cover" />
        <div class="project-card-body">
          <span class="skeleton" style="width: 60%; height: 16px" />
          <span class="skeleton" style="width: 90%" />
        </div>
      </div>
    </div>

    <div v-else-if="projects.length" class="project-grid">
      <NuxtLink v-for="project in projects" :key="project.id" :to="`/p/${project.slug}`" class="project-card">
        <div class="project-cover">
          <img v-if="imageFor(project.slug)" :src="imageFor(project.slug)!" alt="" />
          <IsoScene
            v-else
            variant="seed"
            class="project-cover-art"
            :seed="project.id"
            :hue="hashString(project.id) % 360"
            :animated="false"
            :size="230"
          />
          <span class="tag">
            <PhGlobeSimple v-if="project.visibility === 'public'" :size="12" />
            <PhLockSimple v-else :size="12" />
            {{ project.visibility === "public" ? "Öffentlich" : "Privat" }}
          </span>
        </div>
        <div class="project-card-body">
          <h2 class="project-card-title">{{ project.name }}</h2>
          <p class="project-card-desc">{{ project.description || "Keine Beschreibung." }}</p>
          <div class="project-card-meta">
            <span><PhFiles :size="14" /> {{ project.modelCount ?? 0 }}</span>
            <span v-if="project.openIssueCount !== undefined"><PhRecord :size="14" /> {{ project.openIssueCount }}</span>
            <span v-if="project.memberCount"><PhUsers :size="14" /> {{ project.memberCount }}</span>
            <span class="spacer" />
            <span><PhClockCounterClockwise :size="14" /> <RelTime :date="project.lastActivityAt ?? project.createdAt" /></span>
          </div>
        </div>
      </NuxtLink>
      <NuxtLink to="/new" class="project-card new">
        <PhPlus :size="28" />
        <strong>Neues Projekt</strong>
        <span class="small">Modelle, Pläne und Issues bündeln</span>
      </NuxtLink>
    </div>

    <div v-else class="box">
      <Blankslate :icon="PhFolderSimple" :title="query || filter !== 'all' ? 'Keine passenden Projekte' : 'Noch keine Projekte'" blueprint>
        <template v-if="query || filter !== 'all'">Passe Suche oder Filter an.</template>
        <template v-else>Lege das erste Projekt an — es bündelt IFC-Modelle, Pläne, Issues und Prüfungen.</template>
        <template #actions>
          <NuxtLink to="/new" class="btn btn-primary"><PhPlus :size="16" /> Neues Projekt</NuxtLink>
        </template>
      </Blankslate>
    </div>
  </div>
</template>
