<script setup lang="ts">
import { PhGlobeSimple, PhImage, PhLockSimple, PhTrash, PhUploadSimple } from "@phosphor-icons/vue";

/** Allgemeine Projekteinstellungen + Gefahrenzone. */
const project = useProject();
const { slug, detail, isAdmin, isOwner } = project;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();
const { load: loadImage, imageFor, forget } = useProjectImage();

const name = ref("");
const description = ref("");
const saving = ref(false);

// Server-Stand nur in Felder übernehmen, die gerade nicht bearbeitet werden —
// das Projekt wird auch nach Bild-Upload oder Sichtbarkeitswechsel neu geladen.
let synced = { name: "", description: "" };
watch(
  () => detail.value?.project,
  (value) => {
    if (!value) return;
    const next = { name: value.name, description: value.description ?? "" };
    if (name.value === synced.name) name.value = next.name;
    if (description.value === synced.description) description.value = next.description;
    synced = next;
    if (value.hasImage) loadImage(slug);
  },
  { immediate: true },
);

const dirty = computed(
  () =>
    Boolean(detail.value) &&
    (name.value.trim() !== detail.value!.project.name ||
      description.value.trim() !== (detail.value!.project.description ?? "")),
);

async function save(): Promise<void> {
  if (!name.value.trim()) return;
  saving.value = true;
  try {
    await api(`/projects/${slug}`, {
      method: "PATCH",
      body: { name: name.value.trim(), description: description.value.trim() },
    });
    await project.refreshProject();
    toast.success("Einstellungen gespeichert.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    saving.value = false;
  }
}

/** Neu rendern, damit abgebrochene Radio-Wechsel zurückspringen. */
const visibilityKey = ref(0);

async function setVisibility(visibility: "private" | "public"): Promise<void> {
  if (detail.value?.project.visibility === visibility) return;
  const ok = await confirm({
    title: visibility === "private" ? "Projekt privat schalten?" : "Projekt öffentlich schalten?",
    message:
      visibility === "private"
        ? "Nur noch Mitglieder sehen das Projekt. Angemeldete Nicht-Mitglieder verlieren den Lesezugriff."
        : "Alle angemeldeten Benutzer können das Projekt dann lesen (implizite viewer-Rolle).",
    confirmLabel: visibility === "private" ? "Privat schalten" : "Öffentlich schalten",
  });
  if (!ok) {
    visibilityKey.value += 1;
    return;
  }
  try {
    await api(`/projects/${slug}`, { method: "PATCH", body: { visibility } });
    await project.refreshProject();
    toast.success(visibility === "private" ? "Projekt ist jetzt privat." : "Projekt ist jetzt öffentlich.");
  } catch (e) {
    visibilityKey.value += 1;
    toast.error(apiErrorMessage(e));
  }
}

// ---- Projektbild ---------------------------------------------------------------

const imageBusy = ref(false);

async function uploadImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.type !== "image/png") {
    toast.error("Bitte ein PNG-Bild wählen (max. 5 MB).");
    return;
  }
  imageBusy.value = true;
  try {
    await $fetch(`/api/projects/${slug}/image`, {
      method: "PUT",
      body: file,
      headers: {
        "content-type": "image/png",
        ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
      },
    });
    forget(slug);
    loadImage(slug, true);
    await project.refreshProject();
    toast.success("Projektbild aktualisiert.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    imageBusy.value = false;
  }
}

// ---- Löschen ---------------------------------------------------------------------

