<script setup lang="ts">
import type { Project } from "~/types/api";

const { api } = useApi();
const { token } = useAuth();

const { data, refresh } = await useAsyncData("projects", () =>
  api<{ projects: Project[] }>("/projects"),
);

// Projektbilder (Szenen-Screenshots) mit Auth laden -> Object-URLs.
const thumbs = reactive(new Map<string, string>());
watch(
  data,
  async () => {
    for (const project of data.value?.projects ?? []) {
      if (!project.hasImage || thumbs.has(project.id)) continue;
      try {
        const blob = await $fetch<Blob>(`/api/projects/${project.slug}/image`, {
          responseType: "blob",
          headers: token.value
            ? { authorization: `Bearer ${token.value}` }
            : {},
        });
        thumbs.set(project.id, URL.createObjectURL(blob));
      } catch {
        // Ohne Bild einfach den Platzhalter zeigen.
      }
    }
  },
  { immediate: true },
);

const newName = ref("");
const newVisibility = ref<"private" | "public">("public");
const error = ref<string | null>(null);
const busy = ref(false);

async function createProject(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await api("/projects", {
      method: "POST",
      body: { name: newName.value, visibility: newVisibility.value },
    });
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
          <img
            v-if="thumbs.get(project.id)"
            :src="thumbs.get(project.id)"
            class="proj-thumb"
            alt=""
          />
          <span v-else class="proj-thumb placeholder" aria-hidden="true">
            <HubLogo :size="24" node-fill="var(--surface-2)" />
          </span>
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
          <span
            class="badge"
            :class="project.visibility === 'public' ? 'success' : ''"
          >
            {{ project.visibility === "public" ? "öffentlich" : "privat" }}
          </span>
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
            <label for="project-visibility">Sichtbarkeit</label>
            <select id="project-visibility" v-model="newVisibility">
              <option value="public">öffentlich (alle angemeldeten)</option>
              <option value="private">privat (nur Mitglieder)</option>
            </select>
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="busy">Anlegen</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
