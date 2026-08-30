<script setup lang="ts">
import hljs from "highlight.js/lib/core";
import pythonLang from "highlight.js/lib/languages/python";
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
  PhPlayCircle,
  PhPlus,
  PhRecord,
  PhShieldCheck,
  PhUploadSimple,
  PhUsers,
} from "@phosphor-icons/vue";

import type {
  Action,
  ActionKind,
  ActionRun,
  Commit,
  Issue,
  IssueKind,
  Label,
  LibraryFile,
  Member,
  Model,
  Project,
  Role,
} from "~/types/api";

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

type Tab =
  | "modelle"
  | "3d"
  | "issues"
  | "actions"
  | "mitglieder"
  | "einstellungen";
const tab = computed<Tab>(() => {
  const value = route.query.tab;
  return value === "3d" ||
    value === "issues" ||
    value === "actions" ||
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
/** "virtual" = nur im Server; "bcf" = echtes IFC-Issue (BCF-exportierbar). */
const issueKind = ref<IssueKind>("virtual");
const issueAssignees = reactive(new Set<string>());
const issueModels = reactive(new Set<string>());
const issueLabels = reactive(new Set<string>());
/** Betroffene GlobalIds (aus einem Prüf-Run) — verorten das Issue in 3D. */
const issueGuids = ref<string[]>([]);
const issueFromRun = ref<number | null>(null);
const issueBusy = ref(false);
const issueError = ref<string | null>(null);

// ---- Versionsbezug: "Aufgefallen in" Commit je gewähltem Modell --------

/** Commits je Modell (lazy geladen, sobald ein Modell angehakt wird). */
const commitsByModel = reactive(new Map<string, Commit[]>());
/** Gewählter "Aufgefallen in"-Commit je Modell-Id ("" = keiner). */
const issueFoundCommits = reactive(new Map<string, string>());

async function loadModelCommits(modelId: string): Promise<void> {
  if (commitsByModel.has(modelId)) return;
  const model = (modelsData.value?.models ?? []).find(
    (entry) => entry.id === modelId,
  );
  if (!model) return;
  commitsByModel.set(modelId, []);
  try {
    const result = await api<{ commits: Commit[] }>(
      `/projects/${slug}/models/${model.slug}/commits`,
    );
    commitsByModel.set(modelId, result.commits);
  } catch {
    commitsByModel.delete(modelId);
  }
}

function toggleIssueModel(modelId: string, on: boolean): void {
  toggleSet(issueModels, modelId, on);
  if (on) {
    void loadModelCommits(modelId);
  } else {
    issueFoundCommits.delete(modelId);
  }
}

const commitShort = (commit: Commit) =>
  `${commit.id.slice(0, 8)} · ${commit.message || "(ohne Nachricht)"} · ${new Date(commit.createdAt).toLocaleDateString("de-DE")}`;

// "Issue aus Run erstellen": befüllt das Formular mit Prüfbericht,
// Modell-Verknüpfung und den GUIDs der Verstöße (Button an fehlgeschlagenen
// Runs bzw. ?fromRun=<id> von der Commit-Seite aus).
async function prefillIssueFromRun(runId: string): Promise<void> {
  try {
    const { run } = await api<{ run: ActionRun }>(
      `/projects/${slug}/runs/${runId}`,
    );
    showIssueForm.value = true;
    issueFromRun.value = run.number;
    // Prüf-Issues mit Verortung sind echte IFC-Issues (BCF) — vorbelegen.
    issueKind.value = "bcf";
    issueTitle.value = `Prüfung fehlgeschlagen: ${run.action?.name ?? "Action"}`;
    if (run.modelId) {
      issueModels.add(run.modelId);
      // Der geprüfte Commit ist der Stand, in dem der Fehler aufgefallen ist.
      issueFoundCommits.set(run.modelId, run.commitId);
      void loadModelCommits(run.modelId);
    }
    issueGuids.value = run.failedGuids ?? [];
    const model = (modelsData.value?.models ?? []).find(
      (entry) => entry.id === run.modelId,
    );
    const lines = [
      `Die Prüfung **${run.action?.name ?? "?"}** (Run #${run.number}) ist fehlgeschlagen.`,
      "",
      `- Modell: **${run.model?.name ?? "?"}**`,
      model
        ? `- Commit: [\`${run.commitId.slice(0, 8)}\`](/p/${slug}/m/${model.slug}/c/${run.commitId})`
        : `- Commit: \`${run.commitId.slice(0, 8)}\``,
      `- Ergebnis: ${run.summary || "siehe Protokoll"}`,
    ];
    if (run.log) {
      lines.push(
        "",
        "```",
        run.log.length > 3000 ? `${run.log.slice(0, 3000)}\n… (gekürzt)` : run.log,
        "```",
      );
    }
    issueBody.value = lines.join("\n");
    // Formular in den Blick holen.
    goTo("issues");
  } catch (e) {
    issueError.value = apiErrorMessage(e);
  }
}

onMounted(() => {
  const fromRun = route.query.fromRun;
  if (typeof fromRun === "string" && fromRun) {
    void prefillIssueFromRun(fromRun);
  }
  // Von der Modellseite: Formular öffnen, Modell vorverknüpfen.
  const forModel = route.query.forModel;
  if (typeof forModel === "string" && forModel) {
    showIssueForm.value = true;
    issueModels.add(forModel);
    void loadModelCommits(forModel);
    goTo("issues");
  }
});

const hasBcfIssues = computed(() =>
  (issuesData.value?.issues ?? []).some((issue) => issue.kind === "bcf"),
);
const issueNotice = ref<string | null>(null);
const bcfImportBusy = ref(false);

/** .bcfzip hochladen — jedes Topic wird ein BCF-Issue. */
async function importBcf(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  issueError.value = null;
  issueNotice.value = null;
  bcfImportBusy.value = true;
  try {
    const result = await $fetch<{ imported: number; skipped: number }>(
      `/api/projects/${slug}/issues/bcf`,
      {
        method: "POST",
        body: await file.arrayBuffer(),
        headers: {
          "content-type": "application/zip",
          ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
        },
      },
    );
    issueNotice.value =
      `BCF-Import: ${result.imported} Issue(s) importiert` +
      (result.skipped
        ? `, ${result.skipped} übersprungen (bereits vorhanden).`
        : ".");
    await refreshIssues();
  } catch (e) {
    issueError.value = apiErrorMessage(e);
  } finally {
    bcfImportBusy.value = false;
  }
}

/** Alle BCF-Issues des Projekts als .bcfzip herunterladen. */
async function downloadProjectBcf(): Promise<void> {
  issueError.value = null;
  try {
    const blob = await $fetch<Blob>(`/api/projects/${slug}/issues/bcf`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-issues.bcfzip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    issueError.value = apiErrorMessage(e);
  }
}

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
        kind: issueKind.value,
        assigneeIds: [...issueAssignees],
        modelLinks: [...issueModels].map((modelId) => ({
          modelId,
          foundCommitId: issueFoundCommits.get(modelId) || null,
        })),
        labelIds: [...issueLabels],
        guids: issueGuids.value,
      },
    });
    issueTitle.value = "";
    issueBody.value = "";
    issueKind.value = "virtual";
    issueFoundCommits.clear();
    issueAssignees.clear();
    issueModels.clear();
    issueLabels.clear();
    issueGuids.value = [];
    issueFromRun.value = null;
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

