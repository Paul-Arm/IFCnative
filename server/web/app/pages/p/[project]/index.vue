<script setup lang="ts">
import type { Member, Model, Project, Role } from "~/types/api";

const route = useRoute();
const { api } = useApi();
const { user } = useAuth();
const slug = route.params.project as string;

const { data: projectData, refresh: refreshProject } = await useAsyncData(
  `project-${slug}`,
  () =>
    api<{ project: Project; members: Member[]; role: Role | null }>(
      `/projects/${slug}`,
    ),
);
const { data: modelsData, refresh: refreshModels } = await useAsyncData(
  `models-${slug}`,
  () => api<{ models: Model[] }>(`/projects/${slug}/models`),
);

const isAdmin = computed(
  () =>
    projectData.value?.role === "owner" ||
    projectData.value?.role === "maintainer",
);
const canWrite = computed(
  () => isAdmin.value || projectData.value?.role === "contributor",
);

// ---- create model -----------------------------------------------------

const modelName = ref("");
const modelVisibility = ref<"private" | "public">("private");
const modelError = ref<string | null>(null);
const modelBusy = ref(false);

async function createModel(): Promise<void> {
  modelError.value = null;
  modelBusy.value = true;
  try {
    await api(`/projects/${slug}/models`, {
      method: "POST",
      body: { name: modelName.value, visibility: modelVisibility.value },
    });
    modelName.value = "";
    await refreshModels();
  } catch (e) {
    modelError.value = apiErrorMessage(e);
  } finally {
    modelBusy.value = false;
  }
}

// ---- members ----------------------------------------------------------

const memberEmail = ref("");
const memberRole = ref<Role>("contributor");
const memberError = ref<string | null>(null);
const memberBusy = ref(false);

async function addMember(): Promise<void> {
  memberError.value = null;
  memberBusy.value = true;
  try {
    await api(`/projects/${slug}/members`, {
      method: "POST",
      body: { email: memberEmail.value, role: memberRole.value },
    });
    memberEmail.value = "";
    await refreshProject();
  } catch (e) {
    memberError.value = apiErrorMessage(e);
  } finally {
    memberBusy.value = false;
  }
}

async function changeRole(member: Member, role: Role): Promise<void> {
  memberError.value = null;
  try {
    await api(`/projects/${slug}/members`, {
      method: "POST",
      body: { email: member.user?.email, role },
    });
    await refreshProject();
  } catch (e) {
    memberError.value = apiErrorMessage(e);
  }
}

async function removeMember(member: Member): Promise<void> {
  memberError.value = null;
  try {
    await api(`/projects/${slug}/members/${member.userId}`, {
      method: "DELETE",
    });
    await refreshProject();
  } catch (e) {
    memberError.value = apiErrorMessage(e);
  }
}

const roles: Role[] = ["owner", "maintainer", "contributor", "viewer"];
const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

// ---- delete project ---------------------------------------------------

const isOwner = computed(() => projectData.value?.role === "owner");
const deleteError = ref<string | null>(null);

async function deleteProject(): Promise<void> {
  const project = projectData.value?.project;
  if (!project) return;
  if (
    !window.confirm(
      `Projekt „${project.name}" mit allen Modellen und Versionsständen unwiderruflich löschen?`,
    )
  ) {
    return;
  }
  deleteError.value = null;
  try {
    await api(`/projects/${slug}`, { method: "DELETE" });
    await navigateTo("/");
  } catch (e) {
    deleteError.value = apiErrorMessage(e);
  }
}
</script>

