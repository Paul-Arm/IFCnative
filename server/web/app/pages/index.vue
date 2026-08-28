<script setup lang="ts">
import type { Project } from "~/types/api";

const { api } = useApi();

const { data, refresh } = await useAsyncData("projects", () =>
  api<{ projects: Project[] }>("/projects"),
);

const newName = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

async function createProject(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await api("/projects", { method: "POST", body: { name: newName.value } });
    newName.value = "";
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
</script>

<template>
  <div>
    <h1>Projekte</h1>

    <div class="card">
      <ul v-if="data?.projects.length" class="list">
        <li v-for="project in data.projects" :key="project.id" class="list-item">
          <div class="list-item-main">
            <NuxtLink :to="`/p/${project.slug}`" style="font-weight: 600">
              {{ project.name }}
            </NuxtLink>
            <div class="muted small">
              {{ project.slug }} · angelegt am
              {{ dateFmt.format(new Date(project.createdAt)) }}
            </div>
          </div>
          <span class="badge">{{ project.modelCount ?? 0 }} Modelle</span>
          <span v-if="project.role" class="badge accent">{{ project.role }}</span>
        </li>
      </ul>
      <div v-else class="empty">
        Noch keine Projekte — unten das erste anlegen.
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Neues Projekt</h2></div>
      <div class="card-body">
        <div v-if="error" class="alert error">{{ error }}</div>
        <form class="form-inline" @submit.prevent="createProject">
          <div>
            <label for="project-name">Name</label>
            <input
              id="project-name"
              v-model="newName"
              type="text"
              required
              placeholder="z.B. Bürogebäude Nord"
            />
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="busy">Anlegen</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