// ---- Actions (Prüf-Workflows wie bei GitHub) ---------------------------

const { data: actionsData, refresh: refreshActions } = await useAsyncData(
  `actions-${slug}`,
  () => api<{ actions: Action[] }>(`/projects/${slug}/actions`),
);
// Zentrale Bibliothek für den "Aus Bibliothek"-Picker im Anlege-Formular.
const { data: libraryData } = await useAsyncData("library", () =>
  api<{ files: LibraryFile[] }>("/library"),
);
const { data: runsData, refresh: refreshRuns } = await useAsyncData(
  `runs-${slug}`,
  () => api<{ runs: ActionRun[] }>(`/projects/${slug}/runs`),
);

const RUN_STATUS: Record<
  ActionRun["status"],
  { label: string; cls: string }
> = {
  queued: { label: "Wartet", cls: "" },
  running: { label: "Läuft …", cls: "accent" },
  success: { label: "Bestanden", cls: "success" },
  failed: { label: "Fehlgeschlagen", cls: "danger" },
  error: { label: "Fehler", cls: "warn" },
};

const showActionForm = ref(false);
const actionName = ref("");
const actionKind = ref<ActionKind>("ids");
const actionRunOnCommit = ref(true);
const actionFile = ref<File | null>(null);
/** Quelle der Prüfdatei: eigener Upload oder zentraler Bibliothekseintrag. */
const actionSource = ref<"upload" | "library">("upload");
const actionLibraryId = ref("");
/** Geltungsbereich: alle Modelle, ein Ordner oder ein einzelnes Modell. */
const actionScopeType = ref<"project" | "folder" | "model">("project");
const actionScopeFolder = ref("");
const actionScopeModelId = ref("");
const actionBusy = ref(false);
const actionError = ref<string | null>(null);

