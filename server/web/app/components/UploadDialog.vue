<script setup lang="ts">
import {
  PhArrowClockwise,
  PhCheckCircle,
  PhPlus,
  PhUploadSimple,
  PhWarningCircle,
  PhX,
} from "@phosphor-icons/vue";

import type { Model } from "~/types/api";

/**
 * Dateien hochladen wie bei GitHub: mehrere auf einmal, per Drag & Drop.
 * Gibt es im Zielordner schon eine gleichnamige Datei, wird eine neue
 * Version committet — sonst entsteht ein neues Modell (IFC, Markdown oder
 * beliebige Datei, je nach Endung).
 */
const props = defineProps<{
  open: boolean;
  slug: string;
  folder: string;
  models: Model[];
  /** Beim Öffnen schon übergebene Dateien (Drop auf die Dateiliste). */
  initialFiles?: File[];
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "done", models: Model[]): void;
}>();

type ItemStatus = "pending" | "uploading" | "processing" | "done" | "error";

interface UploadItem {
  id: number;
  file: File;
  existing: Model | null;
  /** Beim Fehlversuch angelegtes leeres Modell, das nicht gelöscht werden durfte. */
  orphan: Model | null;
  status: ItemStatus;
  percent: number;
  error: string | null;
  model: Model | null;
}

const { api } = useApi();
const { token } = useAuth();
const toast = useToast();

const items = ref<UploadItem[]>([]);
const message = ref("");
const dragOver = ref(false);
const busy = ref(false);
let nextId = 1;

const folderLabel = computed(() => (props.folder ? `/${props.folder}` : "Projektwurzel"));

function existingFor(file: File): Model | null {
  return (
    props.models.find(
      (model) =>
        (model.folder ?? "") === props.folder &&
        model.name.toLowerCase() === file.name.toLowerCase(),
    ) ?? null
  );
}

function addFiles(list: FileList | File[] | null | undefined): void {
  if (!list) return;
  for (const file of Array.from(list)) {
    if (items.value.some((item) => item.file.name === file.name && item.status !== "done")) {
      continue;
    }
    items.value.push({
      id: nextId++,
      file,
      existing: existingFor(file),
      orphan: null,
      status: "pending",
      percent: 0,
      error: null,
      model: null,
    });
  }
}

function remove(item: UploadItem): void {
  items.value = items.value.filter((entry) => entry !== item);
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  addFiles(input.files);
  input.value = "";
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  addFiles(event.dataTransfer?.files);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      items.value = [];
      message.value = "";
      addFiles(props.initialFiles);
    }
  },
  { immediate: true },
);

const pendingItems = computed(() =>
  items.value.filter((item) => item.status === "pending" || item.status === "error"),
);
const doneCount = computed(() => items.value.filter((item) => item.status === "done").length);

async function uploadOne(item: UploadItem): Promise<void> {
  item.status = "uploading";
  item.percent = 0;
  item.error = null;
  let created: Model | null = null;
  try {
    let target = item.existing ?? item.orphan;
    if (!target) {
      created = await createModelForFile(api, props.slug, item.file, props.folder);
      target = created;
    }
    const text =
      message.value.trim() ||
      (item.existing ? `${item.file.name} aktualisiert` : `${item.file.name} hinzugefügt`);
    await uploadCommit({
      slug: props.slug,
      modelSlug: target.slug,
      file: item.file,
      message: text,
      token: token.value,
      onProgress: (percent) => {
        item.percent = percent;
        if (percent >= 100) item.status = "processing";
      },
    });
    item.model = target;
    item.status = "done";
  } catch (e) {
    // Kein leeres Modell zurücklassen. Löschen braucht die Admin-Rolle — klappt
    // es nicht, committet ein erneuter Versuch in dieses Modell (sonst 409).
    if (created) {
      const removed = await api(`/projects/${props.slug}/models/${created.slug}`, { method: "DELETE" }).then(
        () => true,
        () => false,
      );
      if (!removed) item.orphan = created;
    }
    item.status = "error";
    item.error = e instanceof Error ? e.message : apiErrorMessage(e);
  }
}

async function start(): Promise<void> {
  if (busy.value || !pendingItems.value.length) return;
  busy.value = true;
  for (const item of pendingItems.value) {
    await uploadOne(item);
  }
  busy.value = false;
  const done = items.value.filter((item) => item.status === "done" && item.model);
  const failed = items.value.filter((item) => item.status === "error").length;
  if (done.length) {
    emit("done", done.map((item) => item.model!));
  }
  if (!failed && done.length) {
    const single = done.length === 1 ? done[0]!.model! : null;
    toast.success(
      single
        ? `${single.name} hochgeladen.`
        : `${done.length} Dateien hochgeladen.`,
      single ? { action: { label: "Öffnen", to: `/p/${props.slug}/m/${single.slug}` } } : {},
    );
    emit("update:open", false);
  }
}

