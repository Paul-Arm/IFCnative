<script setup lang="ts">
import {
  PhArrowElbowLeftUp,
  PhBookOpen,
  PhCaretDown,
  PhClockCounterClockwise,
  PhCube,
  PhFileArrowUp,
  PhFileMd,
  PhFolderPlus,
  PhFolderSimple,
  PhGlobeSimple,
  PhMagnifyingGlass,
  PhPencilSimple,
  PhPlus,
  PhTrash,
  PhUploadSimple,
  PhX,
} from "@phosphor-icons/vue";

import type { Model } from "~/types/api";

/**
 * Projekt-Startseite („Code“-Tab bei GitHub): Ordner und Dateien mit dem
 * jeweils letzten Commit, README des Ordners, Info-Seitenleiste.
 */
const route = useRoute();
const router = useRouter();
const project = useProject();
const { slug, detail, models, stats, canWrite, modelsPending } = project;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();

// Alte Links (?tab=issues etc.) auf die neuen Unterseiten umleiten.
const LEGACY_TABS: Record<string, string> = {
  issues: "/issues",
  actions: "/actions",
  "3d": "/3d",
  mitglieder: "/settings/members",
  einstellungen: "/settings",
};
if (typeof route.query.tab === "string" && LEGACY_TABS[route.query.tab]) {
  const target = `/p/${slug}${LEGACY_TABS[route.query.tab]}`;
  const query: Record<string, string> = {};
  if (typeof route.query.fromRun === "string") query.fromRun = route.query.fromRun;
  if (typeof route.query.forModel === "string") query.forModel = route.query.forModel;
  const withNew = route.query.tab === "issues" && (query.fromRun || query.forModel);
  await navigateTo({ path: withNew ? `${target}/new` : target, query }, { replace: true });
}

const currentPath = computed(() => (typeof route.query.path === "string" ? route.query.path : ""));

function goPath(path: string): void {
  router.push({ query: path ? { path } : {} });
}

const crumbs = computed(() => {
  if (!currentPath.value) return [];
  const segments = currentPath.value.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
  }));
});

// ---- Inhalt des aktuellen Ordners ---------------------------------------

function under(model: Model, path: string): boolean {
  const folder = model.folder ?? "";
  return !path || folder === path || folder.startsWith(`${path}/`);
}

function latestHead(list: Model[]): Model | null {
  let best: Model | null = null;
  for (const model of list) {
    if (!model.head) continue;
    if (!best?.head || model.head.createdAt > best.head.createdAt) best = model;
  }
  return best;
}

