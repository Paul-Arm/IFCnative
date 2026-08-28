<script setup lang="ts">
import {
  PhCheckCircle,
  PhPencilSimple,
  PhRecord,
} from "@phosphor-icons/vue";

import type { Issue, Label, Member, Model, Project, Role } from "~/types/api";

const route = useRoute();
const { api } = useApi();
const { user } = useAuth();
const slug = route.params.project as string;
const number = Number(route.params.number);

const { data: issueData, refresh } = await useAsyncData(
  `issue-${slug}-${number}`,
  () => api<{ issue: Issue }>(`/projects/${slug}/issues/${number}`),
);
const { data: projectData } = await useAsyncData(`project-role-${slug}`, () =>
  api<{
    project: Project;
    members: Member[];
    role: Role | null;
    folders: string[];
  }>(`/projects/${slug}`),
);
const { data: modelsData } = await useAsyncData(`models-${slug}`, () =>
  api<{ models: Model[] }>(`/projects/${slug}/models`),
);
const { data: labelsData } = await useAsyncData(`labels-${slug}`, () =>
  api<{ labels: Label[] }>(`/projects/${slug}/labels`),
);

const issue = computed(() => issueData.value?.issue ?? null);
const canEdit = computed(() => {
  const role = projectData.value?.role;
  const writeRole =
    role === "owner" || role === "maintainer" || role === "contributor";
  return writeRole || issue.value?.authorId === user.value?.id;
});

const bodyHtml = computed(() =>
  issue.value?.body ? renderMarkdown(issue.value.body) : null,
);

const error = ref<string | null>(null);

async function patchIssue(patch: Record<string, unknown>): Promise<void> {
  error.value = null;
  try {
    await api(`/projects/${slug}/issues/${number}`, {
      method: "PATCH",
      body: patch,
    });
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

// ---- Titel/Body bearbeiten --------------------------------------------

const editing = ref(false);
const editTitle = ref("");
const editBody = ref("");

function startEdit(): void {
  editTitle.value = issue.value?.title ?? "";
  editBody.value = issue.value?.body ?? "";
  editing.value = true;
}

async function saveEdit(): Promise<void> {
  await patchIssue({ title: editTitle.value, body: editBody.value });
  editing.value = false;
}

// ---- Zuordnungen (sofort speichern) ------------------------------------

function idsWithToggle(current: string[], id: string, on: boolean): string[] {
  const set = new Set(current);
  if (on) {
    set.add(id);
  } else {
    set.delete(id);
  }
  return [...set];
}

function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2328" : "#ffffff";
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "long",
  timeStyle: "short",
});
</script>

<template>
  <div v-if="issue">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">
        {{ projectData?.project.name ?? slug }}
      </NuxtLink>
      <span>/</span>
      <NuxtLink :to="{ path: `/p/${slug}`, query: { tab: 'issues' } }">
        Issues
      </NuxtLink>
      <span>/</span>
      <strong>#{{ issue.number }}</strong>
    </nav>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="card">
      <div class="card-header">
        <span class="issue-state" :class="issue.state">
          <PhRecord v-if="issue.state === 'open'" :size="18" />
          <PhCheckCircle v-else :size="18" weight="fill" />
        </span>
        <h2 style="margin: 0">
          {{ issue.title }}
          <span class="muted">#{{ issue.number }}</span>
        </h2>
        <span class="topbar-spacer" />
        <button v-if="canEdit && !editing" @click="startEdit">
          <PhPencilSimple :size="14" aria-hidden="true" />
          Bearbeiten
        </button>
        <button
          v-if="canEdit"
          @click="patchIssue({ state: issue.state === 'open' ? 'closed' : 'open' })"
        >
          {{ issue.state === "open" ? "Schließen" : "Wieder öffnen" }}
        </button>
      </div>
      <div class="card-body">
        <div class="muted small" style="margin-bottom: 0.6rem">
          <strong>{{ issue.author?.name ?? "?" }}</strong> eröffnete am
          {{ dateFmt.format(new Date(issue.createdAt)) }}
          <template v-if="issue.updatedAt !== issue.createdAt">
            · aktualisiert {{ dateFmt.format(new Date(issue.updatedAt)) }}
          </template>
        </div>

        <template v-if="!editing">
          <div v-if="bodyHtml" class="markdown-body" v-html="bodyHtml"></div>
          <p v-else class="muted">Keine Beschreibung.</p>
        </template>
        <template v-else>
          <div class="form-row">
            <label for="edit-title">Titel</label>
            <input id="edit-title" v-model="editTitle" type="text" required />
          </div>
          <div class="form-row">
            <label for="edit-body">Beschreibung (Markdown)</label>
            <textarea id="edit-body" v-model="editBody" rows="8"></textarea>
          </div>
          <div class="form-inline">
            <button class="primary" @click="saveEdit">Speichern</button>
            <button @click="editing = false">Abbrechen</button>
          </div>
        </template>
      </div>
    </div>

    <div class="issue-sidebar-grid">
      <div class="card">
        <div class="card-header"><h3 style="margin: 0">Zugewiesen an</h3></div>
        <div class="card-body issue-picker">
          <label
            v-for="member in projectData?.members ?? []"
            :key="member.userId"
            class="pv-item"
          >
            <input
              type="checkbox"
              :disabled="!canEdit"
              :checked="issue.assignees.some((a) => a.id === member.userId)"
              @change="
                patchIssue({
                  assigneeIds: idsWithToggle(
                    issue.assignees.map((a) => a.id),
                    member.userId,
                    ($event.target as HTMLInputElement).checked,
                  ),
                })
              "
            />
            <span class="pv-label">{{ member.user?.name ?? member.userId }}</span>
          </label>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 style="margin: 0">Modelle</h3></div>
        <div class="card-body issue-picker">
          <label
            v-for="model in modelsData?.models ?? []"
            :key="model.id"
            class="pv-item"
          >
            <input
              type="checkbox"
              :disabled="!canEdit"
              :checked="issue.models.some((m) => m.id === model.id)"
              @change="
                patchIssue({
                  modelIds: idsWithToggle(
                    issue.models.map((m) => m.id),
                    model.id,
                    ($event.target as HTMLInputElement).checked,
                  ),
                })
              "
            />
            <span class="pv-label">
              {{ model.folder ? `${model.folder}/` : "" }}
              <NuxtLink :to="`/p/${slug}/m/${model.slug}`">
                {{ model.name }}
              </NuxtLink>
            </span>
          </label>
          <p v-if="!(modelsData?.models ?? []).length" class="muted small">
            Keine Modelle im Projekt.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 style="margin: 0">Labels</h3></div>
        <div class="card-body issue-picker">
          <label
            v-for="label in labelsData?.labels ?? []"
            :key="label.id"
            class="pv-item"
          >
            <input
              type="checkbox"
              :disabled="!canEdit"
              :checked="issue.labels.some((l) => l.id === label.id)"
              @change="
                patchIssue({
                  labelIds: idsWithToggle(
                    issue.labels.map((l) => l.id),
                    label.id,
                    ($event.target as HTMLInputElement).checked,
                  ),
                })
              "
            />
            <span
              class="label-chip"
              :style="{
                backgroundColor: label.color,
                color: labelTextColor(label.color),
              }"
            >{{ label.name }}</span>
          </label>
          <p v-if="!(labelsData?.labels ?? []).length" class="muted small">
            Noch keine Labels — im Issues-Tab anlegen.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
