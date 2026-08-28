<script setup lang="ts">
import {
  PhArrowElbowLeftUp,
  PhBookOpen,
  PhCaretDown,
  PhCaretRight,
  PhCheckCircle,
  PhCrosshairSimple,
  PhCubeTransparent,
  PhDownloadSimple,
  PhImage,
  PhCube,
  PhFileMd,
  PhFolder,
  PhFolderPlus,
  PhFolders,
  PhGear,
  PhPlus,
  PhRecord,
  PhUsers,
} from "@phosphor-icons/vue";

import type { Issue, Label, Member, Model, Project, Role } from "~/types/api";

const route = useRoute();
const router = useRouter();
const { api } = useApi();
const { user } = useAuth();
const slug = route.params.project as string;

const { data: projectData, refresh: refreshProject } = await useAsyncData(
  `project-${slug}`,
  () =>
    api<{
      project: Project;
      members: Member[];
      role: Role | null;
      folders: string[];
    }>(`/projects/${slug}`),
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
const isOwner = computed(() => projectData.value?.role === "owner");

// ---- Tabs + aktueller Ordnerpfad --------------------------------------

type Tab = "modelle" | "3d" | "issues" | "mitglieder" | "einstellungen";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  return value === "3d" ||
    value === "issues" ||
    value === "mitglieder" ||
    value === "einstellungen"
    ? value
    : "modelle";
});

const currentPath = computed(() =>
  typeof route.query.path === "string" ? route.query.path : "",
);

function goTo(nextTab: Tab, path = ""): void {
  const query: Record<string, string> = {};
  if (nextTab !== "modelle") query.tab = nextTab;
  if (path) query.path = path;
  router.replace({ query });
}

const breadcrumb = computed(() => {
  if (!currentPath.value) return [];
  const segments = currentPath.value.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
  }));
});

// ---- Datei-Browser: Unterordner + Modelle im aktuellen Pfad ------------

const childFolders = computed(() => {
  const folders = projectData.value?.folders ?? [];
  const prefix = currentPath.value ? `${currentPath.value}/` : "";
  return folders
    .filter((folder) => {
      if (!folder.startsWith(prefix) || folder === currentPath.value) {
        return false;
      }
      return !folder.slice(prefix.length).includes("/");
    })
    .map((folder) => ({
      path: folder,
      name: folder.slice(prefix.length),
      modelCount: (modelsData.value?.models ?? []).filter(
        (model) =>
          model.folder === folder || model.folder.startsWith(`${folder}/`),
      ).length,
    }));
});

const modelsInPath = computed(() =>
  (modelsData.value?.models ?? []).filter(
    (model) => (model.folder ?? "") === currentPath.value,
  ),
);

// ---- Ordner anlegen / löschen ------------------------------------------

const showFolderForm = ref(false);
const folderName = ref("");
const browserError = ref<string | null>(null);
const newMenu = ref<HTMLDetailsElement | null>(null);

function openCreateForm(which: "model" | "file" | "folder"): void {
  showModelForm.value = which === "model";
  showFileForm.value = which === "file";
  showFolderForm.value = which === "folder";
  if (newMenu.value) {
    newMenu.value.open = false;
  }
}

async function createFolder(): Promise<void> {
  browserError.value = null;
  const name = folderName.value.trim();
  if (!name) return;
  try {
    const path = currentPath.value ? `${currentPath.value}/${name}` : name;
    await api(`/projects/${slug}/folders`, { method: "POST", body: { path } });
    folderName.value = "";
    showFolderForm.value = false;
    await refreshProject();
  } catch (e) {
    browserError.value = apiErrorMessage(e);
  }
}

async function deleteFolder(path: string): Promise<void> {
  if (!window.confirm(`Ordner „${path}" löschen?`)) return;
  browserError.value = null;
  try {
    await api(`/projects/${slug}/folders`, {
      method: "DELETE",
      query: { path },
    });
    await refreshProject();
  } catch (e) {
    browserError.value = apiErrorMessage(e);
  }
}

// ---- Modell anlegen (im aktuellen Ordner) ------------------------------

const showModelForm = ref(false);
const modelName = ref("");
const modelVisibility = ref<"private" | "public">("private");
const modelBusy = ref(false);