const childFolders = computed(() => {
  const folders = detail.value?.folders ?? [];
  const prefix = currentPath.value ? `${currentPath.value}/` : "";
  return folders
    .filter((folder) => folder.startsWith(prefix) && folder !== currentPath.value)
    .filter((folder) => !folder.slice(prefix.length).includes("/"))
    .map((folder) => {
      const contained = (models.value ?? []).filter((model) => under(model, folder));
      return {
        path: folder,
        name: folder.slice(prefix.length),
        count: contained.length,
        latest: latestHead(contained),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
});

const filesHere = computed(() =>
  (models.value ?? [])
    .filter((model) => (model.folder ?? "") === currentPath.value)
    .sort((a, b) => a.name.localeCompare(b.name, "de")),
);

const latestHere = computed(() =>
  latestHead((models.value ?? []).filter((model) => under(model, currentPath.value))),
);

const isEmptyProject = computed(
  () => !modelsPending.value && !(models.value ?? []).length && !(detail.value?.folders ?? []).length,
);

// ---- Datei finden (wie GitHubs „Go to file“) -----------------------------

const finder = ref("");
const finderInput = ref<HTMLInputElement | null>(null);
const finderResults = computed(() => {
  const needle = finder.value.trim().toLowerCase();
  if (!needle) return [];
  return (models.value ?? [])
    .filter((model) =>
      `${model.folder ? `${model.folder}/` : ""}${model.name}`.toLowerCase().includes(needle),
    )
    .slice(0, 50);
});

function onFinderKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    finder.value = "";
    finderInput.value?.blur();
  } else if (event.key === "Enter" && finderResults.value[0]) {
    void router.push(`/p/${slug}/m/${finderResults.value[0].slug}`);
  }
}

// „t“ fokussiert die Dateisuche (wie bei GitHub).
function onGlobalKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  if (event.key !== "t" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
  if (document.querySelector(".dialog-backdrop, .palette-backdrop")) return;
  event.preventDefault();
  finderInput.value?.focus();
}
onMounted(() => document.addEventListener("keydown", onGlobalKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onGlobalKey));

// ---- Prüfstatus der Head-Commits ------------------------------------------

const { checks } = useProjectRuns(slug);

// ---- Hochladen (Dialog + Drop auf die Liste) ------------------------------

const uploadOpen = ref(false);
const droppedFiles = ref<File[]>([]);
const dropActive = ref(false);
let dragDepth = 0;

function openUpload(files: File[] = []): void {
  droppedFiles.value = files;
  uploadOpen.value = true;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function onDragEnter(event: DragEvent): void {
  if (!canWrite.value || !hasFiles(event)) return;
  dragDepth += 1;
  dropActive.value = true;
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropActive.value = false;
}

function onDrop(event: DragEvent): void {
  dragDepth = 0;
  dropActive.value = false;
  if (!canWrite.value) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) openUpload(files);
}

async function onUploaded(): Promise<void> {
  await Promise.all([project.refreshModels(), project.refreshProject(), project.refreshStats()]);
}

// ---- Anlegen: IFC-Modell, Markdown-Datei, Ordner ---------------------------

type CreateKind = "model" | "markdown" | "folder";
const createKind = ref<CreateKind | null>(null);
const createName = ref("");
const createVisibility = ref<"private" | "public">("private");
const createBusy = ref(false);
const createError = ref<string | null>(null);

function openCreate(kind: CreateKind): void {
  createKind.value = kind;
  createError.value = null;
  createVisibility.value = "private";
  const hasReadme = filesHere.value.some((model) => model.name.toLowerCase() === "readme.md");
  createName.value = kind === "markdown" && !hasReadme ? "README.md" : "";
}

// ?upload=1 / ?create=… (aus Kopf-Menü und Befehlspalette). Die Rolle steht
// erst fest, wenn das Projekt geladen ist — bis dahin warten.
watch(
  () => [route.query.upload, route.query.create, detail.value ? canWrite.value : null] as const,
  ([upload, create, write]) => {
    if ((!upload && !create) || write === null) return;
    if (!write) {
      toast.error("Du hast in diesem Projekt keine Schreibrechte.");
    } else {
      if (upload) openUpload();
      if (create === "model" || create === "folder" || create === "markdown") openCreate(create);
    }
    const { upload: _u, create: _c, ...rest } = route.query;
    void router.replace({ query: rest });
  },
  { immediate: true },
);

const createTitle = computed(() =>
  createKind.value === "model"
    ? "Neues IFC-Modell"
    : createKind.value === "markdown"
      ? "Neue Markdown-Datei"
      : "Neuer Ordner",
);

async function submitCreate(): Promise<void> {
  const name = createName.value.trim();
  if (!name || !createKind.value) return;
  createBusy.value = true;
  createError.value = null;
  try {
    if (createKind.value === "folder") {
      const path = currentPath.value ? `${currentPath.value}/${name}` : name;
      await api(`/projects/${slug}/folders`, { method: "POST", body: { path } });
      await project.refreshProject();
      createKind.value = null;
      goPath(path);
      toast.success(`Ordner „${name}“ angelegt.`);
      return;
    }
    const markdown = createKind.value === "markdown";
    const fileName = markdown && !/\.(md|markdown)$/i.test(name) ? `${name}.md` : name;
    const { model } = await api<{ model: Model }>(`/projects/${slug}/models`, {
      method: "POST",
      body: {
        name: fileName,
        kind: markdown ? "md" : "ifc",
        visibility: createVisibility.value,
        folder: currentPath.value,
      },
    });
    await Promise.all([project.refreshModels(), project.refreshProject()]);
    createKind.value = null;
    await navigateTo(
      markdown ? `/p/${slug}/m/${model.slug}?edit=1` : `/p/${slug}/m/${model.slug}`,
    );
  } catch (e) {
    createError.value = apiErrorMessage(e);
  } finally {
    createBusy.value = false;
  }
}

async function deleteFolder(path: string): Promise<void> {
  const ok = await confirm({
    title: "Ordner löschen?",
    message: `Der leere Ordner „${path}“ wird entfernt.`,
    confirmLabel: "Ordner löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}/folders`, { method: "DELETE", query: { path } });
    await project.refreshProject();
    toast.success("Ordner gelöscht.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- README des Ordners -----------------------------------------------------

const readme = computed(
  () =>
    filesHere.value.find(
      (model) => model.kind === "md" && model.name.toLowerCase() === "readme.md",
    ) ?? null,
);
const readmeHtml = ref<string | null>(null);

watch(
  () => readme.value?.head?.id,
  async (headId, _previous, onCleanup) => {
    // Schneller Ordnerwechsel: die README des vorigen Ordners verwerfen.
    let stale = false;
    onCleanup(() => (stale = true));
    readmeHtml.value = null;
    const model = readme.value;
    if (!model || !headId) return;
    try {
      const text = await $fetch<string>(
        `/api/projects/${slug}/models/${model.slug}/commits/${headId}/file`,
        {
          responseType: "text",
          headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
        },
      );
      if (!stale) readmeHtml.value = renderMarkdown(text);
    } catch {
      if (!stale) readmeHtml.value = null;
    }
  },
  { immediate: true },
);

function commitLink(model: Model): string {
  return model.head && model.kind === "ifc"
    ? `/p/${slug}/m/${model.slug}/c/${model.head.id}`
    : `/p/${slug}/m/${model.slug}?tab=commits`;
}
</script>

<template>
  <div :class="{ layout: !currentPath && !isEmptyProject }">
    <div class="layout-main">
      <!-- ============ Leeres Projekt: Schnellstart ============ -->
      <div v-if="isEmptyProject" class="box quickstart">
        <Blankslate title="Dieses Projekt ist noch leer" blueprint>
          <template #art>
            <IsoScene :size="180" variant="empty" />
          </template>
          Lege IFC-Modelle, Pläne und Dokumente ab — jede Datei bekommt ihre
          eigene Versionshistorie mit Änderungsübersicht.
          <template v-if="canWrite" #actions>
            <button type="button" class="btn btn-primary" @click="openUpload()">
              <PhUploadSimple :size="16" /> Dateien hochladen
            </button>
            <button type="button" class="btn" @click="openCreate('model')">
              <PhCube :size="16" /> IFC-Modell anlegen
            </button>
            <button type="button" class="btn" @click="openCreate('markdown')">
              <PhFileMd :size="16" /> README schreiben
            </button>
          </template>
        </Blankslate>
      </div>

      <template v-else>
        <!-- ============ Werkzeugleiste ============ -->
        <div class="fb-toolbar">
          <nav class="crumbs fb-crumbs" aria-label="Ordnerpfad">
            <a href="#" :class="{ current: !currentPath }" @click.prevent="goPath('')">
              {{ detail?.project.name ?? slug }}
            </a>
            <template v-for="crumb in crumbs" :key="crumb.path">
              <span class="sep">/</span>
              <a
                v-if="crumb.path !== currentPath"
                href="#"
                @click.prevent="goPath(crumb.path)"
              >{{ crumb.label }}</a>
              <span v-else class="current">{{ crumb.label }}</span>
            </template>
          </nav>
          <span class="spacer" />
          <div class="input-icon fb-finder">
            <PhMagnifyingGlass :size="16" />
            <input
              ref="finderInput"
              v-model="finder"
              type="search"
              placeholder="Datei finden"
              aria-label="Datei finden"
              @keydown="onFinderKey"
            />
            <kbd v-if="!finder" class="fb-finder-kbd">t</kbd>
          </div>
          <UiMenu v-if="canWrite" align="right">
            <template #trigger="{ toggle, open }">
              <button type="button" class="btn" :aria-expanded="open" @click="toggle">
                <PhPlus :size="16" /> Hinzufügen <PhCaretDown :size="12" />
              </button>
            </template>
            <button type="button" class="menu-item" @click="openUpload()">
              <PhFileArrowUp :size="16" />
              <span>Dateien hochladen<span class="menu-item-desc">IFC, PDF, DWG, Bilder …</span></span>
            </button>
            <button type="button" class="menu-item" @click="openCreate('model')">
              <PhCube :size="16" />
              <span>IFC-Modell anlegen<span class="menu-item-desc">leer, Stände später committen</span></span>
            </button>
            <button type="button" class="menu-item" @click="openCreate('markdown')">
              <PhFileMd :size="16" />
              <span>Markdown-Datei<span class="menu-item-desc">Notizen, README, Protokolle</span></span>
            </button>
            <div class="menu-sep" />
            <button type="button" class="menu-item" @click="openCreate('folder')">
              <PhFolderPlus :size="16" /> Ordner anlegen
            </button>
          </UiMenu>
        </div>

        <!-- ============ Datei-Finder-Ergebnisse ============ -->
        <div v-if="finder.trim()" class="box">
          <div class="box-header">
            <span class="box-title">{{ finderResults.length }} Treffer für „{{ finder.trim() }}“</span>
            <span class="spacer" />
            <button type="button" class="btn btn-invisible btn-sm" @click="finder = ''">
              <PhX :size="14" /> Zurücksetzen
            </button>
          </div>
          <NuxtLink
            v-for="model in finderResults"
            :key="model.id"
            :to="`/p/${slug}/m/${model.slug}`"
            class="box-row hoverable fb-row"
          >
            <ModelIcon :kind="model.kind" :name="model.name" />
            <span class="fb-name">
              <span v-if="model.folder" class="muted">{{ model.folder }}/</span>{{ model.name }}
            </span>
            <span class="fb-time muted small">
              <RelTime v-if="model.head" :date="model.head.createdAt" />
            </span>
          </NuxtLink>
          <div v-if="!finderResults.length" class="box-row muted">Keine Datei gefunden.</div>
        </div>

        <!-- ============ Datei-Liste ============ -->
        <div
          v-else
          class="box fb"
          :class="{ 'drop-active': dropActive }"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave="onDragLeave"
          @drop.prevent="onDrop"
        >
          <div class="box-header fb-latest">
            <template v-if="latestHere?.head">
              <UserAvatar :user="latestHere.head.author" :size="24" />
              <span class="author">{{ latestHere.head.author?.name ?? "?" }}</span>
              <NuxtLink :to="commitLink(latestHere)" class="fb-latest-msg truncate">
                {{ latestHere.head.message || "(ohne Nachricht)" }}
              </NuxtLink>
              <span class="spacer" />
              <NuxtLink :to="commitLink(latestHere)" class="sha hide-sm">
                {{ shortSha(latestHere.head.id) }}
              </NuxtLink>
              <span class="muted small nowrap hide-sm">
                <RelTime :date="latestHere.head.createdAt" />
              </span>
              <NuxtLink
                v-if="stats && !currentPath"
                :to="`/p/${slug}/activity`"
                class="btn btn-invisible btn-sm"
              >
                <PhClockCounterClockwise :size="16" />
                <strong>{{ formatNumber(stats.commitCount) }}</strong>
                <span class="hide-sm">Commits</span>
              </NuxtLink>
            </template>
            <template v-else-if="modelsPending">
              <span class="skeleton dot" />
              <span class="skeleton" style="max-width: 320px" />
            </template>
            <span v-else class="muted">Noch keine Commits in diesem Ordner.</span>
          </div>

          <SkeletonRows v-if="modelsPending" :rows="5" dots />
          <template v-else>
            <a
              v-if="currentPath"
              href="#"
              class="box-row hoverable fb-row"
              @click.prevent="goPath(currentPath.split('/').slice(0, -1).join('/'))"
            >
              <PhArrowElbowLeftUp :size="16" class="muted" />
              <span class="fb-name">..</span>
            </a>
            <div
              v-for="folder in childFolders"
              :key="folder.path"
              class="box-row hoverable fb-row"
              @click="goPath(folder.path)"
            >
              <PhFolderSimple :size="16" weight="fill" class="fb-folder-icon" />
              <a href="#" class="fb-name" @click.prevent.stop="goPath(folder.path)">{{ folder.name }}</a>
              <span class="fb-msg truncate muted">
                <template v-if="folder.latest?.head">
                  {{ folder.latest.head.message || "(ohne Nachricht)" }}
                </template>
                <template v-else>{{ folder.count ? plural(folder.count, "Datei", "Dateien") : "leer" }}</template>
              </span>
              <button
                v-if="canWrite && !folder.count"
                type="button"
                class="btn btn-invisible btn-xs btn-icon fb-row-action"
                aria-label="Leeren Ordner löschen"
                title="Leeren Ordner löschen"
                @click.stop="deleteFolder(folder.path)"
              >
                <PhTrash :size="14" />
              </button>
              <span class="fb-time muted small">
                <RelTime v-if="folder.latest?.head" :date="folder.latest.head.createdAt" />
              </span>
            </div>
            <div v-for="model in filesHere" :key="model.id" class="box-row hoverable fb-row">
              <ModelIcon :kind="model.kind" :name="model.name" />
              <NuxtLink :to="`/p/${slug}/m/${model.slug}`" class="fb-name">
                {{ model.name
                }}<PhGlobeSimple
                  v-if="model.visibility === 'public'"
                  :size="12"
                  class="fb-lock"
                  aria-label="Öffentlich — auch ohne Anmeldung abrufbar"
                />
              </NuxtLink>
              <span class="fb-msg truncate">
                <template v-if="model.head">
                  <NuxtLink :to="commitLink(model)" class="fb-msg-link">
                    {{ model.head.message || "(ohne Nachricht)" }}
                  </NuxtLink>
                  <CommitStatus :check="checks.get(model.head.id)" :slug="slug" :size="14" />
                </template>
                <span v-else class="subtle">Noch keine Version</span>
              </span>
              <span class="fb-time muted small">
                <RelTime v-if="model.head" :date="model.head.createdAt" />
              </span>
            </div>
            <div v-if="!childFolders.length && !filesHere.length" class="box-row muted">
              Dieser Ordner ist leer.
            </div>
          </template>

          <div v-if="dropActive" class="fb-drop">
            <PhUploadSimple :size="28" />
            <strong>Loslassen zum Hochladen</strong>
            <span>nach {{ currentPath ? `/${currentPath}` : "die Projektwurzel" }}</span>
          </div>
        </div>

        <!-- ============ README ============ -->
        <div v-if="readme && readmeHtml && !finder.trim()" class="box readme">
          <div class="box-header">
            <PhBookOpen :size="16" class="muted" />
            <span class="box-title">{{ readme.name }}</span>
            <span class="spacer" />
            <NuxtLink
              v-if="canWrite"
              :to="`/p/${slug}/m/${readme.slug}?edit=1`"
              class="btn btn-invisible btn-sm btn-icon"
              aria-label="README bearbeiten"
              data-tip="Bearbeiten"
            >
              <PhPencilSimple :size="16" />
            </NuxtLink>
          </div>
          <article class="box-body markdown-body readme-body" v-html="readmeHtml" />
        </div>
        <div
          v-else-if="!currentPath && !readme && canWrite && !finder.trim() && !modelsPending"
          class="box readme-hint"
        >
          <div class="box-body row">
            <PhBookOpen :size="20" class="muted" />
            <span class="muted">
              Hilf anderen, sich zurechtzufinden — eine <strong>README.md</strong> erscheint hier wie bei GitHub.
            </span>
            <span class="spacer" />
            <button type="button" class="btn btn-sm" @click="openCreate('markdown')">README anlegen</button>
          </div>
        </div>
      </template>
    </div>

    <ProjectAbout v-if="!currentPath && !isEmptyProject" class="layout-side" />

    <!-- ============ Dialoge ============ -->
    <UploadDialog
      v-model:open="uploadOpen"
      :slug="slug"
      :folder="currentPath"
      :models="models ?? []"
      :initial-files="droppedFiles"
      @done="onUploaded"
    />

    <UiDialog
      :open="createKind !== null"
      :title="createTitle"
      :subtitle="currentPath ? `in /${currentPath}` : 'in der Projektwurzel'"
      :persistent="createBusy"
      @update:open="(value) => !value && (createKind = null)"
    >
      <form @submit.prevent="submitCreate">
        <div v-if="createError" class="flash flash-danger flash-sm">{{ createError }}</div>
        <div class="form-group">
          <label class="form-label" for="create-name">
            {{ createKind === "folder" ? "Ordnername" : "Name" }}
          </label>
          <input
            id="create-name"
            v-model="createName"
            type="text"
            required
            autocomplete="off"
            :placeholder="
              createKind === 'folder'
                ? 'z. B. Tragwerk'
                : createKind === 'markdown'
                  ? 'z. B. Besprechung-2026-09.md'
                  : 'z. B. Architektur'
            "
          />
          <p v-if="createKind === 'model'" class="form-hint">
            Ein IFC-Modell hat eine eigene Versionshistorie und Branches; die
            erste IFC-Datei committest du im nächsten Schritt.
          </p>
        </div>
        <div v-if="createKind !== 'folder'" class="choice-list">
          <label class="choice">
            <input v-model="createVisibility" type="radio" value="private" />
            <span class="choice-text">
              <strong>Privat</strong>
              <span>Nur für Projektmitglieder und angemeldete Nutzer öffentlicher Projekte.</span>
            </span>
          </label>
          <label class="choice">
            <input v-model="createVisibility" type="radio" value="public" />
            <span class="choice-text">
              <strong>Öffentlich</strong>
              <span>Auch ohne Anmeldung per Link abrufbar (z. B. für Viewer-Einbindungen).</span>
            </span>
          </label>
        </div>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="createBusy" @click="createKind = null">
          Abbrechen
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="createBusy || !createName.trim()"
          @click="submitCreate"
        >
          <span v-if="createBusy" class="spinner" />
          Anlegen
        </button>
      </template>
    </UiDialog>
  </div>
</template>
