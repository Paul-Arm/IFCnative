<script setup lang="ts">
import { PhArrowsClockwise, PhPlus, PhTag } from "@phosphor-icons/vue";

import type { Label } from "~/types/api";

/** Labels verwalten wie bei GitHub: anlegen, umbenennen, umfärben, löschen. */
const project = useProject();
const { slug, canWrite } = project;
const { api } = useApi();
const toast = useToast();
const { confirm } = useConfirm();

const { data, refresh, status } = useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
  { lazy: true },
);
const labels = computed(() =>
  [...(data.value?.labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, "de")),
);

interface Draft {
  id: string | null;
  name: string;
  description: string;
  color: string;
}

const draft = ref<Draft | null>(null);
const busy = ref(false);
const filter = ref("");

const shown = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return labels.value.filter(
    (label) => !needle || `${label.name} ${label.description ?? ""}`.toLowerCase().includes(needle),
  );
});

function startNew(): void {
  draft.value = { id: null, name: "", description: "", color: randomLabelColor() };
}

function startEdit(label: Label): void {
  draft.value = { id: label.id, name: label.name, description: label.description ?? "", color: label.color };
}

async function save(): Promise<void> {
  const value = draft.value;
  if (!value || !value.name.trim()) return;
  busy.value = true;
  try {
    const body = { name: value.name.trim(), description: value.description.trim(), color: value.color };
    if (value.id) {
      await api(`/projects/${slug}/labels/${value.id}`, { method: "PATCH", body });
    } else {
      await api(`/projects/${slug}/labels`, { method: "POST", body });
    }
    draft.value = null;
    await refresh();
    toast.success(value.id ? "Label gespeichert." : `Label „${body.name}“ angelegt.`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    busy.value = false;
  }
}

async function remove(label: Label): Promise<void> {
  const ok = await confirm({
    title: `Label „${label.name}“ löschen?`,
    message: label.issueCount
      ? `Es wird von ${label.issueCount} offenen Issues entfernt.`
      : "Das Label wird von allen Issues entfernt.",
    confirmLabel: "Löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}/labels/${label.id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

/** Filter der Issue-Liste für dieses Label. */
function labelQuery(label: Label): string {
  return `is:open label:${/\s/.test(label.name) ? `"${label.name}"` : label.name}`;
}

const preview = computed(() =>
  draft.value
    ? { name: draft.value.name.trim() || "Label-Vorschau", color: draft.value.color, description: draft.value.description }
    : null,
);
</script>

<template>
  <div class="settings-stack">
    <div class="divided-head labels-head">
      <h2>Labels</h2>
      <span class="spacer" />
      <input v-model="filter" type="search" class="input-sm" placeholder="Labels suchen" style="max-width: 220px" />
      <button v-if="canWrite" type="button" class="btn btn-primary btn-sm" @click="startNew">
        <PhPlus :size="14" /> Neues Label
      </button>
    </div>

    <!-- Editor (neu oder bearbeiten) -->
    <form v-if="draft && !draft.id" class="box label-editor" @submit.prevent="save">
      <div class="box-body">
        <div class="label-preview"><LabelChip :label="preview!" /></div>
        <div class="form-row">
          <div>
            <label class="form-label" for="label-name">Name</label>
            <input id="label-name" v-model="draft.name" type="text" maxlength="40" required autofocus />
          </div>
          <div>
            <label class="form-label" for="label-desc">Beschreibung <span class="muted">(optional)</span></label>
            <input id="label-desc" v-model="draft.description" type="text" maxlength="100" />
          </div>
          <div class="shrink">
            <label class="form-label" for="label-color">Farbe</label>
            <div class="row">
              <button
                type="button"
                class="btn btn-icon"
                aria-label="Zufällige Farbe"
                :style="{ background: draft.color, borderColor: 'transparent', color: labelTextColor(draft.color) }"
                @click="draft.color = randomLabelColor()"
              >
                <PhArrowsClockwise :size="16" />
              </button>
              <input id="label-color" v-model="draft.color" type="color" />
            </div>
          </div>
          <div class="shrink row">
            <button type="button" class="btn" @click="draft = null">Abbrechen</button>
            <button type="submit" class="btn btn-primary" :disabled="busy || !draft.name.trim()">Label anlegen</button>
          </div>
        </div>
      </div>
    </form>

    <div class="box">
      <div class="box-header">
        <span class="box-title">{{ plural(labels.length, "Label", "Labels") }}</span>
      </div>
      <SkeletonRows v-if="status === 'pending' && !data" :rows="3" />
      <Blankslate v-else-if="!labels.length" :icon="PhTag" title="Noch keine Labels" compact>
        Labels ordnen Issues nach Gewerk, Thema oder Dringlichkeit — z. B. „Brandschutz“, „Tragwerk“, „Kollision“.
      </Blankslate>
      <template v-for="label in shown" :key="label.id">
        <form v-if="draft?.id === label.id" class="box-row label-edit-row" @submit.prevent="save">
          <div class="label-edit-grid">
            <div class="label-preview"><LabelChip :label="preview!" /></div>
            <input v-model="draft.name" type="text" maxlength="40" required aria-label="Name" />
            <input v-model="draft.description" type="text" maxlength="100" placeholder="Beschreibung" aria-label="Beschreibung" />
            <input v-model="draft.color" type="color" aria-label="Farbe" />
            <div class="row">
              <button type="button" class="btn btn-sm" @click="draft = null">Abbrechen</button>
              <button type="submit" class="btn btn-sm btn-primary" :disabled="busy">Speichern</button>
            </div>
          </div>
        </form>
        <div v-else class="box-row label-row">
          <div class="label-row-chip"><LabelChip :label="label" /></div>
          <span class="label-row-desc muted">{{ label.description }}</span>
          <NuxtLink
            :to="{ path: `/p/${slug}/issues`, query: { q: labelQuery(label) } }"
            class="label-row-count muted small"
          >
            {{ plural(label.issueCount ?? 0, "offenes Issue", "offene Issues") }}
          </NuxtLink>
          <span v-if="canWrite" class="label-row-actions">
            <button type="button" class="link-btn muted" @click="startEdit(label)">Bearbeiten</button>
            <button type="button" class="link-btn danger" @click="remove(label)">Löschen</button>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
