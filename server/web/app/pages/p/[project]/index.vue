<script setup lang="ts">
import {
  PhArrowElbowLeftUp,
  PhBookOpen,
  PhCubeTransparent,
  PhCube,
  PhFileMd,
  PhFolder,
  PhFolderPlus,
  PhFolders,
  PhGear,
  PhUsers,
} from "@phosphor-icons/vue";

import type { Member, Model, Project, Role } from "~/types/api";

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

type Tab = "modelle" | "3d" | "mitglieder" | "einstellungen";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  return value === "3d" || value === "mitglieder" || value === "einstellungen"
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
            <label
              v-for="model in viewerModels"
              :key="model.id"
              class="pv-item"
              :class="{ disabled: !model.head }"
            >
              <input
                type="checkbox"
                :disabled="!model.head"
                :checked="!!model.head && !hiddenModels.has(model.id)"
                @change="
                  toggleViewerModel(
                    model.id,
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              <span class="pv-label">
                {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
                <span v-if="!model.head" class="muted small">
                  (keine Commits)</span
                >
              </span>
            </label>
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