function close(): void {
  if (!busy.value) emit("update:open", false);
}
</script>

<template>
  <UiDialog
    :open="open"
    size="md"
    title="Dateien hochladen"
    :subtitle="`Ziel: ${folderLabel} — gleichnamige Dateien werden als neue Version committet.`"
    :persistent="busy"
    @update:open="(value) => !value && close()"
  >
    <label
      class="dropzone"
      :class="{ over: dragOver, busy }"
      for="upload-dialog-input"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        id="upload-dialog-input"
        class="dropzone-input"
        type="file"
        multiple
        :disabled="busy"
        @change="onInput"
      />
      <PhUploadSimple :size="28" />
      <strong>Dateien hierher ziehen</strong>
      <span class="small">oder klicken zum Auswählen · IFC, Markdown, PDF, Word, DWG/DXF, Bilder …</span>
    </label>

    <ul v-if="items.length" class="upload-list">
      <li v-for="item in items" :key="item.id" class="upload-item" :class="item.status">
        <ModelIcon :kind="modelKindForFile(item.file.name)" :name="item.file.name" :size="20" />
        <div class="upload-item-main">
          <div class="upload-item-name">
            <span class="truncate">{{ item.file.name }}</span>
            <span v-if="item.existing" class="tag tag-attention" title="Datei existiert bereits — wird als neue Version committet">
              <PhArrowClockwise :size="11" /> neue Version
            </span>
            <span v-else class="tag tag-success"><PhPlus :size="11" /> neu</span>
          </div>
          <div class="upload-item-sub">
            <template v-if="item.status === 'error'">
              <span class="color-danger">{{ item.error }}</span>
            </template>
            <template v-else-if="item.status === 'processing'">
              {{ modelKindForFile(item.file.name) === "ifc" ? "Server analysiert das Modell …" : "Server speichert …" }}
            </template>
            <template v-else>
              {{ formatFileSize(item.file.size) }}
            </template>
          </div>
          <span
            v-if="item.status === 'uploading' || item.status === 'processing'"
            class="progress"
            :class="{ indeterminate: item.status === 'processing' }"
          >
            <span :style="{ width: item.status === 'processing' ? undefined : `${item.percent}%` }" />
          </span>
        </div>
        <span class="upload-item-state">
          <PhCheckCircle v-if="item.status === 'done'" :size="18" weight="fill" class="color-success" />
          <PhWarningCircle v-else-if="item.status === 'error'" :size="18" weight="fill" class="color-danger" />
          <span v-else-if="item.status !== 'pending'" class="spinner" />
          <button
            v-else
            type="button"
            class="btn btn-invisible btn-xs btn-icon"
            :disabled="busy"
            aria-label="Entfernen"
            @click="remove(item)"
          >
            <PhX :size="14" />
          </button>
        </span>
      </li>
    </ul>

    <div class="form-group" style="margin: 16px 0 0">
      <label class="form-label" for="upload-message">
        Commit-Nachricht <span class="muted">(optional)</span>
      </label>
      <input
        id="upload-message"
        v-model="message"
        type="text"
        :disabled="busy"
        placeholder="z. B. Planstand KW 39 eingespielt"
      />
    </div>

    <template #footer>
      <span v-if="doneCount" class="muted small" style="margin-right: auto">
        {{ doneCount }} von {{ items.length }} fertig
      </span>
      <button type="button" class="btn" :disabled="busy" @click="close">
        {{ doneCount ? "Schließen" : "Abbrechen" }}
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="busy || !pendingItems.length"
        @click="start"
      >
        <span v-if="busy" class="spinner" />
        <PhUploadSimple v-else :size="16" />
        {{
          busy
            ? "Wird hochgeladen …"
            : pendingItems.length > 1
              ? `${pendingItems.length} Dateien committen`
              : "Committen"
        }}
      </button>
    </template>
  </UiDialog>
</template>

<style scoped>
.upload-list {
  display: flex;
  flex-direction: column;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.upload-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
}

.upload-item + .upload-item {
  border-top: 1px solid var(--border-muted);
}

.upload-item.done {
  background: var(--success-subtle);
}

.upload-item.error {
  background: var(--danger-subtle);
}

.upload-item-main {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.upload-item-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-weight: 600;
}

.upload-item-sub {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.upload-item .progress {
  max-width: none;
  margin-top: 2px;
}

.upload-item-state {
  display: inline-flex;
  flex-shrink: 0;
}
</style>
