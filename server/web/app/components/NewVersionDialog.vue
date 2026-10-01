<script setup lang="ts">
import { PhGitBranch, PhUploadSimple } from "@phosphor-icons/vue";

import type { Branch, Commit, Model } from "~/types/api";

/**
 * Neuen Stand eines Modells committen: Datei (per Drop), Nachricht, Branch
 * (bestehend oder neu). Upload mit Fortschritt; bei IFC analysiert der
 * Server danach die Änderungen.
 */
const props = defineProps<{
  open: boolean;
  slug: string;
  model: Model;
  branches: Branch[];
  branch: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "committed", commit: Commit): void;
}>();

const { token } = useAuth();

const file = ref<File | null>(null);
const message = ref("");
const target = ref("");
const newBranch = ref("");
const error = ref<string | null>(null);
const busy = ref(false);
const percent = ref<number | null>(null);
const dragOver = ref(false);

const isIfc = computed(() => props.model.kind === "ifc");
const extension = computed(() => fileExtension(props.model.name));
const accept = computed(() => {
  if (isIfc.value) return ".ifc,application/x-step";
  if (props.model.kind === "md") return ".md,.markdown,text/markdown";
  return extension.value ? `.${extension.value}` : undefined;
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      file.value = null;
      message.value = "";
      error.value = null;
      percent.value = null;
      target.value = props.branch || props.model.defaultBranch;
      newBranch.value = "";
    }
  },
  { immediate: true },
);

function setFile(next: File | null): void {
  if (!next) return;
  if (isIfc.value && !/\.ifc$/i.test(next.name)) {
    error.value = "Bitte eine .ifc-Datei wählen.";
    return;
  }
  // Content-Type und Vorschau hängen an der Endung des Modellnamens — eine
  // neue Version muss dieselbe Dateiart haben (der Server prüft das auch).
  if (props.model.kind === "file" && extension.value && fileExtension(next.name) !== extension.value) {
    error.value = `Bitte eine .${extension.value}-Datei wählen — die Dateiart bleibt über alle Versionen gleich.`;
    return;
  }
  error.value = null;
  file.value = next;
}

async function submit(): Promise<void> {
  if (!file.value || busy.value) return;
  const branch = target.value === "__new__" ? newBranch.value.trim() : target.value;
  if (!branch) {
    error.value = "Name des neuen Branch fehlt.";
    return;
  }
  busy.value = true;
  error.value = null;
  percent.value = 0;
  try {
    const { commit } = await uploadCommit({
      slug: props.slug,
      modelSlug: props.model.slug,
      file: file.value,
      message: message.value.trim(),
      branch,
      token: token.value,
      onProgress: (value) => (percent.value = value),
    });
    emit("committed", commit);
    emit("update:open", false);
  } catch (e) {
    error.value = e instanceof Error ? e.message : apiErrorMessage(e);
  } finally {
    busy.value = false;
    percent.value = null;
  }
}
</script>

<template>
  <UiDialog
    :open="open"
    size="md"
    :title="isIfc ? 'Neuen Stand committen' : 'Neue Version hochladen'"
    :subtitle="model.name"
    :persistent="busy"
    @update:open="(value) => emit('update:open', value)"
  >
    <form @submit.prevent="submit">
      <div v-if="error" class="flash flash-danger flash-sm">{{ error }}</div>
      <label
        class="dropzone"
        :class="{ over: dragOver, filled: !!file, busy }"
        for="new-version-file"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="
          dragOver = false;
          setFile($event.dataTransfer?.files?.[0] ?? null);
        "
      >
        <input
          id="new-version-file"
          class="dropzone-input"
          type="file"
          :accept="accept"
          :disabled="busy"
          @change="setFile(($event.target as HTMLInputElement).files?.[0] ?? null)"
        />
        <PhUploadSimple :size="28" />
        <template v-if="file">
          <strong>{{ file.name }}</strong>
          <span class="small">{{ formatFileSize(file.size) }} · andere Datei wählen</span>
        </template>
        <template v-else>
          <strong>{{ isIfc ? "IFC-Datei" : "Datei" }} hierher ziehen</strong>
          <span class="small">oder klicken, um eine Datei zu wählen</span>
        </template>
      </label>

      <div class="form-group" style="margin-top: 16px">
        <label class="form-label" for="new-version-message">Was hat sich geändert?</label>
        <input
          id="new-version-message"
          v-model="message"
          type="text"
          :disabled="busy"
          placeholder="z. B. Brandschutzklassen der Innenwände ergänzt"
        />
      </div>

      <div class="form-row">
        <div class="shrink">
          <label class="form-label" for="new-version-branch">
            <PhGitBranch :size="14" style="vertical-align: -2px" /> Branch
          </label>
          <select id="new-version-branch" v-model="target" class="auto" :disabled="busy">
            <option v-for="entry in branches" :key="entry.id" :value="entry.name">{{ entry.name }}</option>
            <option v-if="!branches.length" :value="model.defaultBranch">{{ model.defaultBranch }}</option>
            <option value="__new__">Neuer Branch …</option>
          </select>
        </div>
        <div v-if="target === '__new__'">
          <label class="form-label" for="new-version-newbranch">Name des neuen Branch</label>
          <input id="new-version-newbranch" v-model="newBranch" type="text" placeholder="variante-c" :disabled="busy" />
        </div>
      </div>

      <div v-if="busy" class="upload-progress" role="status">
        <span class="progress" :class="{ indeterminate: percent === 100 }">
          <span :style="{ width: percent === 100 ? undefined : `${percent ?? 0}%` }" />
        </span>
        <span class="muted small">
          <template v-if="percent !== null && percent < 100">Lade hoch … {{ percent }} %</template>
          <template v-else-if="isIfc">
            Server analysiert das Modell und ermittelt die Änderungen — bei großen Dateien einige Sekunden.
          </template>
          <template v-else>Server speichert die Datei …</template>
        </span>
      </div>
      <button type="submit" hidden />
    </form>
    <template #footer>
      <button type="button" class="btn" :disabled="busy" @click="emit('update:open', false)">Abbrechen</button>
      <button type="button" class="btn btn-primary" :disabled="busy || !file" @click="submit">
        <span v-if="busy" class="spinner" />
        {{ busy ? "Wird committet …" : "Committen" }}
      </button>
    </template>
  </UiDialog>
</template>
