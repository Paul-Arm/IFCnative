<script setup lang="ts">
import {
  PhCaretDown,
  PhCaretRight,
  PhCrosshairSimple,
  PhCubeTransparent,
  PhDownloadSimple,
  PhFolderSimple,
  PhImage,
  PhSidebarSimple,
} from "@phosphor-icons/vue";

import type { Model } from "~/types/api";

// Randlos: die Szene füllt den Platz unter dem Projektband.
definePageMeta({ fullBleed: true });

/**
 * Alle IFC-Modelle des Projekts (Head des Standard-Branches) in einer
 * gemeinsamen Szene. Links ein schwebendes Panel mit Ordnerbaum zum Ein-/
 * Ausblenden und Anfahren; die Szene lässt sich als Projektbild sichern.
 */
const project = useProject();
const { slug, detail, models, canWrite, modelsPending } = project;
const { token } = useAuth();
const toast = useToast();
const { load: loadImage } = useProjectImage();

useHead({ title: computed(() => `3D · ${detail.value?.project.name ?? slug}`) });

const ifcModels = computed(() => (models.value ?? []).filter((model) => model.kind === "ifc"));
const sources = computed(() =>
  ifcModels.value
    .filter((model) => model.head)
    .map((model) => ({
      key: model.id,
      src: `/api/projects/${slug}/models/${model.slug}/commits/${model.head!.id}/fragments`,
      label: model.folder ? `${model.folder}/${model.name}` : model.name,
    })),
);

const viewer = ref<{
  setVisible: (key: string, visible: boolean) => void;
  focusModel: (key: string) => Promise<void>;
  captureImage: () => string | null;
} | null>(null);
const hidden = reactive(new Set<string>());
const panelOpen = ref(true);

function toggleModel(id: string, visible: boolean): void {
  if (visible) hidden.delete(id);
  else hidden.add(id);
  viewer.value?.setVisible(id, visible);
}

// ---- Ordnerbaum ------------------------------------------------------------

interface TreeRow {
  kind: "folder" | "model";
  depth: number;
  path?: string;
  name?: string;
  state?: "all" | "some" | "none";
  model?: Model;
}

const collapsed = reactive(new Set<string>());

function modelsUnder(path: string): Model[] {
  return ifcModels.value.filter((model) => {
    const folder = model.folder ?? "";
    return folder === path || folder.startsWith(`${path}/`);
  });
}

const rows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = [];
  const walk = (path: string, depth: number) => {
    const prefix = path ? `${path}/` : "";
    const names = [
      ...new Set(
        ifcModels.value
          .map((model) => model.folder ?? "")
          .filter((folder) => folder.startsWith(prefix) && folder !== path)
          .map((folder) => folder.slice(prefix.length).split("/")[0]!),
      ),
    ].sort();
    for (const name of names) {
      const sub = prefix + name;
      const loadable = modelsUnder(sub).filter((model) => model.head);
      const visible = loadable.filter((model) => !hidden.has(model.id)).length;
      result.push({
        kind: "folder",
        depth,
        path: sub,
        name,
        state: !loadable.length || !visible ? "none" : visible === loadable.length ? "all" : "some",
      });
      if (!collapsed.has(sub)) walk(sub, depth + 1);
    }
    for (const model of ifcModels.value.filter((m) => (m.folder ?? "") === path)) {
      result.push({ kind: "model", depth, model });
    }
  };
  walk("", 0);
  return result;
});

function toggleCollapsed(path: string): void {
  if (collapsed.has(path)) collapsed.delete(path);
  else collapsed.add(path);
}

function toggleFolder(path: string, visible: boolean): void {
  for (const model of modelsUnder(path)) if (model.head) toggleModel(model.id, visible);
}

// ---- Bild der Szene ------------------------------------------------------------

const imageBusy = ref(false);

async function saveProjectImage(): Promise<void> {
  const dataUrl = viewer.value?.captureImage();
  if (!dataUrl) return;
  imageBusy.value = true;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await $fetch(`/api/projects/${slug}/image`, {
      method: "PUT",
      body: blob,
      headers: {
        "content-type": "image/png",
        ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
      },
    });
    loadImage(slug, true);
    await project.refreshProject();
    toast.success("Projektbild gespeichert — es erscheint im Dashboard und in der Projektliste.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    imageBusy.value = false;
  }
}