async function createModel(): Promise<void> {
  browserError.value = null;
  modelBusy.value = true;
  try {
    await api(`/projects/${slug}/models`, {
      method: "POST",
      body: {
        name: modelName.value,
        visibility: modelVisibility.value,
        folder: currentPath.value,
      },
    });
    modelName.value = "";
    showModelForm.value = false;
    await Promise.all([refreshModels(), refreshProject()]);
  } catch (e) {
    browserError.value = apiErrorMessage(e);
  } finally {
    modelBusy.value = false;
  }
}

// ---- Markdown-Datei anlegen --------------------------------------------

const showFileForm = ref(false);
const fileName = ref("README.md");
const fileContent = ref("");
const fileMessage = ref("");
const fileBusy = ref(false);
const { token } = useAuth();

async function createMarkdownFile(): Promise<void> {
  browserError.value = null;
  fileBusy.value = true;
  try {
    const name = fileName.value.trim() || "README.md";
    const { model } = await api<{ model: Model }>(`/projects/${slug}/models`, {
      method: "POST",
      body: { name, kind: "md", folder: currentPath.value },
    });
    await $fetch(
      `/api/projects/${slug}/models/${model.slug}/commits`,
      {
        method: "POST",
        query: { message: fileMessage.value.trim() || "Erste Version" },
        body: fileContent.value || `# ${name.replace(/\.md$/i, "")}\n`,
        headers: {
          "content-type": "text/markdown",
          ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
        },
      },
    );
    fileName.value = "README.md";
    fileContent.value = "";
    fileMessage.value = "";
    showFileForm.value = false;
    await Promise.all([refreshModels(), refreshProject()]);
  } catch (e) {
    browserError.value = apiErrorMessage(e);
  } finally {
    fileBusy.value = false;
  }
}

// ---- README-Anzeige (wie GitHub) ---------------------------------------

const readmeModel = computed(
  () =>
    modelsInPath.value.find(
      (model) =>
        model.kind === "md" && model.name.toLowerCase() === "readme.md",
    ) ?? null,
);
const readmeHtml = ref<string | null>(null);

watch(
  [readmeModel, currentPath],
  async () => {
    readmeHtml.value = null;
    const model = readmeModel.value;
    if (!model?.head) return;
    try {
      const text = await $fetch<string>(
        `/api/projects/${slug}/models/${model.slug}/commits/${model.head.id}/file`,
        {
          responseType: "text",
          headers: token.value
            ? { authorization: `Bearer ${token.value}` }
            : {},
        },
      );
      readmeHtml.value = renderMarkdown(text);
    } catch {
      readmeHtml.value = null;
    }
  },
  { immediate: true },
);

// ---- Projekt-3D: alle IFC-Modelle in einer Szene -----------------------

const viewerModels = computed(() =>
  (modelsData.value?.models ?? []).filter(
    (model) => model.kind !== "md",
  ),
);
const viewerSources = computed(() =>
  viewerModels.value
    .filter((model) => model.head)
    .map((model) => ({
      key: model.id,
      src: `/api/projects/${slug}/models/${model.slug}/commits/${model.head!.id}/fragments`,
      label: model.folder ? `${model.folder}/${model.name}` : model.name,
    })),
);
const projectViewer = ref<{
  setVisible: (key: string, visible: boolean) => void;
  focusModel: (key: string) => Promise<void>;
  captureImage: () => string | null;
} | null>(null);
const hiddenModels = reactive(new Set<string>());

function toggleViewerModel(modelId: string, visible: boolean): void {
  if (visible) {
    hiddenModels.delete(modelId);
  } else {
    hiddenModels.add(modelId);
  }
  projectViewer.value?.setVisible(modelId, visible);
}

// Sidebar als Ordner-Baum
interface TreeRow {
  kind: "folder" | "model";
  depth: number;
  path?: string;
  name?: string;
  state?: "all" | "some" | "none";
  model?: Model;
}

const collapsedFolders = reactive(new Set<string>());