/** Beschreibt den Geltungsbereich einer Action für die Tabelle. */
function scopeLabel(action: Action): string {
  if (action.scopeModelId) {
    return `Modell: ${action.scopeModelName ?? action.scopeModelId}`;
  }
  if (action.scopeFolder) {
    return `Ordner: ${action.scopeFolder}/`;
  }
  return "Alle Modelle";
}

function onActionFile(event: Event): void {
  actionFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  if (!actionName.value && actionFile.value) {
    actionName.value = actionFile.value.name.replace(/\.(ids|xml|py)$/i, "");
  }
}

// ---- Python-Skript-Vorlage ---------------------------------------------

const showPyTemplate = ref(false);
const pyTemplateCopied = ref(false);

const PY_TEMPLATE = `#!/usr/bin/env python3
"""Prüfskript-Vorlage für IFC-Hub-Actions.

Aufruf durch den Hub:   python check.py <pfad/zur/modell.ifc>
- Der IFC-Pfad kommt als Argument 1 und als Umgebungsvariable IFC_PATH.
- Exit-Code 0  = Prüfung bestanden, alles andere = fehlgeschlagen.
- stdout/stderr landen im Run-Protokoll; die erste Zeile wird das Kurzfazit.
- Zeilen im Format "GUID: <GlobalId>" markieren betroffene Objekte:
  sie werden am Run gespeichert, in Issues übernommen und im
  3D-Viewer verortet.
"""
import re
import sys

ifc_path = sys.argv[1]
with open(ifc_path, encoding="utf-8", errors="replace") as handle:
    text = handle.read()

# --- Beispiel: alle IfcWall ohne Namen melden --------------------------
# (durch eigene Prüf-Logik ersetzen)
fehler: list[str] = []
for match in re.finditer(r"IFCWALL\\('([^']{22})',[^,]*,\\s*(\\$|'')", text):
    fehler.append(match.group(1))

if fehler:
    print(f"{len(fehler)} Wand/Wände ohne Namen")
    for guid in fehler:
        print(f"GUID: {guid}")
    sys.exit(1)

print("Alle Prüfungen bestanden")
sys.exit(0)
`;

hljs.registerLanguage("python", pythonLang);

/** Vorlage mit Syntax-Highlighting (hljs-Klassen, gestylt in main.css). */
const pyTemplateHtml = computed(
  () => hljs.highlight(PY_TEMPLATE, { language: "python" }).value,
);

async function copyPyTemplate(): Promise<void> {
  try {
    await navigator.clipboard.writeText(PY_TEMPLATE);
    pyTemplateCopied.value = true;
    setTimeout(() => {
      pyTemplateCopied.value = false;
    }, 2000);
  } catch {
    actionError.value = "Kopieren nicht möglich — Vorlage manuell markieren.";
  }
}

/** Vorlage direkt als Datei ins Formular übernehmen. */
function usePyTemplate(): void {
  actionFile.value = new File([PY_TEMPLATE], "check.py", {
    type: "text/x-python",
  });
  if (!actionName.value) {
    actionName.value = "check";
  }
  showPyTemplate.value = false;
}

