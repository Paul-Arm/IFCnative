<script setup lang="ts">
import {
  PhCalendarBlank,
  PhCube,
  PhCubeTransparent,
  PhFiles,
  PhGitCommit,
  PhPencilSimple,
  PhRecord,
  PhShieldCheck,
  PhUsers,
} from "@phosphor-icons/vue";

/**
 * Seitenleiste der Projekt-Startseite („About“ bei GitHub): Beschreibung,
 * Kennzahlen, Dateiarten, Mitwirkende, Prüfergebnisse, Projektbild.
 */
const project = useProject();
const { detail, stats, models, isAdmin, slug } = project;
const { api } = useApi();
const toast = useToast();
const { load, imageFor } = useProjectImage();

const kinds = computed(() => {
  if (stats.value?.kinds.length) return stats.value.kinds;
  // Fallback ohne Stats-Endpunkt: aus der Modellliste zählen.
  const map = new Map<string, number>();
  for (const model of models.value ?? []) {
    const ext = model.kind === "ifc" ? "ifc" : model.kind === "md" ? "md" : fileExtension(model.name);
    map.set(ext, (map.get(ext) ?? 0) + 1);
  }
  return [...map.entries()].map(([extension, count]) => ({ extension, count }));
});

const fileCount = computed(() => models.value?.length ?? 0);
const ifcCount = computed(() => (models.value ?? []).filter((m) => m.kind === "ifc").length);

const checks = computed(() => {
  const runs = stats.value?.runs;
  if (!runs?.total) return null;
  const done = runs.success + runs.failed + runs.error;
  return {
    ...runs,
    rate: done ? Math.round((runs.success / done) * 100) : null,
  };
});

const hasImage = computed(() => detail.value?.project.hasImage ?? false);
watch(
  hasImage,
  (value) => {
    if (value) load(slug);
  },
  { immediate: true },
);
const image = computed(() => imageFor(slug));

// ---- Beschreibung bearbeiten ---------------------------------------------

const editOpen = ref(false);
const draft = ref("");
const saving = ref(false);

function openEdit(): void {
  draft.value = detail.value?.project.description ?? "";
  editOpen.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    await api(`/projects/${slug}`, {
      method: "PATCH",
      body: { description: draft.value.trim() },
    });
    await project.refreshProject();
    editOpen.value = false;
    toast.success("Beschreibung gespeichert.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <aside class="about">
    <section class="about-section">
      <div class="about-head">
        <h2>Info</h2>
        <button
          v-if="isAdmin"
          type="button"
          class="btn btn-invisible btn-sm btn-icon"
          aria-label="Beschreibung bearbeiten"
          data-tip="Beschreibung bearbeiten"
          @click="openEdit"
        >
          <PhPencilSimple :size="16" />
        </button>
      </div>
      <p v-if="detail?.project.description" class="about-desc">
        {{ detail.project.description }}
      </p>
      <p v-else class="about-desc muted">
        <template v-if="isAdmin">
          Noch keine Beschreibung —
          <button type="button" class="link-btn" @click="openEdit">jetzt ergänzen</button>.
        </template>
        <template v-else>Keine Beschreibung.</template>
      </p>

      <ul class="about-facts">
        <li>
          <PhFiles :size="16" />
          <strong>{{ formatNumber(fileCount) }}</strong>
          {{ fileCount === 1 ? "Datei" : "Dateien" }}
          <span v-if="ifcCount" class="muted">· {{ ifcCount }} IFC</span>
        </li>
        <li v-if="stats">
          <PhGitCommit :size="16" />
          <strong>{{ formatNumber(stats.commitCount) }}</strong>
          {{ stats.commitCount === 1 ? "Commit" : "Commits" }}
        </li>
        <li v-if="stats?.entityCount">
          <PhCube :size="16" />
          <strong>{{ formatCompact(stats.entityCount) }}</strong> IFC-Entities
        </li>
        <li>
          <PhUsers :size="16" />
          <strong>{{ detail?.members.length ?? 0 }}</strong>
          {{ (detail?.members.length ?? 0) === 1 ? "Mitglied" : "Mitglieder" }}
        </li>
        <li v-if="stats">
          <PhRecord :size="16" />
          <NuxtLink :to="`/p/${slug}/issues`">
            <strong>{{ stats.issues.open }}</strong> offene Issues
          </NuxtLink>
        </li>
        <li v-if="detail">
          <PhCalendarBlank :size="16" />
          angelegt <RelTime :date="detail.project.createdAt" />
        </li>
      </ul>
    </section>

    <section v-if="kinds.length" class="about-section">
      <h2>Dateiarten</h2>
      <FileTypeBar :kinds="kinds" />
    </section>

    <section v-if="stats?.contributors.length" class="about-section">
      <h2>
        Mitwirkende <span class="counter">{{ stats.contributors.length }}</span>
      </h2>
      <div class="about-contributors">
        <span
          v-for="entry in stats.contributors.slice(0, 14)"
          :key="entry.user?.id ?? 'unknown'"
          :data-tip="`${entry.user?.name ?? 'Unbekannt'} · ${entry.commits} ${entry.commits === 1 ? 'Commit' : 'Commits'}`"
        >
          <UserAvatar :user="entry.user" :size="32" :titled="false" />
        </span>
      </div>
    </section>

    <section v-if="checks" class="about-section">
      <h2>Prüfungen</h2>
      <div class="about-checks">
        <PhShieldCheck :size="16" />
        <span>
          <strong>{{ checks.success }}</strong> bestanden ·
          <strong :class="{ 'color-danger': checks.failed }">{{ checks.failed }}</strong> fehlgeschlagen
          <template v-if="checks.running + checks.queued"> · {{ checks.running + checks.queued }} laufen</template>
        </span>
      </div>
      <div class="meter" style="margin-top: 8px">
        <span :style="{ width: `${(checks.success / checks.total) * 100}%`, background: 'var(--success-emphasis)' }" />
        <span :style="{ width: `${(checks.failed / checks.total) * 100}%`, background: 'var(--danger-emphasis)' }" />
        <span :style="{ width: `${(checks.error / checks.total) * 100}%`, background: 'var(--attention-emphasis)' }" />
      </div>
      <p v-if="checks.rate !== null" class="muted small" style="margin: 6px 0 0">
        Erfolgsquote {{ checks.rate }} % über {{ checks.total }} Runs
      </p>
    </section>

    <section v-if="image" class="about-section">
      <h2>Szene</h2>
      <NuxtLink :to="`/p/${slug}/3d`" class="about-image" title="3D-Szene öffnen">
        <img :src="image" alt="3D-Szene des Projekts" />
        <span class="about-image-cta"><PhCubeTransparent :size="14" /> 3D öffnen</span>
      </NuxtLink>
    </section>

    <UiDialog v-model:open="editOpen" title="Projektbeschreibung" :persistent="saving">
      <form @submit.prevent="save">
        <label class="form-label" for="about-description">Beschreibung</label>
        <textarea
          id="about-description"
          v-model="draft"
          maxlength="500"
          rows="4"
          placeholder="Worum geht es in diesem Projekt? z. B. Ersatzneubau Brücke Nord, LPH 5"
        />
        <p class="form-hint">{{ draft.length }}/500 Zeichen · erscheint im Dashboard und in der Suche.</p>
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="saving" @click="editOpen = false">Abbrechen</button>
        <button type="button" class="btn btn-primary" :disabled="saving" @click="save">
          <span v-if="saving" class="spinner" />
          Speichern
        </button>
      </template>
    </UiDialog>
  </aside>
</template>
