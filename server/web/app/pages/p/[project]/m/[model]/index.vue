<script setup lang="ts">
import type {
  Branch,
  Commit,
  GuidDiffSummary,
  Member,
  Model,
  Project,
  Role,
} from "~/types/api";

const route = useRoute();
const { api } = useApi();
const { token } = useAuth();
const slug = route.params.project as string;
const modelSlug = route.params.model as string;
const base = `/projects/${slug}/models/${modelSlug}`;

const { data: modelData, refresh: refreshModel } = await useAsyncData(
  `model-${slug}-${modelSlug}`,
  () => api<{ model: Model; branches: Branch[] }>(base),
);
const { data: projectData } = await useAsyncData(`project-role-${slug}`, () =>
  api<{
    project: Project;
    members: Member[];
    role: Role | null;
    folders: string[];
  }>(`/projects/${slug}`),
);

const folderCrumbs = computed(() => {
  const folder = modelData.value?.model.folder ?? "";
  if (!folder) return [];
  const segments = folder.split("/");
  return segments.map((segment, index) => ({
    label: segment,
    path: segments.slice(0, index + 1).join("/"),
  }));
});
const isAdmin = computed(
  () =>
    projectData.value?.role === "owner" ||
    projectData.value?.role === "maintainer",
);

const selectedBranch = ref<string | null>(null);
watchEffect(() => {
  if (selectedBranch.value === null && modelData.value) {
    selectedBranch.value = modelData.value.model.defaultBranch;
  }
});

const { data: commitsData, refresh: refreshCommits } = await useAsyncData(
  `commits-${slug}-${modelSlug}`,
  () =>
    api<{ commits: Commit[] }>(`${base}/commits`, {
      query: selectedBranch.value ? { branch: selectedBranch.value } : {},
    }),
  { watch: [selectedBranch] },
);

// ---- upload / commit --------------------------------------------------

const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const message = ref("");
const commitBranch = ref<string>("");
const newBranchName = ref("");
const uploadError = ref<string | null>(null);
const uploadResult = ref<{ commit: Commit; diff: GuidDiffSummary } | null>(null);
const uploading = ref(false);

watchEffect(() => {
  if (!commitBranch.value && modelData.value) {
    commitBranch.value = modelData.value.model.defaultBranch;
  }
});

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function submitCommit(): Promise<void> {
  if (!file.value) return;
  uploadError.value = null;
  uploadResult.value = null;
  uploading.value = true;
  try {
    const branch =
      commitBranch.value === "__new__" ? newBranchName.value.trim() : commitBranch.value;
    if (!branch) {
      uploadError.value = "Branch-Name fehlt";
      return;
    }
    const form = new FormData();
    form.append("message", message.value);
    form.append("branch", branch);
    form.append("file", file.value);
    const result = await api<{ commit: Commit; diff: GuidDiffSummary }>(
      `${base}/commits`,
      { method: "POST", body: form },
    );
    uploadResult.value = result;
    message.value = "";
    file.value = null;
    if (fileInput.value) fileInput.value.value = "";
    selectedBranch.value = branch;
    await Promise.all([refreshModel(), refreshCommits()]);
  } catch (e) {
    uploadError.value = apiErrorMessage(e);
  } finally {
    uploading.value = false;
  }
}

// ---- branch anlegen ---------------------------------------------------

const branchName = ref("");
const branchFrom = ref("");
const branchError = ref<string | null>(null);

watchEffect(() => {
  if (!branchFrom.value && modelData.value) {
    branchFrom.value = modelData.value.model.defaultBranch;
  }
});

async function createBranch(): Promise<void> {
  branchError.value = null;
  try {
    await api(`${base}/branches`, {
      method: "POST",
      body: { name: branchName.value.trim(), from: branchFrom.value },
    });
    branchName.value = "";
    await refreshModel();
  } catch (e) {
    branchError.value = apiErrorMessage(e);
  }
}

// ---- Einstellungen ----------------------------------------------------

const settingsError = ref<string | null>(null);
const settingsNotice = ref<string | null>(null);
const folderDraft = ref<string | null>(null);

watchEffect(() => {
  if (folderDraft.value === null && modelData.value) {
    folderDraft.value = modelData.value.model.folder ?? "";
  }
});