/** Formular schließen und alle Eingaben zurücksetzen. */
function resetActionForm(): void {
  showActionForm.value = false;
  actionError.value = null;
  actionName.value = "";
  actionKind.value = "ids";
  actionSource.value = "upload";
  actionFile.value = null;
  actionLibraryId.value = "";
  actionScopeType.value = "project";
  actionScopeFolder.value = "";
  actionScopeModelId.value = "";
  actionRunOnCommit.value = true;
  showPyTemplate.value = false;
}

async function createAction(): Promise<void> {
  actionError.value = null;
  // Geltungsbereich zusammenstellen und prüfen.
  const scope: Record<string, string> = {};
  if (actionScopeType.value === "folder") {
    if (!actionScopeFolder.value) {
      actionError.value = "Bitte einen Ordner als Geltungsbereich wählen.";
      return;
    }
    scope.scopeFolder = actionScopeFolder.value;
  } else if (actionScopeType.value === "model") {
    if (!actionScopeModelId.value) {
      actionError.value = "Bitte ein Modell als Geltungsbereich wählen.";
      return;
    }
    scope.scopeModelId = actionScopeModelId.value;
  }
  let body: Record<string, unknown>;
  if (actionSource.value === "library") {
    if (!actionLibraryId.value) {
      actionError.value = "Bitte einen Bibliothekseintrag auswählen.";
      return;
    }
    body = {
      name: actionName.value,
      libraryFileId: actionLibraryId.value,
      runOnCommit: actionRunOnCommit.value,
      ...scope,
    };
  } else {
    if (!actionFile.value) {
      actionError.value = "Bitte eine Datei auswählen.";
      return;
    }
    body = {
      name: actionName.value,
      kind: actionKind.value,
      fileName: actionFile.value.name,
      content: await actionFile.value.text(),
      runOnCommit: actionRunOnCommit.value,
      ...scope,
    };
  }
  actionBusy.value = true;
  try {
    await api(`/projects/${slug}/actions`, { method: "POST", body });
    resetActionForm();
    await refreshActions();
  } catch (e) {
    actionError.value = apiErrorMessage(e);
  } finally {
    actionBusy.value = false;
  }
}

// Name vorbelegen, wenn ein Bibliothekseintrag gewählt wird.
watch(actionLibraryId, (id) => {
  const entry = libraryData.value?.files.find((file) => file.id === id);
  if (entry && !actionName.value) {
    actionName.value = entry.name;
  }
});

async function toggleRunOnCommit(action: Action): Promise<void> {
  actionError.value = null;
  try {
    await api(`/projects/${slug}/actions/${action.id}`, {
      method: "PATCH",
      body: { runOnCommit: !action.runOnCommit },
    });
    await refreshActions();
  } catch (e) {
    actionError.value = apiErrorMessage(e);
  }
}

async function removeAction(action: Action): Promise<void> {
  if (
    !window.confirm(
      `Action „${action.name}" samt aller bisherigen Runs löschen?`,
    )
  ) {
    return;
  }
  actionError.value = null;
  try {
    await api(`/projects/${slug}/actions/${action.id}`, { method: "DELETE" });
    await Promise.all([refreshActions(), refreshRuns()]);
  } catch (e) {
    actionError.value = apiErrorMessage(e);
  }
}