<template>
  <div v-if="projectData">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <strong>{{ projectData.project.name }}</strong>
      <span v-if="projectData.role" class="badge accent">{{ projectData.role }}</span>
    </nav>

    <div class="card">
      <div class="card-header"><h2>Modelle</h2></div>
      <ul v-if="modelsData?.models.length" class="list">
        <li v-for="model in modelsData.models" :key="model.id" class="list-item">
          <div class="list-item-main">
            <NuxtLink :to="`/p/${slug}/m/${model.slug}`" style="font-weight: 600">
              {{ model.name }}
            </NuxtLink>
            <div v-if="model.head" class="muted small">
              Letzter Commit: „{{ model.head.message || "(ohne Nachricht)" }}“
              von {{ model.head.author?.name ?? "?" }}
              am {{ dateFmt.format(new Date(model.head.createdAt)) }}
            </div>
            <div v-else class="muted small">Noch keine Commits</div>
          </div>
          <span class="badge">{{ model.branchCount ?? 0 }} Branches</span>
          <span
            class="badge"
            :class="model.visibility === 'public' ? 'success' : ''"
          >
            {{ model.visibility === "public" ? "öffentlich" : "privat" }}
          </span>
        </li>
      </ul>
      <div v-else class="empty">
        Noch keine Modelle in diesem Projekt. Jedes Modell ist eine IFC-Datei
        mit eigener Versionshistorie — ein Projekt kann beliebig viele davon
        enthalten.
      </div>
    </div>

    <div v-if="canWrite" class="card">
      <div class="card-header"><h2>Neues Modell</h2></div>
      <div class="card-body">
        <p class="muted small" style="margin-top: 0">
          Ein Modell ist eine IFC-Datei mit eigener Versionshistorie und
          eigenen Branches (z.&nbsp;B. Architektur, Tragwerk, TGA).
        </p>
        <div v-if="modelError" class="alert error">{{ modelError }}</div>
        <form class="form-inline" @submit.prevent="createModel">
          <div>
            <label for="model-name">Name</label>
            <input
              id="model-name"
              v-model="modelName"
              type="text"
              required
              placeholder="z.B. Architektur"
            />
          </div>
          <div class="shrink">
            <label for="model-visibility">Sichtbarkeit</label>
            <select id="model-visibility" v-model="modelVisibility">
              <option value="private">privat</option>
              <option value="public">öffentlich</option>
            </select>
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="modelBusy">
              Anlegen
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Mitglieder</h2></div>
      <div v-if="memberError" class="card-body" style="padding-bottom: 0">
        <div class="alert error">{{ memberError }}</div>
      </div>
      <ul class="list">
        <li
          v-for="member in projectData.members"
          :key="member.userId"
          class="list-item"
        >
          <div class="list-item-main">
            <strong>{{ member.user?.name ?? member.userId }}</strong>
            <div class="muted small">{{ member.user?.email }}</div>
          </div>
          <template v-if="isAdmin && member.userId !== projectData.project.ownerId">
            <select
              class="shrink"
              style="width: auto"
              :value="member.role"
              @change="changeRole(member, ($event.target as HTMLSelectElement).value as Role)"
            >
              <option v-for="role in roles" :key="role" :value="role">
                {{ role }}
              </option>
            </select>
            <button
              v-if="member.userId !== user?.id"
              class="danger"
              @click="removeMember(member)"
            >
              Entfernen
            </button>
          </template>
          <span v-else class="badge accent">{{ member.role }}</span>
        </li>
      </ul>
      <div v-if="isAdmin" class="card-body" style="border-top: 1px solid var(--border)">
        <form class="form-inline" @submit.prevent="addMember">
          <div>
            <label for="member-email">E-Mail (registrierter Benutzer)</label>
            <input
              id="member-email"
              v-model="memberEmail"
              type="email"
              required
              placeholder="kollege@firma.de"
            />
          </div>
          <div class="shrink">
            <label for="member-role">Rolle</label>
            <select id="member-role" v-model="memberRole">
              <option value="maintainer">maintainer</option>
              <option value="contributor">contributor</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="memberBusy">
              Hinzufügen
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOwner" class="card" style="border-color: var(--danger)">
      <div class="card-header">
        <h2 style="color: var(--danger)">Gefahrenzone</h2>
      </div>
      <div class="card-body">
        <div v-if="deleteError" class="alert error">{{ deleteError }}</div>
        <p class="muted small" style="margin-top: 0">
          Löscht das Projekt mit allen Modellen, Branches und Versionsständen —
          unwiderruflich.
        </p>
        <button class="danger" @click="deleteProject">Projekt löschen</button>
      </div>
    </div>
  </div>
</template>