function viewerModelsUnder(path: string): Model[] {
  return viewerModels.value.filter((model) => {
    const folder = model.folder ?? "";
    return folder === path || folder.startsWith(`${path}/`);
  });
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = [];
  const walk = (path: string, depth: number) => {
    const prefix = path ? `${path}/` : "";
    const subNames = [
      ...new Set(
        viewerModels.value
          .map((model) => model.folder ?? "")
          .filter((folder) => folder.startsWith(prefix) && folder !== path)
          .map((folder) => folder.slice(prefix.length).split("/")[0]!),
      ),
    ].sort();
    for (const name of subNames) {
      const subPath = prefix + name;
      const loadable = viewerModelsUnder(subPath).filter((model) => model.head);
      const visible = loadable.filter(
        (model) => !hiddenModels.has(model.id),
      ).length;
      rows.push({
        kind: "folder",
        depth,
        path: subPath,
        name,
        state:
          !loadable.length || visible === 0
            ? "none"
            : visible === loadable.length
              ? "all"
              : "some",
      });
      if (!collapsedFolders.has(subPath)) {
        walk(subPath, depth + 1);
      }
    }
    for (const model of viewerModels.value.filter(
      (m) => (m.folder ?? "") === path,
    )) {
      rows.push({ kind: "model", depth, model });
    }
  };
  walk("", 0);
  return rows;
});

function toggleCollapsed(path: string): void {
  if (collapsedFolders.has(path)) {
    collapsedFolders.delete(path);
  } else {
    collapsedFolders.add(path);
  }
}

function toggleFolder(path: string, visible: boolean): void {
  for (const model of viewerModelsUnder(path)) {
    if (model.head) {
      toggleViewerModel(model.id, visible);
    }
  }
}

// Szene als Bild sichern / als Projektbild setzen
const imageBusy = ref(false);
const imageNotice = ref<string | null>(null);

async function saveProjectImage(): Promise<void> {
  const dataUrl = projectViewer.value?.captureImage();
  if (!dataUrl) return;
  imageBusy.value = true;
  imageNotice.value = null;
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
    imageNotice.value = "Projektbild gespeichert.";
  } catch (e) {
    imageNotice.value = apiErrorMessage(e);
  } finally {
    imageBusy.value = false;
  }
}