async function deleteProject(): Promise<void> {
  const value = detail.value?.project;
  if (!value) return;
  const ok = await confirm({
    title: `„${value.name}“ endgültig löschen?`,
    message:
      "Alle Modelle, Dateien, Versionsstände, Issues und Prüf-Runs werden unwiderruflich gelöscht.",
    confirmLabel: "Projekt löschen",
    danger: true,
    typeToConfirm: value.slug,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}`, { method: "DELETE" });
    useRecent().forget(`/p/${slug}`);
    toast.success(`Projekt „${value.name}“ gelöscht.`);
    await navigateTo("/");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}
</script>

<template>
  <div v-if="detail" class="settings-stack">
    <div class="divided-head"><h2>Allgemein</h2></div>

    <form class="settings-form" @submit.prevent="save">
      <div class="form-group">
        <label class="form-label" for="project-name">Projektname</label>
        <input id="project-name" v-model="name" type="text" :disabled="!isAdmin" required style="max-width: 420px" />
        <p class="form-hint">
          Die Adresse bleibt <code>/p/{{ detail.project.slug }}</code> — Links und Lesezeichen funktionieren weiter.
        </p>
      </div>
      <div class="form-group">
        <label class="form-label" for="project-description">Beschreibung</label>
        <textarea
          id="project-description"
          v-model="description"
          rows="3"
          maxlength="500"
          :disabled="!isAdmin"
          placeholder="Worum geht es? Erscheint in der Info-Leiste, im Dashboard und in der Suche."
        />
      </div>
      <div v-if="isAdmin" class="form-actions start">
        <button type="submit" class="btn btn-primary" :disabled="saving || !dirty">
          <span v-if="saving" class="spinner" /> Speichern
        </button>
      </div>
    </form>

    <div class="divided-head"><h2>Projektbild</h2></div>
    <div class="settings-image">
      <ProjectMark :project="detail.project" :size="120" :radius="12" />
      <div>
        <p class="muted" style="margin-top: 0">
          Das Bild erscheint auf der Projektkarte. Am schnellsten entsteht es in der
          <NuxtLink :to="`/p/${slug}/3d`">3D-Szene</NuxtLink> über „Als Projektbild“ — oder lade ein PNG hoch.
        </p>
        <label v-if="isAdmin" class="btn file-btn" :class="{ disabled: imageBusy }">
          <span v-if="imageBusy" class="spinner" />
          <PhUploadSimple v-else :size="16" />
          PNG hochladen
          <input type="file" accept="image/png" @change="uploadImage" />
        </label>
        <span v-if="imageFor(slug)" class="muted small" style="margin-left: 8px">
          <PhImage :size="14" style="vertical-align: -2px" /> Bild hinterlegt
        </span>
      </div>
    </div>

    <div class="divided-head"><h2>Sichtbarkeit</h2></div>
    <div :key="visibilityKey" class="choice-list" style="max-width: 640px">
      <label class="choice">
        <input
          type="radio"
          name="visibility"
          :checked="detail.project.visibility === 'public'"
          :disabled="!isAdmin"
          @change="setVisibility('public')"
        />
        <span class="choice-icon"><PhGlobeSimple :size="20" /></span>
        <span class="choice-text">
          <strong>Öffentlich</strong>
          <span>Alle angemeldeten Benutzer können das Projekt sehen (lesend). Schreiben dürfen nur Mitglieder.</span>
        </span>
      </label>
      <label class="choice">
        <input
          type="radio"
          name="visibility"
          :checked="detail.project.visibility === 'private'"
          :disabled="!isAdmin"
          @change="setVisibility('private')"
        />
        <span class="choice-icon"><PhLockSimple :size="20" /></span>
        <span class="choice-text">
          <strong>Privat</strong>
          <span>Nur Mitglieder sehen das Projekt — für Nicht-Mitglieder existiert es nicht.</span>
        </span>
      </label>
    </div>

    <template v-if="isOwner">
      <div class="divided-head danger-head"><h2>Gefahrenzone</h2></div>
      <div class="box box-danger">
        <div class="box-row danger-row">
          <div>
            <strong>Projekt löschen</strong>
            <p class="muted small" style="margin: 2px 0 0">
              Einmal gelöscht, gibt es kein Zurück. Bitte sicher sein.
            </p>
          </div>
          <button type="button" class="btn btn-danger" @click="deleteProject">
            <PhTrash :size="16" /> Projekt löschen
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
