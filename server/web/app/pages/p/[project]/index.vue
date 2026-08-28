<script setup lang="ts">
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

type Tab = "modelle" | "mitglieder" | "einstellungen";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  return value === "mitglieder" || value === "einstellungen"
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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 1h5.5c.966 0 1.75.784 1.75 1.75v1h4a1.75 1.75 0 0 1 1.75 1.75v7.75A1.75 1.75 0 0 1 13 15H3a1.75 1.75 0 0 1-1.75-1.75V2.75C1.25 1.784 1.284 1 1.75 1ZM2.75 2.5v10.75c0 .138.112.25.25.25h10a.25.25 0 0 0 .25-.25V5.5a.25.25 0 0 0-.25-.25H8.75v-2.5a.25.25 0 0 0-.25-.25h-5.5a.25.25 0 0 0-.25.25Z"/></svg>
        Modelle
        <span class="counter">{{ modelsData?.models.length ?? 0 }}</span>
      </button>
      <button :class="{ active: tab === 'mitglieder' }" @click="goTo('mitglieder')">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z"/></svg>
        Mitglieder
        <span class="counter">{{ projectData.members.length }}</span>
      </button>
      <button
        :class="{ active: tab === 'einstellungen' }"
        @click="goTo('einstellungen')"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/></svg>
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
          <template v-if="canWrite">
            <button @click="showFolderForm = !showFolderForm; showModelForm = false">
              Neuer Ordner
            </button>
            <button
              class="primary"
              @click="showModelForm = !showModelForm; showFolderForm = false"
            >
              Neues Modell
            </button>
          </template>
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
            <span class="fb-icon folder" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>
            </span>
            <span class="fb-name">..</span>
          </a>
          <div v-for="folder in childFolders" :key="folder.path" class="fb-row">
            <span class="fb-icon folder" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>
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
                {{ dateFmt.format(new Date(model.head.createdAt)) }}
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