function downloadSceneImage(): void {
  const dataUrl = projectViewer.value?.captureImage();
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${slug}-szene.png`;
  a.click();
}

// ---- Issues ------------------------------------------------------------

const { data: issuesData, refresh: refreshIssues } = await useAsyncData(
  `issues-${slug}`,
  () =>
    api<{ issues: Issue[]; openCount: number; closedCount: number }>(
      `/projects/${slug}/issues`,
    ),
);
const { data: labelsData, refresh: refreshLabels } = await useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
);

const issueFilter = ref<"open" | "closed">("open");
const filteredIssues = computed(() =>
  (issuesData.value?.issues ?? []).filter(
    (issue) => issue.state === issueFilter.value,
  ),
);

const showIssueForm = ref(false);
const issueTitle = ref("");
const issueBody = ref("");
const issueAssignees = reactive(new Set<string>());
const issueModels = reactive(new Set<string>());
const issueLabels = reactive(new Set<string>());
const issueBusy = ref(false);
const issueError = ref<string | null>(null);

function toggleSet(set: Set<string>, id: string, on: boolean): void {
  if (on) {
    set.add(id);
  } else {
    set.delete(id);
  }
}

async function createIssue(): Promise<void> {
  issueError.value = null;
  issueBusy.value = true;
  try {
    await api(`/projects/${slug}/issues`, {
      method: "POST",
      body: {
        title: issueTitle.value,
        body: issueBody.value,
        assigneeIds: [...issueAssignees],
        modelIds: [...issueModels],
        labelIds: [...issueLabels],
      },
    });
    issueTitle.value = "";
    issueBody.value = "";
    issueAssignees.clear();
    issueModels.clear();
    issueLabels.clear();
    showIssueForm.value = false;
    issueFilter.value = "open";
    await refreshIssues();
  } catch (e) {
    issueError.value = apiErrorMessage(e);
  } finally {
    issueBusy.value = false;
  }
}

async function createProjectLabel(
  name: string,
  color: string,
): Promise<Label | null> {
  issueError.value = null;
  try {
    const { label } = await api<{ label: Label }>(`/projects/${slug}/labels`, {
      method: "POST",
      body: { name, color },
    });
    await refreshLabels();
    return label;
  } catch (e) {
    issueError.value = apiErrorMessage(e);
    return null;
  }
}

/** Lesbare Textfarbe (schwarz/weiss) fuer eine Label-Hintergrundfarbe. */
function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2328" : "#ffffff";
}

// ---- Mitglieder --------------------------------------------------------

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

// ---- Projekt löschen ---------------------------------------------------

const deleteError = ref<string | null>(null);
const settingsError = ref<string | null>(null);
const settingsNotice = ref<string | null>(null);

async function patchProject(
  visibility: "private" | "public",
): Promise<void> {
  settingsError.value = null;
  settingsNotice.value = null;
  try {
    await api(`/projects/${slug}`, {
      method: "PATCH",
      body: { visibility },
    });
    settingsNotice.value = "Gespeichert.";
    await refreshProject();
  } catch (e) {
    settingsError.value = apiErrorMessage(e);
  }
}

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

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
</script>

<template>
  <div v-if="projectData">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <strong>{{ projectData.project.name }}</strong>
      <span v-if="projectData.role" class="badge accent">{{ projectData.role }}</span>
    </nav>

    <nav class="gh-tabs">
      <button :class="{ active: tab === 'modelle' }" @click="goTo('modelle')">
        <PhFolders :size="16" aria-hidden="true" />
        Modelle
        <span class="counter">{{ modelsData?.models.length ?? 0 }}</span>
      </button>
      <button :class="{ active: tab === '3d' }" @click="goTo('3d')">
        <PhCubeTransparent :size="16" aria-hidden="true" />
        3D
        <span class="counter">{{ viewerSources.length }}</span>
      </button>
      <button :class="{ active: tab === 'issues' }" @click="goTo('issues')">
        <PhRecord :size="16" aria-hidden="true" />
        Issues
        <span class="counter">{{ issuesData?.openCount ?? 0 }}</span>
      </button>
      <button :class="{ active: tab === 'mitglieder' }" @click="goTo('mitglieder')">
        <PhUsers :size="16" aria-hidden="true" />
        Mitglieder
        <span class="counter">{{ projectData.members.length }}</span>
      </button>
      <button
        :class="{ active: tab === 'einstellungen' }"
        @click="goTo('einstellungen')"
      >
        <PhGear :size="16" aria-hidden="true" />
        Einstellungen
      </button>
    </nav>

    <!-- ================= Tab: Modelle (Datei-Browser) ================= -->
    <template v-if="tab === 'modelle'">
      <div v-if="browserError" class="alert error">{{ browserError }}</div>

      <div class="card">
        <div class="card-header fb-toolbar">
          <div class="fb-breadcrumb">
            <a
              href="#"
              @click.prevent="goTo('modelle')"
              :class="{ current: !currentPath }"
            >{{ projectData.project.name }}</a>
            <template v-for="crumb in breadcrumb" :key="crumb.path">
              <span class="muted">/</span>
              <a
                href="#"
                :class="{ current: crumb.path === currentPath }"
                @click.prevent="goTo('modelle', crumb.path)"
              >{{ crumb.label }}</a>
            </template>
          </div>
          <span class="topbar-spacer" />
          <details v-if="canWrite" ref="newMenu" class="menu">
            <summary class="btn primary">＋ Neu</summary>
            <div class="menu-list">
              <button class="menu-item" @click="openCreateForm('model')">
                <PhCube :size="16" aria-hidden="true" />
                IFC-Modell
              </button>
              <button class="menu-item" @click="openCreateForm('file')">
                <PhFileMd :size="16" aria-hidden="true" />
                Markdown-Datei
              </button>
              <button class="menu-item" @click="openCreateForm('folder')">
                <PhFolderPlus :size="16" aria-hidden="true" />
                Ordner
              </button>
            </div>
          </details>
        </div>

        <div v-if="showFolderForm" class="card-body" style="border-bottom: 1px solid var(--border)">
          <form class="form-inline" @submit.prevent="createFolder">
            <div>
              <label for="folder-name">
                Ordnername
                <span v-if="currentPath" class="muted">(in {{ currentPath }}/)</span>
              </label>
              <input
                id="folder-name"
                v-model="folderName"
                type="text"
                required
                placeholder="z.B. Hochbau"
              />
            </div>
            <div class="shrink">
              <button class="primary" type="submit">Anlegen</button>
            </div>
          </form>
        </div>

        <div v-if="showFileForm" class="card-body" style="border-bottom: 1px solid var(--border)">
          <p class="muted small" style="margin-top: 0">
            Markdown-Datei — eine <code>README.md</code> wird wie bei GitHub
            unter der Dateiliste angezeigt<span v-if="currentPath">
              (wird in „{{ currentPath }}“ angelegt)</span>.
          </p>
          <form @submit.prevent="createMarkdownFile">
            <div class="form-inline" style="margin-bottom: 0.9rem">
              <div class="shrink">
                <label for="file-name">Dateiname</label>
                <input
                  id="file-name"
                  v-model="fileName"
                  type="text"
                  required
                  placeholder="README.md"
                  style="width: 220px"
                />
              </div>
              <div>
                <label for="file-message">Commit-Nachricht</label>
                <input
                  id="file-message"
                  v-model="fileMessage"
                  type="text"
                  placeholder="Erste Version"
                />
              </div>
            </div>
            <div class="form-row">
              <label for="file-content">Inhalt (Markdown)</label>
              <textarea
                id="file-content"
                v-model="fileContent"
                rows="8"
                placeholder="# Überschrift&#10;&#10;Beschreibung des Projekts …"
                style="font-family: var(--mono); font-size: 0.85rem"
              ></textarea>
            </div>
            <button class="primary" type="submit" :disabled="fileBusy">
              Datei anlegen
            </button>
          </form>
        </div>

        <div v-if="showModelForm" class="card-body" style="border-bottom: 1px solid var(--border)">
          <p class="muted small" style="margin-top: 0">
            Ein Modell ist eine IFC-Datei mit eigener Versionshistorie und
            eigenen Branches<span v-if="currentPath">
              — wird in „{{ currentPath }}“ angelegt</span>.
          </p>
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

        <div v-if="childFolders.length || modelsInPath.length || currentPath" class="fb-rows">
          <a
            v-if="currentPath"
            href="#"
            class="fb-row"
            @click.prevent="
              goTo('modelle', currentPath.split('/').slice(0, -1).join('/'))
            "
          >
            <span class="fb-icon" aria-hidden="true">
              <PhArrowElbowLeftUp :size="18" />
            </span>
            <span class="fb-name">..</span>
          </a>
          <div v-for="folder in childFolders" :key="folder.path" class="fb-row">
            <span class="fb-icon folder" aria-hidden="true">
              <PhFolder :size="18" weight="fill" />
            </span>
            <a
              href="#"
              class="fb-name"
              @click.prevent="goTo('modelle', folder.path)"
            >{{ folder.name }}</a>
            <span class="fb-meta muted small">
              {{ folder.modelCount }}
              {{ folder.modelCount === 1 ? "Modell" : "Modelle" }}
            </span>
            <button
              v-if="canWrite && folder.modelCount === 0"
              class="link fb-action danger"
              title="Leeren Ordner löschen"
              @click="deleteFolder(folder.path)"
            >
              löschen
            </button>
          </div>
          <div v-for="model in modelsInPath" :key="model.id" class="fb-row">
            <span class="fb-icon" aria-hidden="true">
              <PhFileMd v-if="model.kind === 'md'" :size="18" />
              <PhCube v-else :size="18" />
            </span>
            <NuxtLink :to="`/p/${slug}/m/${model.slug}`" class="fb-name">
              {{ model.name }}
            </NuxtLink>
            <span class="fb-commit muted small">
              <template v-if="model.head">
                {{ model.head.message || "(ohne Nachricht)" }}
              </template>
              <template v-else>Noch keine Commits</template>
            </span>
            <span
              v-if="model.visibility === 'public'"
              class="badge success"
            >öffentlich</span>
            <span class="fb-meta muted small">
              <template v-if="model.head">
                <strong class="fb-author">{{ model.head.author?.name ?? "?" }}</strong>
                · {{ dateFmt.format(new Date(model.head.createdAt)) }}
              </template>
            </span>
          </div>
        </div>
        <div v-else class="empty">
          Noch keine Modelle in diesem Projekt. Jedes Modell ist eine IFC-Datei
          mit eigener Versionshistorie — mit Ordnern lassen sich die Dateien
          sortieren.
        </div>
      </div>

      <!-- README des aktuellen Ordners, wie bei GitHub -->
      <div v-if="readmeHtml && readmeModel" class="card">
        <div class="card-header">
          <PhBookOpen :size="16" aria-hidden="true" style="color: var(--text-muted)" />
          <strong>{{ readmeModel.name }}</strong>
          <span class="topbar-spacer" />
          <NuxtLink
            :to="`/p/${slug}/m/${readmeModel.slug}`"
            class="small"
          >Historie & Bearbeiten</NuxtLink>
        </div>
        <div class="card-body markdown-body" v-html="readmeHtml"></div>
      </div>
    </template>

    <!-- ================= Tab: 3D (alle Modelle in einer Szene) ========= -->
    <template v-else-if="tab === '3d'">
      <div class="card">
        <div class="card-header">
          <strong>3D — alle Modelle</strong>
          <span class="muted small">
            Head-Commits der Standard-Branches, gemeinsame Szene
          </span>
        </div>
        <div v-if="viewerSources.length" class="pv-wrap">
          <div class="pv-side">
            <div class="pv-tree">
              <template
                v-for="row in treeRows"
                :key="row.kind + (row.path ?? row.model?.id ?? '')"
              >
                <div
                  v-if="row.kind === 'folder'"
                  class="pv-item pv-folder"
                  :style="{ paddingLeft: `${row.depth * 0.9 + 0.3}rem` }"
                >
                  <button
                    class="pv-caret"
                    type="button"
                    @click="toggleCollapsed(row.path!)"
                  >
                    <PhCaretRight
                      v-if="collapsedFolders.has(row.path!)"
                      :size="12"
                    />
                    <PhCaretDown v-else :size="12" />
                  </button>
                  <input
                    type="checkbox"
                    :checked="row.state === 'all'"
                    :indeterminate="row.state === 'some'"
                    @change="
                      toggleFolder(
                        row.path!,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <PhFolder :size="14" weight="fill" class="pv-foldericon" />
                  <span class="pv-label">{{ row.name }}</span>
                </div>
                <label
                  v-else
                  class="pv-item"
                  :class="{ disabled: !row.model!.head }"
                  :style="{ paddingLeft: `${row.depth * 0.9 + 1.35}rem` }"
                >
                  <input
                    type="checkbox"
                    :disabled="!row.model!.head"
                    :checked="
                      !!row.model!.head && !hiddenModels.has(row.model!.id)
                    "
                    @change="
                      toggleViewerModel(
                        row.model!.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <span class="pv-label">
                    {{ row.model!.name }}
                    <span v-if="!row.model!.head" class="muted small">
                      (keine Commits)</span
                    >
                  </span>
                  <button
                    v-if="row.model!.head"
                    class="pv-focus"
                    type="button"
                    title="Kamera auf dieses Modell"
                    @click.prevent.stop="projectViewer?.focusModel(row.model!.id)"
                  >
                    <PhCrosshairSimple :size="14" />
                  </button>
                </label>
              </template>
            </div>
            <div v-if="imageNotice" class="pv-notice muted small">
              {{ imageNotice }}
            </div>
            <div class="pv-actions">
              <button :disabled="imageBusy" @click="saveProjectImage">
                <PhImage :size="14" aria-hidden="true" />
                Als Projektbild
              </button>
              <button
                class="link"
                title="Szene als PNG herunterladen"
                @click="downloadSceneImage"
              >
                <PhDownloadSimple :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class="pv-main">
            <ModelViewer ref="projectViewer" :sources="viewerSources" />
          </div>
        </div>
        <div v-else class="empty">
          Noch keine IFC-Modelle mit Commits in diesem Projekt.
        </div>
      </div>
    </template>

    <!-- ================= Tab: Issues ================= -->
    <template v-else-if="tab === 'issues'">
      <div v-if="issueError" class="alert error">{{ issueError }}</div>
      <div class="card">
        <div class="card-header">
          <div class="tabs">
            <button
              :class="{ active: issueFilter === 'open' }"
              @click="issueFilter = 'open'"
            >
              <PhRecord :size="14" aria-hidden="true" />
              {{ issuesData?.openCount ?? 0 }} Offen
            </button>
            <button
              :class="{ active: issueFilter === 'closed' }"
              @click="issueFilter = 'closed'"
            >
              <PhCheckCircle :size="14" aria-hidden="true" />
              {{ issuesData?.closedCount ?? 0 }} Geschlossen
            </button>
          </div>
          <span class="topbar-spacer" />
          <button class="primary" @click="showIssueForm = !showIssueForm">
            <PhPlus :size="14" aria-hidden="true" />
            Neues Issue
          </button>
        </div>

        <div
          v-if="showIssueForm"
          class="card-body"
          style="border-bottom: 1px solid var(--border)"
        >
          <form @submit.prevent="createIssue">
            <div class="form-row">
              <label for="issue-title">Titel</label>
              <input
                id="issue-title"
                v-model="issueTitle"
                type="text"
                required
                placeholder="Kurz und praezise"
              />
            </div>
            <div class="form-row">
              <label for="issue-body">Beschreibung (Markdown)</label>
              <textarea
                id="issue-body"
                v-model="issueBody"
                rows="5"
                placeholder="Was ist das Problem?"
              ></textarea>
            </div>
            <div class="issue-pickers">
              <div class="issue-picker">
                <label>Zugewiesen an</label>
                <label
                  v-for="member in projectData.members"
                  :key="member.userId"
                  class="pv-item"
                >
                  <input
                    type="checkbox"
                    :checked="issueAssignees.has(member.userId)"
                    @change="
                      toggleSet(
                        issueAssignees,
                        member.userId,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <span class="pv-label">{{ member.user?.name ?? member.userId }}</span>
                </label>
              </div>
              <div class="issue-picker">
                <label>Modelle</label>
                <label
                  v-for="model in modelsData?.models ?? []"
                  :key="model.id"
                  class="pv-item"
                >
                  <input
                    type="checkbox"
                    :checked="issueModels.has(model.id)"
                    @change="
                      toggleSet(
                        issueModels,
                        model.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <span class="pv-label">
                    {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
                  </span>
                </label>
              </div>
              <div class="issue-picker">
                <label>Labels</label>
                <LabelPicker
                  :labels="labelsData?.labels ?? []"
                  :selected-ids="[...issueLabels]"
                  editable
                  :create-label="canWrite ? createProjectLabel : undefined"
                  @update="
                    (ids) => {
                      issueLabels.clear();
                      for (const id of ids) issueLabels.add(id);
                    }
                  "
                />
              </div>
            </div>
            <button class="primary" type="submit" :disabled="issueBusy">
              Issue erstellen
            </button>
          </form>
        </div>

        <ul v-if="filteredIssues.length" class="list">
          <li
            v-for="issue in filteredIssues"
            :key="issue.id"
            class="list-item"
          >
            <span class="issue-state" :class="issue.state">
              <PhRecord v-if="issue.state === 'open'" :size="18" />
              <PhCheckCircle v-else :size="18" weight="fill" />
            </span>
            <div class="list-item-main">
              <NuxtLink
                :to="`/p/${slug}/i/${issue.number}`"
                style="font-weight: 600"
              >
                {{ issue.title }}
              </NuxtLink>
              <span
                v-for="label in issue.labels"
                :key="label.id"
                class="label-chip"
                :style="{
                  backgroundColor: label.color,
                  color: labelTextColor(label.color),
                }"
              >{{ label.name }}</span>
              <div class="muted small">
                #{{ issue.number }} · {{ issue.author?.name ?? "?" }} ·
                {{ dateFmt.format(new Date(issue.createdAt)) }}
                <template v-if="issue.models.length">
                  · {{ issue.models.map((m) => m.name).join(", ") }}
                </template>
              </div>
            </div>
            <span v-if="issue.assignees.length" class="muted small">
              &rarr; {{ issue.assignees.map((a) => a.name).join(", ") }}
            </span>
          </li>
        </ul>
        <div v-else class="empty">
          Keine {{ issueFilter === "open" ? "offenen" : "geschlossenen" }}
          Issues.
        </div>
      </div>
    </template>

    <!-- ================= Tab: Mitglieder ================= -->
    <template v-else-if="tab === 'mitglieder'">
      <div class="card">
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
    </template>

    <!-- ================= Tab: Einstellungen ================= -->
    <template v-else>
      <div v-if="isAdmin" class="card">
        <div class="card-header"><h2>Allgemein</h2></div>
        <div class="card-body">
          <div v-if="settingsError" class="alert error">{{ settingsError }}</div>
          <div v-if="settingsNotice" class="alert success">{{ settingsNotice }}</div>
          <div class="form-inline">
            <div class="shrink">
              <label for="project-visibility">Sichtbarkeit</label>
              <select
                id="project-visibility"
                style="width: auto"
                :value="projectData.project.visibility"
                @change="
                  patchProject(
                    ($event.target as HTMLSelectElement).value as
                      | 'private'
                      | 'public',
                  )
                "
              >
                <option value="public">öffentlich (alle angemeldeten Benutzer)</option>
                <option value="private">privat (nur Mitglieder)</option>
              </select>
            </div>
          </div>
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
      <div v-else class="card">
        <div class="card-body muted">
          Projekteinstellungen kann nur der Owner ändern.
        </div>
      </div>
    </template>
  </div>
</template>