async function downloadActionFile(action: Action): Promise<void> {
  const blob = await $fetch<Blob>(
    `/api/projects/${slug}/actions/${action.id}/file`,
    {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = action.fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Run-Log wird erst beim Aufklappen geladen (kann groß sein).
const runLogs = reactive(new Map<string, string | "loading">());

async function loadRunLog(run: ActionRun): Promise<void> {
  if (runLogs.has(run.id)) return;
  runLogs.set(run.id, "loading");
  try {
    const result = await api<{ run: ActionRun }>(
      `/projects/${slug}/runs/${run.id}`,
    );
    runLogs.set(run.id, result.run.log ?? "");
  } catch {
    runLogs.delete(run.id);
  }
}

// Solange Runs laufen, den Stand alle 3 s nachladen (und fertige Logs
// verwerfen, damit sie beim nächsten Aufklappen frisch kommen).
const hasPendingRuns = computed(() =>
  (runsData.value?.runs ?? []).some(
    (run) => run.status === "queued" || run.status === "running",
  ),
);
let runsTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  runsTimer = setInterval(() => {
    if (hasPendingRuns.value) {
      for (const run of runsData.value?.runs ?? []) {
        if (run.status === "queued" || run.status === "running") {
          runLogs.delete(run.id);
        }
      }
      void refreshRuns();
    }
  }, 3000);
});
onBeforeUnmount(() => clearInterval(runsTimer));

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
      <button :class="{ active: tab === 'actions' }" @click="goTo('actions')">
        <PhPlayCircle :size="16" aria-hidden="true" />
        Actions
        <span class="counter">{{ actionsData?.actions.length ?? 0 }}</span>
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
              <label>Inhalt (Markdown)</label>
              <MarkdownEditor
                v-model="fileContent"
                placeholder="Beschreibung des Projekts …"
                min-height="12rem"
              />
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
      <div v-if="issueNotice" class="alert success">{{ issueNotice }}</div>
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
          <label
            v-if="canWrite"
            class="btn"
            :style="bcfImportBusy ? 'opacity: 0.6; pointer-events: none' : ''"
            title=".bcfzip importieren — jedes Topic wird ein IFC-Issue (BCF) mit Kommentaren und 3D-Verortung"
          >
            {{ bcfImportBusy ? "Importiere …" : "BCF-Import" }}
            <input
              type="file"
              accept=".bcf,.bcfzip,.zip"
              style="display: none"
              @change="importBcf"
            />
          </label>
          <button
            v-if="hasBcfIssues"
            title="Alle IFC-Issues (BCF) als .bcfzip exportieren"
            @click="downloadProjectBcf"
          >
            BCF-Export
          </button>
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
            <div class="form-inline">
              <div>
                <label for="issue-title">Titel</label>
                <input
                  id="issue-title"
                  v-model="issueTitle"
                  type="text"
                  required
                  placeholder="Kurz und praezise"
                />
              </div>
              <div class="shrink">
                <label for="issue-kind">Art</label>
                <select
                  id="issue-kind"
                  v-model="issueKind"
                  style="width: auto"
                  title="Virtuelle Issues leben nur im Server; IFC-Issues sind als BCF exportierbar (Austausch mit anderen BIM-Werkzeugen)"
                >
                  <option value="virtual">Virtuell (nur Server)</option>
                  <option value="bcf">IFC-Issue (BCF)</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <label>Beschreibung (Markdown)</label>
              <MarkdownEditor
                v-model="issueBody"
                placeholder="Was ist das Problem?"
                min-height="8rem"
              />
            </div>
            <p v-if="issueGuids.length" class="muted small" style="margin: 0.5rem 0 0">
              3D-Verortung:
              <strong>{{ issueGuids.length }}</strong>
              Objekt-GUIDs
              <template v-if="issueFromRun !== null">
                aus Run #{{ issueFromRun }}
              </template>
              werden mit dem Issue verlinkt.
            </p>
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
                      toggleIssueModel(
                        model.id,
                        ($event.target as HTMLInputElement).checked,
                      )
                    "
                  />
                  <span class="pv-label">
                    {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
                  </span>
                </label>
                <!-- Versionsbezug: in welchem Stand ist der Fehler aufgefallen? -->
                <template v-for="modelId in [...issueModels]" :key="`fc-${modelId}`">
                  <div class="issue-found-commit">
                    <span class="muted small">
                      {{
                        (modelsData?.models ?? []).find((m) => m.id === modelId)
                          ?.name ?? "?"
                      }}
                      — aufgefallen in:
                    </span>
                    <select
                      style="width: 100%"
                      :value="issueFoundCommits.get(modelId) ?? ''"
                      @change="
                        ($event.target as HTMLSelectElement).value
                          ? issueFoundCommits.set(
                              modelId,
                              ($event.target as HTMLSelectElement).value,
                            )
                          : issueFoundCommits.delete(modelId)
                      "
                    >
                      <option value="">— kein Commit —</option>
                      <option
                        v-for="commit in commitsByModel.get(modelId) ?? []"
                        :key="commit.id"
                        :value="commit.id"
                      >
                        {{ commitShort(commit) }}
                      </option>
                    </select>
                  </div>
                </template>
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
                v-if="issue.kind === 'bcf'"
                class="badge accent"
                title="Echtes IFC-Issue — als BCF exportierbar"
              >BCF</span>
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

    <!-- ================= Tab: Actions (Prüf-Workflows) ================= -->
    <template v-else-if="tab === 'actions'">
      <div v-if="actionError" class="alert error">{{ actionError }}</div>

      <div class="card">
        <div class="card-header">
          <h2>Actions</h2>
          <span class="topbar-spacer" />
          <button
            v-if="canWrite"
            class="btn primary"
            @click="showActionForm = !showActionForm"
          >
            ＋ Neue Action
          </button>
        </div>

        <div
          v-if="showActionForm"
          class="card-body"
          style="border-bottom: 1px solid var(--border)"
        >
          <form class="action-form" @submit.prevent="createAction">
            <div class="af-row">
              <label>Prüfdatei</label>
              <div class="af-control">
                <div class="seg">
                  <button
                    type="button"
                    :class="{ active: actionSource === 'upload' }"
                    @click="actionSource = 'upload'"
                  >
                    Datei hochladen
                  </button>
                  <button
                    type="button"
                    :class="{ active: actionSource === 'library' }"
                    @click="actionSource = 'library'"
                  >
                    Aus zentraler Bibliothek
                  </button>
                </div>
              </div>
            </div>

            <template v-if="actionSource === 'upload'">
              <div class="af-row">
                <label>Art</label>
                <div class="af-control">
                  <div class="seg">
                    <button
                      type="button"
                      :class="{ active: actionKind === 'ids' }"
                      @click="actionKind = 'ids'"
                    >
                      IDS-Prüfung
                    </button>
                    <button
                      type="button"
                      :class="{ active: actionKind === 'python' }"
                      @click="actionKind = 'python'"
                    >
                      Python-Skript
                    </button>
                  </div>
                  <p v-if="actionKind === 'ids'" class="field-hint">
                    buildingSMART-IDS-XML — läuft komplett auf dem Server.
                  </p>
                  <p v-else class="field-hint">
                    Läuft auf dem Server; Exit-Code 0 = bestanden.
                    <button
                      type="button"
                      class="link-btn"
                      @click="showPyTemplate = true"
                    >
                      Skript-Vorlage anzeigen
                    </button>
                  </p>
                </div>
              </div>
              <div class="af-row">
                <label>Datei</label>
                <div class="af-control">
                  <label class="file-pick">
                    <input
                      type="file"
                      :accept="actionKind === 'ids' ? '.ids,.xml' : '.py'"
                      @change="onActionFile"
                    />
                    <span class="btn">
                      <PhUploadSimple :size="14" aria-hidden="true" />
                      {{ actionKind === "ids" ? ".ids wählen …" : ".py wählen …" }}
                    </span>
                    <span v-if="actionFile" class="file-name mono">
                      {{ actionFile.name }}
                    </span>
                    <span v-else class="muted small">keine Datei gewählt</span>
                  </label>
                </div>
              </div>
            </template>

            <div v-else class="af-row">
              <label for="action-library">Bibliothekseintrag</label>
              <div class="af-control">
                <select
                  id="action-library"
                  v-model="actionLibraryId"
                  :disabled="!libraryData?.files.length"
                >
                  <option value="" disabled>
                    {{ libraryData?.files.length ? "bitte wählen …" : "Bibliothek ist leer" }}
                  </option>
                  <option
                    v-for="entry in libraryData?.files ?? []"
                    :key="entry.id"
                    :value="entry.id"
                  >
                    {{ entry.kind === "ids" ? "IDS" : "Python" }} ·
                    {{ entry.name }} ({{ entry.fileName }})
                  </option>
                </select>
                <p class="field-hint">
                  Zentrale Dateien gelten projektübergreifend; Aktualisierungen
                  in der <NuxtLink to="/library">Bibliothek</NuxtLink> wirken
                  sofort in allen verknüpften Actions.
                </p>
              </div>
            </div>

            <div class="af-row">
              <label for="action-name">Name</label>
              <div class="af-control">
                <input
                  id="action-name"
                  v-model="actionName"
                  :placeholder="actionKind === 'ids' ? 'z. B. IDS Hochbau' : 'z. B. Kollisions-Check'"
                  required
                />
              </div>
            </div>

            <div class="af-row">
              <label>Gilt für</label>
              <div class="af-control af-control-row">
                <select v-model="actionScopeType" style="width: auto">
                  <option value="project">Alle Modelle des Projekts</option>
                  <option value="folder">Einen Ordner (inkl. Unterordner)</option>
                  <option value="model">Ein einzelnes Modell</option>
                </select>
                <select
                  v-if="actionScopeType === 'folder'"
                  v-model="actionScopeFolder"
                  style="flex: 1; min-width: 180px"
                >
                  <option value="" disabled>Ordner wählen …</option>
                  <option
                    v-for="folder in projectData.folders"
                    :key="folder"
                    :value="folder"
                  >
                    {{ folder }}/
                  </option>
                </select>
                <select
                  v-if="actionScopeType === 'model'"
                  v-model="actionScopeModelId"
                  style="flex: 1; min-width: 180px"
                >
                  <option value="" disabled>Modell wählen …</option>
                  <option
                    v-for="model in (modelsData?.models ?? []).filter((m) => m.kind === 'ifc')"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
                  </option>
                </select>
              </div>
            </div>

            <div class="af-row">
              <label>Automatik</label>
              <div class="af-control">
                <label class="action-form-check">
                  <input
                    v-model="actionRunOnCommit"
                    type="checkbox"
                    style="width: auto"
                  />
                  Bei jedem neuen Commit im Geltungsbereich automatisch ausführen
                </label>
              </div>
            </div>

            <div class="action-form-footer">
              <button class="btn primary" type="submit" :disabled="actionBusy">
                {{ actionBusy ? "Wird angelegt …" : "Action anlegen" }}
              </button>
              <button
                class="btn"
                type="button"
                :disabled="actionBusy"
                @click="resetActionForm"
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>

        <div v-if="!actionsData?.actions.length" class="empty empty-rich">
          <PhShieldCheck :size="30" aria-hidden="true" class="empty-icon" />
          <div class="empty-title">Noch keine Actions konfiguriert</div>
          <p>
            Actions prüfen deine IFC-Modelle automatisch — mit
            <strong>IDS-Dateien</strong> oder <strong>Python-Skripten</strong>,
            bei jedem Commit oder auf Knopfdruck.
          </p>
          <button v-if="canWrite" class="btn primary" @click="showActionForm = true">
            ＋ Erste Action anlegen
          </button>
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Art</th>
                <th>Gilt für</th>
                <th>Datei</th>
                <th>Bei Commit</th>
                <th v-if="canWrite"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="action in actionsData.actions" :key="action.id">
                <td><strong>{{ action.name }}</strong></td>
                <td>
                  <span class="badge" :class="action.kind === 'ids' ? 'accent' : ''">
                    {{ action.kind === "ids" ? "IDS" : "Python" }}
                  </span>
                </td>
                <td class="small">
                  <span
                    class="badge"
                    :class="!action.scopeFolder && !action.scopeModelId ? '' : 'accent'"
                  >{{ scopeLabel(action) }}</span>
                </td>
                <td class="small mono">
                  <a href="#" @click.prevent="downloadActionFile(action)">
                    {{ action.fileName }}
                  </a>
                  <span v-if="action.libraryFileId" class="badge" title="Datei kommt aus der zentralen Bibliothek">
                    Bibliothek{{ action.libraryName ? `: ${action.libraryName}` : "" }}
                  </span>
                </td>
                <td>
                  <input
                    type="checkbox"
                    style="width: auto"
                    :checked="action.runOnCommit"
                    :disabled="!canWrite"
                    @change="toggleRunOnCommit(action)"
                  />
                </td>
                <td v-if="canWrite" style="text-align: right">
                  <button class="btn danger small" @click="removeAction(action)">
                    Löschen
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Runs</h2>
          <span v-if="hasPendingRuns" class="badge accent">läuft …</span>
        </div>
        <div v-if="!runsData?.runs.length" class="empty empty-rich">
          <PhPlayCircle :size="30" aria-hidden="true" class="empty-icon" />
          <div class="empty-title">Noch keine Runs</div>
          <p>
            Runs entstehen automatisch bei Commits (Actions mit
            „Bei Commit ausführen") oder über „Jetzt prüfen" auf der
            Commit-Seite.
          </p>
        </div>
        <div v-else>
          <details
            v-for="run in runsData.runs"
            :key="run.id"
            class="tree-group"
            @toggle="(e: Event) => (e.target as HTMLDetailsElement).open && loadRunLog(run)"
          >
            <summary>
              <span class="muted small">#{{ run.number }}</span>
              <span class="badge" :class="RUN_STATUS[run.status].cls">
                {{ RUN_STATUS[run.status].label }}
              </span>
              <strong>{{ run.action?.name ?? "(gelöschte Action)" }}</strong>
              <span class="muted small">
                {{ run.model?.name ?? "?" }} ·
                <NuxtLink
                  v-if="run.model"
                  :to="`/p/${slug}/m/${run.model.slug}/c/${run.commitId}`"
                  class="commit-id"
                >{{ run.commitId.slice(0, 8) }}</NuxtLink>
                · {{ dateFmt.format(new Date(run.createdAt)) }}
                <template v-if="run.triggeredBy">
                  · {{ run.triggeredBy.name }}
                </template>
              </span>
            </summary>
            <div class="tree-children">
              <p v-if="run.summary" class="small" style="margin: 0.5rem 0">
                {{ run.summary }}
              </p>
              <p
                v-if="run.status === 'failed' || run.status === 'error'"
                style="margin: 0.5rem 0"
              >
                <button
                  class="btn small"
                  title="Issue mit Prüfbericht, Modell-Verknüpfung und den GUIDs der Verstöße anlegen"
                  @click="prefillIssueFromRun(run.id)"
                >
                  Issue aus Run erstellen
                </button>
                <span v-if="run.failedGuids.length" class="muted small">
                  {{ run.failedGuids.length }} betroffene Objekte werden verlinkt
                </span>
              </p>
              <div v-if="runLogs.get(run.id) === 'loading'" class="muted small">
                Lade Protokoll …
              </div>
              <pre
                v-else-if="runLogs.get(run.id)"
                class="run-log"
              >{{ runLogs.get(run.id) }}</pre>
              <div v-else class="muted small">Kein Protokoll vorhanden.</div>
            </div>
          </details>
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

    <!-- Modal: Python-Skript-Vorlage (mit Syntax-Highlighting) -->
    <div
      v-if="showPyTemplate"
      class="modal-backdrop"
      @click.self="showPyTemplate = false"
    >
      <div class="card modal modal-wide">
        <div class="card-header">
          <h2>Python-Skript-Vorlage</h2>
          <span class="muted small mono">check.py</span>
          <span class="topbar-spacer" />
          <button type="button" class="btn small" @click="copyPyTemplate">
            {{ pyTemplateCopied ? "Kopiert ✓" : "Kopieren" }}
          </button>
          <button
            type="button"
            class="btn small primary"
            title="Vorlage direkt als Prüfdatei ins Formular übernehmen"
            @click="usePyTemplate"
          >
            Als Datei übernehmen
          </button>
          <button
            type="button"
            class="link"
            title="Schließen"
            @click="showPyTemplate = false"
          >
            ✕
          </button>
        </div>
        <pre class="py-code"><code v-html="pyTemplateHtml"></code></pre>
      </div>
    </div>
  </div>
</template>