async function patchModel(patch: {
  visibility?: "private" | "public";
  defaultBranch?: string;
  folder?: string;
}): Promise<void> {
  settingsError.value = null;
  settingsNotice.value = null;
  try {
    await api(base, { method: "PATCH", body: patch });
    settingsNotice.value = "Gespeichert.";
    await refreshModel();
  } catch (e) {
    settingsError.value = apiErrorMessage(e);
  }
}

async function deleteModel(): Promise<void> {
  const model = modelData.value?.model;
  if (!model) return;
  if (
    !window.confirm(
      `Modell „${model.name}" mit allen Branches und Versionsständen unwiderruflich löschen?`,
    )
  ) {
    return;
  }
  settingsError.value = null;
  try {
    await api(base, { method: "DELETE" });
    await navigateTo(`/p/${slug}`);
  } catch (e) {
    settingsError.value = apiErrorMessage(e);
  }
}

// ---- download ---------------------------------------------------------

async function downloadCommit(commit: Commit): Promise<void> {
  const blob = await $fetch<Blob>(`/api${base}/commits/${commit.id}/file`, {
    responseType: "blob",
    headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${modelSlug}-${commit.id.slice(0, 8)}.ifc`;
  a.click();
  URL.revokeObjectURL(url);
}

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});
</script>

<template>
  <div v-if="modelData">
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/p/${slug}`">{{ slug }}</NuxtLink>
      <template v-for="crumb in folderCrumbs" :key="crumb.path">
        <span>/</span>
        <NuxtLink :to="{ path: `/p/${slug}`, query: { path: crumb.path } }">
          {{ crumb.label }}
        </NuxtLink>
      </template>
      <span>/</span>
      <strong>{{ modelData.model.name }}</strong>
      <span
        class="badge"
        :class="modelData.model.visibility === 'public' ? 'success' : ''"
      >
        {{ modelData.model.visibility === "public" ? "öffentlich" : "privat" }}
      </span>
      <span class="badge">Standard-Branch: {{ modelData.model.defaultBranch }}</span>
    </nav>

    <div class="card">
      <div class="card-header">
        <h2>Commits</h2>
        <span class="topbar-spacer" />
        <div class="tabs">
          <button
            v-for="branch in modelData.branches"
            :key="branch.id"
            :class="{ active: selectedBranch === branch.name }"
            @click="selectedBranch = branch.name"
          >
            {{ branch.name }}
          </button>
          <button
            :class="{ active: selectedBranch === '' }"
            @click="selectedBranch = ''"
          >
            alle
          </button>
        </div>
      </div>
      <div v-if="commitsData?.commits.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nachricht</th>
              <th>Autor</th>
              <th>Datum</th>
              <th>Änderungen</th>
              <th>Entities</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="commit in commitsData.commits" :key="commit.id">
              <td>
                <NuxtLink :to="`/p/${slug}/m/${modelSlug}/c/${commit.id}`">
                  {{ commit.message || "(ohne Nachricht)" }}
                </NuxtLink>
                <div class="commit-id">
                  {{ commit.id.slice(0, 8) }} · {{ commit.branchName }}
                </div>
              </td>
              <td>{{ commit.author?.name ?? "?" }}</td>
              <td class="small">{{ dateFmt.format(new Date(commit.createdAt)) }}</td>
              <td>
                <span class="diffstat">
                  <span class="add">+{{ commit.added }}</span>
                  <span class="mod">~{{ commit.modified }}</span>
                  <span class="del">−{{ commit.removed }}</span>
                </span>
              </td>
              <td class="small">{{ commit.entityCount }}</td>
              <td>
                <button class="link" @click="downloadCommit(commit)">.ifc</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">Noch keine Commits auf diesem Branch.</div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Neuen Stand committen</h2></div>
      <div class="card-body">
        <div v-if="uploadError" class="alert error">{{ uploadError }}</div>
        <div v-if="uploadResult" class="alert success">
          Commit {{ uploadResult.commit.id.slice(0, 8) }} angelegt —
          {{ uploadResult.diff.added.length }} neu,
          {{ uploadResult.diff.modified.length }} geändert,
          {{ uploadResult.diff.removed.length }} entfernt<span
            v-if="uploadResult.diff.identical"
          >
            (inhaltlich identisch mit dem Vorgänger)</span
          >.
        </div>
        <form @submit.prevent="submitCommit">
          <div class="form-row">
            <label for="commit-file">IFC-Datei</label>
            <input
              id="commit-file"
              ref="fileInput"
              type="file"
              accept=".ifc,application/x-step"
              required
              @change="onFileChange"
            />
          </div>
          <div class="form-row">
            <label for="commit-message">Commit-Nachricht</label>
            <input
              id="commit-message"
              v-model="message"
              type="text"
              placeholder="Was hat sich geändert?"
            />
          </div>
          <div class="form-inline">
            <div class="shrink">
              <label for="commit-branch">Branch</label>
              <select id="commit-branch" v-model="commitBranch" style="width: auto">
                <option
                  v-for="branch in modelData.branches"
                  :key="branch.id"
                  :value="branch.name"
                >
                  {{ branch.name }}
                </option>
                <option
                  v-if="!modelData.branches.length"
                  :value="modelData.model.defaultBranch"
                >
                  {{ modelData.model.defaultBranch }}
                </option>
                <option value="__new__">neuer Branch …</option>
              </select>
            </div>
            <div v-if="commitBranch === '__new__'" class="shrink">
              <label for="new-branch-name">Name des neuen Branch</label>
              <input
                id="new-branch-name"
                v-model="newBranchName"
                type="text"
                placeholder="variante-a"
              />
            </div>
            <div class="shrink">
              <button class="primary" type="submit" :disabled="uploading || !file">
                {{ uploading ? "Lädt hoch …" : "Committen" }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isAdmin" class="card">
      <div class="card-header"><h2>Einstellungen</h2></div>
      <div class="card-body">
        <div v-if="settingsError" class="alert error">{{ settingsError }}</div>
        <div v-if="settingsNotice" class="alert success">{{ settingsNotice }}</div>
        <div class="form-inline">
          <div class="shrink">
            <label for="settings-visibility">Sichtbarkeit</label>
            <select
              id="settings-visibility"
              style="width: auto"
              :value="modelData.model.visibility"
              @change="
                patchModel({
                  visibility: ($event.target as HTMLSelectElement)
                    .value as 'private' | 'public',
                })
              "
            >
              <option value="private">privat</option>
              <option value="public">öffentlich</option>
            </select>
          </div>
          <div class="shrink">
            <label for="settings-default-branch">Standard-Branch</label>
            <select
              id="settings-default-branch"
              style="width: auto"
              :value="modelData.model.defaultBranch"
              @change="
                patchModel({
                  defaultBranch: ($event.target as HTMLSelectElement).value,
                })
              "
            >
              <option
                v-for="branch in modelData.branches"
                :key="branch.id"
                :value="branch.name"
              >
                {{ branch.name }}
              </option>
            </select>
          </div>
          <div>
            <label for="settings-folder">Ordner ("" = Wurzel)</label>
            <div class="form-inline" style="align-items: center">
              <input
                id="settings-folder"
                v-model="folderDraft"
                type="text"
                list="project-folders"
                placeholder="z.B. Hochbau/EG"
                style="max-width: 260px"
              />
              <datalist id="project-folders">
                <option
                  v-for="folder in projectData?.folders ?? []"
                  :key="folder"
                  :value="folder"
                />
              </datalist>
              <button
                class="shrink"
                :disabled="folderDraft === (modelData.model.folder ?? '')"
                @click="patchModel({ folder: folderDraft ?? '' })"
              >
                Verschieben
              </button>
            </div>
          </div>
          <div class="shrink" style="margin-left: auto">
            <button class="danger" @click="deleteModel">Modell löschen</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Branch anlegen</h2></div>
      <div class="card-body">
        <div v-if="branchError" class="alert error">{{ branchError }}</div>
        <form class="form-inline" @submit.prevent="createBranch">
          <div>
            <label for="branch-name">Name</label>
            <input
              id="branch-name"
              v-model="branchName"
              type="text"
              required
              placeholder="variante-a"
            />
          </div>
          <div class="shrink">
            <label for="branch-from">Ausgehend von</label>
            <select id="branch-from" v-model="branchFrom" style="width: auto">
              <option
                v-for="branch in modelData.branches"
                :key="branch.id"
                :value="branch.name"
              >
                {{ branch.name }}
              </option>
            </select>
          </div>
          <div class="shrink">
            <button type="submit">Anlegen</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