function downloadImage(): void {
  const dataUrl = viewer.value?.captureImage();
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${slug}-szene.png`;
  a.click();
}
</script>

<template>
  <div class="scene">
    <template v-if="sources.length">
      <ModelViewer ref="viewer" class="scene-viewer" :sources="sources" />

      <button
        v-if="!panelOpen"
        type="button"
        class="viewer-tool scene-panel-toggle"
        aria-label="Modell-Panel einblenden"
        @click="panelOpen = true"
      >
        <PhSidebarSimple :size="16" />
      </button>

      <aside v-if="panelOpen" class="scene-panel">
        <header class="scene-panel-head">
          <PhCubeTransparent :size="16" class="color-accent" />
          <strong>Modelle in der Szene</strong>
          <span class="counter">{{ sources.length - [...hidden].filter((id) => sources.some((s) => s.key === id)).length }}/{{ sources.length }}</span>
          <span class="spacer" />
          <button type="button" class="btn btn-invisible btn-xs btn-icon" aria-label="Panel ausblenden" @click="panelOpen = false">
            <PhSidebarSimple :size="14" />
          </button>
        </header>
        <div class="scene-tree">
          <template v-for="row in rows" :key="row.kind + (row.path ?? row.model?.id ?? '')">
            <div
              v-if="row.kind === 'folder'"
              class="scene-row scene-folder"
              :style="{ paddingLeft: `${row.depth * 14 + 6}px` }"
            >
              <button type="button" class="scene-caret" @click="toggleCollapsed(row.path!)">
                <PhCaretRight v-if="collapsed.has(row.path!)" :size="12" />
                <PhCaretDown v-else :size="12" />
              </button>
              <input
                type="checkbox"
                :checked="row.state === 'all'"
                :indeterminate="row.state === 'some'"
                @change="toggleFolder(row.path!, ($event.target as HTMLInputElement).checked)"
              />
              <PhFolderSimple :size="14" weight="fill" class="fb-folder-icon" />
              <span class="truncate">{{ row.name }}</span>
            </div>
            <label
              v-else
              class="scene-row"
              :class="{ disabled: !row.model!.head }"
              :style="{ paddingLeft: `${row.depth * 14 + 26}px` }"
            >
              <input
                type="checkbox"
                :disabled="!row.model!.head"
                :checked="!!row.model!.head && !hidden.has(row.model!.id)"
                @change="toggleModel(row.model!.id, ($event.target as HTMLInputElement).checked)"
              />
              <ModelIcon kind="ifc" :name="row.model!.name" :size="14" />
              <span class="truncate" style="flex: 1">
                {{ row.model!.name }}
                <span v-if="!row.model!.head" class="muted small">(leer)</span>
              </span>
              <button
                v-if="row.model!.head"
                type="button"
                class="scene-focus"
                title="Kamera auf dieses Modell"
                @click.prevent.stop="viewer?.focusModel(row.model!.id)"
              >
                <PhCrosshairSimple :size="14" />
              </button>
            </label>
          </template>
        </div>
        <footer class="scene-panel-foot">
          <button v-if="canWrite" type="button" class="btn btn-sm" :disabled="imageBusy" style="flex: 1" @click="saveProjectImage">
            <span v-if="imageBusy" class="spinner" />
            <PhImage v-else :size="14" />
            Als Projektbild
          </button>
          <button type="button" class="btn btn-sm btn-icon" aria-label="Szene als PNG herunterladen" data-tip="Als PNG" @click="downloadImage">
            <PhDownloadSimple :size="14" />
          </button>
        </footer>
      </aside>
    </template>

    <div v-else-if="modelsPending" class="scene-empty">
      <LoadingState center large text="Lade Modelle …" />
    </div>
    <div v-else class="scene-empty">
      <Blankslate title="Noch keine 3D-Szene" blueprint>
        <template #art><IsoScene :size="220" variant="empty" /></template>
        Sobald ein IFC-Modell einen Stand hat, erscheint es hier — alle Fachmodelle gemeinsam in einer Szene.
        <template v-if="canWrite" #actions>
          <NuxtLink :to="`/p/${slug}?upload=1`" class="btn btn-primary">IFC-Datei hochladen</NuxtLink>
        </template>
      </Blankslate>
    </div>
  </div>
</template>
