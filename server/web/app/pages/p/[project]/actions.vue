<script setup lang="ts">
import {
  PhBooks,
  PhCheckCircle,
  PhCode,
  PhDotsThree,
  PhDownloadSimple,
  PhFileCode,
  PhPlayCircle,
  PhPlus,
  PhShieldCheck,
  PhTerminalWindow,
  PhTrash,
  PhUploadSimple,
} from "@phosphor-icons/vue";
import hljs from "highlight.js/lib/core";
import pythonLang from "highlight.js/lib/languages/python";

import type { Action, ActionKind, ActionRun, LibraryFile } from "~/types/api";

/**
 * Actions wie bei GitHub: links die Prüf-Workflows (IDS/Python), rechts die
 * Runs — filterbar, aufklappbar mit Live-Protokoll. `?action=` wählt einen
 * Workflow, `?run=` klappt einen Run auf.
 */
const route = useRoute();
const router = useRouter();
const project = useProject();
const { slug, detail, models, canWrite } = project;
const { api } = useApi();
const { token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();

useHead({ title: computed(() => `Actions · ${detail.value?.project.name ?? slug}`) });

const {
  data: actionsData,
  refresh: refreshActions,
  status: actionsStatus,
} = useAsyncData(`actions-${slug}`, () => api<{ actions: Action[] }>(`/projects/${slug}/actions`), {
  lazy: true,
});
const actions = computed(() => actionsData.value?.actions ?? []);
const runsApi = useProjectRuns(slug);
const runs = runsApi.runs;

const selectedId = computed(() => (typeof route.query.action === "string" ? route.query.action : null));
const selected = computed(() => actions.value.find((action) => action.id === selectedId.value) ?? null);

function select(id: string | null): void {
  void router.replace({ query: id ? { action: id } : {} });
}

/** Jüngster Run je Action (Status-Punkt in der Seitenleiste). */
const latestByAction = computed(() => {
  const map = new Map<string, ActionRun>();
  for (const run of runs.value) {
    const known = map.get(run.actionId);
    if (!known || known.number < run.number) map.set(run.actionId, run);
  }
  return map;
});

// ---- Filter ----------------------------------------------------------------

type StatusFilter = "all" | "failed" | "success" | "active";
const statusFilter = ref<StatusFilter>("all");
const modelFilter = ref("");

const shownRuns = computed(() =>
  runs.value
    .filter((run) => !selectedId.value || run.actionId === selectedId.value)
    .filter((run) => {
      if (statusFilter.value === "failed") return run.status === "failed" || run.status === "error";
      if (statusFilter.value === "success") return run.status === "success";
      if (statusFilter.value === "active") return isRunPending(run.status);
      return true;
    })
    .filter((run) => !modelFilter.value || run.modelId === modelFilter.value)
    .sort((a, b) => b.number - a.number),
);

const PAGE = 30;
const limit = ref(PAGE);
watch([selectedId, statusFilter, modelFilter], () => (limit.value = PAGE));

const runModels = computed(() => {
  const ids = new Set(runs.value.map((run) => run.modelId));
  return (models.value ?? []).filter((model) => ids.has(model.id));
});

// ---- Aufklappen (inkl. ?run=) ------------------------------------------------

const openRuns = reactive(new Set<string>());
function toggleRun(id: string): void {
  if (openRuns.has(id)) openRuns.delete(id);
  else openRuns.add(id);
}

watch(
  () => [route.query.run, runs.value.length] as const,
  ([runId]) => {
    if (typeof runId !== "string" || !runs.value.some((run) => run.id === runId)) return;
    openRuns.add(runId);
    const index = shownRuns.value.findIndex((run) => run.id === runId);
    if (index >= limit.value) limit.value = index + 1;
    nextTick(() => document.getElementById(`run-${runId}`)?.scrollIntoView({ block: "center" }));
  },
  { immediate: true },
);

// ---- Action verwalten ---------------------------------------------------------

function scopeLabel(action: Action): string {
  if (action.scopeModelId) return `Modell: ${action.scopeModelName ?? "?"}`;
  if (action.scopeFolder) return `Ordner: ${action.scopeFolder}/`;
  return "Alle IFC-Modelle";
}

async function toggleRunOnCommit(action: Action, event: Event): Promise<void> {
  try {
    await api(`/projects/${slug}/actions/${action.id}`, {
      method: "PATCH",
      body: { runOnCommit: !action.runOnCommit },
    });
    await refreshActions();
  } catch (e) {
    // Schalter zurückstellen — die Daten ändern sich nicht, Vue patcht ihn nicht.
    (event.target as HTMLInputElement).checked = action.runOnCommit;
    toast.error(apiErrorMessage(e));
  }
}

async function removeAction(action: Action): Promise<void> {
  const ok = await confirm({
    title: `Action „${action.name}“ löschen?`,
    message: "Alle bisherigen Runs dieser Action werden ebenfalls gelöscht.",
    confirmLabel: "Action löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}/actions/${action.id}`, { method: "DELETE" });
    select(null);
    await Promise.all([refreshActions(), runsApi.refresh(), project.refreshStats()]);
    toast.success("Action gelöscht.");
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

async function downloadActionFile(action: Action): Promise<void> {
  try {
    const blob = await $fetch<Blob>(`/api/projects/${slug}/actions/${action.id}/file`, {
      responseType: "blob",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = action.fileName;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- Neue Action ----------------------------------------------------------------

const { data: libraryData } = useAsyncData("library", () => api<{ files: LibraryFile[] }>("/library"), {
  lazy: true,
});

const createOpen = ref(false);
const form = reactive({
  source: "upload" as "upload" | "library",
  kind: "ids" as ActionKind,
  file: null as File | null,
  libraryId: "",
  name: "",
  scope: "project" as "project" | "folder" | "model",
  folder: "",
  modelId: "",
  runOnCommit: true,
});
const createBusy = ref(false);
const createError = ref<string | null>(null);

function openCreate(): void {
  Object.assign(form, {
    source: "upload",
    kind: "ids",
    file: null,
    libraryId: "",
    name: "",
    scope: "project",
    folder: "",
    modelId: "",
    runOnCommit: true,
  });
  createError.value = null;
  createOpen.value = true;
}

function onFile(event: Event): void {
  form.file = (event.target as HTMLInputElement).files?.[0] ?? null;
  if (form.file && !form.name) form.name = form.file.name.replace(/\.(ids|xml|py)$/i, "");
}

watch(
  () => form.libraryId,
  (id) => {
    const entry = libraryData.value?.files.find((file) => file.id === id);
    if (entry && !form.name) form.name = entry.name;
  },
);

async function createAction(): Promise<void> {
  createError.value = null;
  const scope: Record<string, string> = {};
  if (form.scope === "folder") {
    if (!form.folder) return void (createError.value = "Bitte einen Ordner wählen.");
    scope.scopeFolder = form.folder;
  } else if (form.scope === "model") {
    if (!form.modelId) return void (createError.value = "Bitte ein Modell wählen.");
    scope.scopeModelId = form.modelId;
  }
  let body: Record<string, unknown>;
  if (form.source === "library") {
    if (!form.libraryId) return void (createError.value = "Bitte einen Bibliothekseintrag wählen.");
    body = { name: form.name, libraryFileId: form.libraryId, runOnCommit: form.runOnCommit, ...scope };
  } else {
    if (!form.file) return void (createError.value = "Bitte eine Datei wählen.");
    body = {
      name: form.name,
      kind: form.kind,
      fileName: form.file.name,
      content: await form.file.text(),
      runOnCommit: form.runOnCommit,
      ...scope,
    };
  }
  createBusy.value = true;
  try {
    const { action } = await api<{ action: Action }>(`/projects/${slug}/actions`, { method: "POST", body });
    createOpen.value = false;
    await refreshActions();
    select(action.id);
    toast.success(`Action „${action.name}“ angelegt.`);
  } catch (e) {
    createError.value = apiErrorMessage(e);
  } finally {
    createBusy.value = false;
  }
}

// ---- Python-Vorlage ----------------------------------------------------------------

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
const templateHtml = computed(() => hljs.highlight(PY_TEMPLATE, { language: "python" }).value);
const templateOpen = ref(false);
const templateCopied = ref(false);

async function copyTemplate(): Promise<void> {
  try {
    await navigator.clipboard.writeText(PY_TEMPLATE);
    templateCopied.value = true;
    setTimeout(() => (templateCopied.value = false), 2000);
  } catch {
    toast.error("Kopieren nicht möglich — Vorlage manuell markieren.");
  }
}

function useTemplate(): void {
  form.source = "upload";
  form.kind = "python";
  form.file = new File([PY_TEMPLATE], "check.py", { type: "text/x-python" });
  if (!form.name) form.name = "check";
  templateOpen.value = false;
  createOpen.value = true;
}
</script>

<template>
  <div class="layout side-left narrow-side actions-page">
    <!-- ============ Workflows ============ -->
    <aside class="layout-side actions-side">
      <div class="actions-side-head">
        <h2>Actions</h2>
        <button v-if="canWrite" type="button" class="btn btn-primary btn-sm" @click="openCreate">
          <PhPlus :size="14" /> Neu
        </button>
      </div>
      <nav class="sidenav">
        <button type="button" class="sidenav-item" :class="{ active: !selectedId }" @click="select(null)">
          <PhShieldCheck :size="16" /> Alle Prüfungen
          <span class="counter">{{ runs.length }}</span>
        </button>
        <div class="sidenav-heading">Workflows</div>
        <SkeletonRows v-if="actionsStatus === 'pending' && !actionsData" :rows="2" />
        <button
          v-for="action in actions"
          :key="action.id"
          type="button"
          class="sidenav-item"
          :class="{ active: selectedId === action.id }"
          @click="select(action.id)"
        >
          <PhFileCode v-if="action.kind === 'ids'" :size="16" />
          <PhTerminalWindow v-else :size="16" />
          <span class="truncate" style="flex: 1">{{ action.name }}</span>
          <RunStatusIcon
            v-if="latestByAction.get(action.id)"
            :status="latestByAction.get(action.id)!.status"
            :size="14"
          />
        </button>
        <p v-if="actionsData && !actions.length" class="muted small" style="padding: 0 8px">
          Noch keine Workflows.
        </p>
        <div class="sidenav-heading">Werkzeuge</div>
        <NuxtLink to="/library" class="sidenav-item"><PhBooks :size="16" /> Zentrale Bibliothek</NuxtLink>
        <button type="button" class="sidenav-item" @click="templateOpen = true">
          <PhCode :size="16" /> Python-Vorlage
        </button>
      </nav>
    </aside>

    <!-- ============ Runs ============ -->
    <div class="layout-main">
      <div class="actions-head">
        <div class="actions-title">
          <h1>{{ selected ? selected.name : "Alle Prüfungen" }}</h1>
          <div v-if="selected" class="actions-meta">
            <span class="tag tag-mono">{{ selected.kind === "ids" ? "IDS" : "Python" }}</span>
            <span class="tag">{{ scopeLabel(selected) }}</span>
            <button type="button" class="link-btn mono small" @click="downloadActionFile(selected)">
              {{ selected.fileName }}
            </button>
            <span v-if="selected.libraryFileId" class="tag tag-accent" title="Datei aus der zentralen Bibliothek">
              <PhBooks :size="12" /> {{ selected.libraryName ?? "Bibliothek" }}
            </span>
          </div>
          <p v-else class="muted" style="margin: 4px 0 0">
            IDS- und Python-Prüfungen laufen automatisch bei jedem Commit oder per „Jetzt prüfen“ auf einer Commit-Seite.
          </p>
        </div>
        <div v-if="selected && canWrite" class="actions-controls">
          <label class="switch" title="Bei jedem neuen Commit im Geltungsbereich automatisch ausführen">
            <input type="checkbox" :checked="selected.runOnCommit" @change="toggleRunOnCommit(selected, $event)" />
            <span class="switch-track" />
            Bei Commit
          </label>
          <UiMenu align="right">
            <template #trigger="{ toggle }">
              <button type="button" class="btn btn-icon" aria-label="Weitere Aktionen" @click="toggle">
                <PhDotsThree :size="16" weight="bold" />
              </button>
            </template>
            <button type="button" class="menu-item" @click="downloadActionFile(selected)">
              <PhDownloadSimple :size="16" /> Prüfdatei herunterladen
            </button>
            <div class="menu-sep" />
            <button type="button" class="menu-item danger" @click="removeAction(selected)">
              <PhTrash :size="16" /> Action löschen
            </button>
          </UiMenu>
        </div>
      </div>

      <div class="actions-filters">
        <div class="seg" role="radiogroup" aria-label="Status">
          <button type="button" :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">Alle</button>
          <button type="button" :class="{ active: statusFilter === 'failed' }" @click="statusFilter = 'failed'">
            Fehlgeschlagen
          </button>
          <button type="button" :class="{ active: statusFilter === 'success' }" @click="statusFilter = 'success'">
            Bestanden
          </button>
          <button type="button" :class="{ active: statusFilter === 'active' }" @click="statusFilter = 'active'">
            Laufend
          </button>
        </div>
        <select v-if="runModels.length > 1" v-model="modelFilter" class="auto input-sm" aria-label="Modell">
          <option value="">Alle Modelle</option>
          <option v-for="model in runModels" :key="model.id" :value="model.id">{{ model.name }}</option>
        </select>
        <span class="spacer" />
        <span class="muted small">{{ plural(shownRuns.length, "Run", "Runs") }}</span>
      </div>

      <div class="box">
        <SkeletonRows v-if="runsApi.pending.value" :rows="4" dots />
        <Blankslate
          v-else-if="!actions.length"
          :icon="PhShieldCheck"
          title="Automatische Prüfungen einrichten"
          blueprint
        >
          Actions prüfen IFC-Modelle bei jedem Commit — mit <strong>IDS-Dateien</strong> (buildingSMART)
          oder eigenen <strong>Python-Skripten</strong>. Verstöße werden im 3D verortet und lassen sich direkt
          als Issue anlegen.
          <template v-if="canWrite" #actions>
            <button type="button" class="btn btn-primary" @click="openCreate"><PhPlus :size="16" /> Erste Action anlegen</button>
            <button type="button" class="btn" @click="templateOpen = true"><PhCode :size="16" /> Python-Vorlage ansehen</button>
          </template>
        </Blankslate>
        <Blankslate v-else-if="!shownRuns.length" :icon="PhPlayCircle" title="Keine Runs" compact>
          {{
            statusFilter !== "all" || modelFilter
              ? "Für diesen Filter gibt es keine Runs."
              : "Runs entstehen bei Commits oder über „Jetzt prüfen“ auf einer Commit-Seite."
          }}
        </Blankslate>
        <template v-else>
          <div
            v-for="run in shownRuns.slice(0, limit)"
            :id="`run-${run.id}`"
            :key="run.id"
            class="run-item"
            :class="{ open: openRuns.has(run.id) }"
          >
            <button type="button" class="run-head" @click="toggleRun(run.id)">
              <RunStatusIcon :status="run.status" :size="18" />
              <span class="run-main">
                <span class="run-line">
                  <strong class="truncate">{{ run.action?.name ?? "(gelöschte Action)" }}</strong>
                  <span class="muted">#{{ run.number }}</span>
                </span>
                <span class="run-sub">
                  <template v-if="run.model">
                    <ModelIcon kind="ifc" :name="run.model.name" :size="12" />
                    {{ run.model.name }}
                  </template>
                  <NuxtLink
                    v-if="run.model"
                    :to="`/p/${slug}/m/${run.model.slug}/c/${run.commitId}`"
                    class="sha"
                    @click.stop
                  >{{ shortSha(run.commitId) }}</NuxtLink>
                  <span class="truncate">{{ run.summary || RUN_STATUS_LABEL[run.status] }}</span>
                </span>
              </span>
              <span class="run-when">
                <span class="row" style="justify-content: flex-end">
                  <UserAvatar v-if="run.triggeredBy" :user="run.triggeredBy" :size="16" />
                  <RelTime :date="run.createdAt" />
                </span>
                <span v-if="runDuration(run) !== null" class="muted small">{{ formatDuration(runDuration(run)!) }}</span>
              </span>
            </button>
            <div v-if="openRuns.has(run.id)" class="run-body">
              <RunDetails
                :slug="slug"
                :run="run"
                :can-write="canWrite"
                @updated="runsApi.apply"
                @retried="() => runsApi.refresh()"
              >
                <template #actions>
                  <NuxtLink
                    v-if="run.status === 'failed' || run.status === 'error'"
                    class="btn btn-sm"
                    :to="`/p/${slug}/issues/new?fromRun=${run.id}`"
                  >
                    <PhCheckCircle :size="14" /> Issue aus Run erstellen
                  </NuxtLink>
                  <span v-if="run.failedGuids.length" class="muted small">
                    {{ run.failedGuids.length }} betroffene Objekte
                  </span>
                </template>
              </RunDetails>
            </div>
          </div>
          <div v-if="shownRuns.length > limit" class="box-footer" style="text-align: center">
            <button type="button" class="btn btn-sm" @click="limit += PAGE">Weitere Runs anzeigen</button>
          </div>
        </template>
      </div>
    </div>

    <!-- ============ Dialog: Neue Action ============ -->
    <UiDialog v-model:open="createOpen" title="Neue Action" subtitle="Prüf-Workflow für IFC-Modelle" size="md" :persistent="createBusy">
      <form class="action-form" @submit.prevent="createAction">
        <div v-if="createError" class="flash flash-danger flash-sm">{{ createError }}</div>
        <div class="form-group">
          <span class="form-label">Prüfdatei</span>
          <div class="seg">
            <button type="button" :class="{ active: form.source === 'upload' }" @click="form.source = 'upload'">
              <PhUploadSimple :size="14" /> Datei hochladen
            </button>
            <button type="button" :class="{ active: form.source === 'library' }" @click="form.source = 'library'">
              <PhBooks :size="14" /> Aus Bibliothek
            </button>
          </div>
        </div>

        <template v-if="form.source === 'upload'">
          <div class="form-group">
            <span class="form-label">Art</span>
            <div class="choice-list">
              <label class="choice">
                <input v-model="form.kind" type="radio" value="ids" />
                <span class="choice-icon"><PhFileCode :size="20" /></span>
                <span class="choice-text">
                  <strong>IDS-Prüfung</strong>
                  <span>buildingSMART Information Delivery Specification (.ids) — läuft komplett auf dem Server.</span>
                </span>
              </label>
              <label class="choice">
                <input v-model="form.kind" type="radio" value="python" />
                <span class="choice-icon"><PhTerminalWindow :size="20" /></span>
                <span class="choice-text">
                  <strong>Python-Skript</strong>
                  <span>
                    Eigene Logik; Exit-Code 0 = bestanden.
                    <button type="button" class="link-btn" @click="templateOpen = true">Vorlage ansehen</button>
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="action-file">Datei</label>
            <div class="row">
              <label class="btn file-btn">
                <PhUploadSimple :size="16" />
                {{ form.kind === "ids" ? ".ids wählen" : ".py wählen" }}
                <input id="action-file" type="file" :accept="form.kind === 'ids' ? '.ids,.xml' : '.py'" @change="onFile" />
              </label>
              <span v-if="form.file" class="mono small truncate">{{ form.file.name }}</span>
              <span v-else class="muted small">keine Datei gewählt</span>
            </div>
          </div>
        </template>
        <div v-else class="form-group">
          <label class="form-label" for="action-library">Bibliothekseintrag</label>
          <select id="action-library" v-model="form.libraryId" :disabled="!libraryData?.files.length">
            <option value="" disabled>{{ libraryData?.files.length ? "bitte wählen …" : "Bibliothek ist leer" }}</option>
            <option v-for="entry in libraryData?.files ?? []" :key="entry.id" :value="entry.id">
              {{ entry.kind === "ids" ? "IDS" : "Python" }} · {{ entry.name }} ({{ entry.fileName }})
            </option>
          </select>
          <p class="form-hint">Änderungen in der Bibliothek gelten sofort in allen verknüpften Actions.</p>
        </div>

        <div class="form-group">
          <label class="form-label" for="action-name">Name</label>
          <input
            id="action-name"
            v-model="form.name"
            type="text"
            required
            :placeholder="form.kind === 'ids' ? 'z. B. IDS Hochbau' : 'z. B. Kollisions-Check'"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="action-scope">Gilt für</label>
          <div class="row wrap">
            <select id="action-scope" v-model="form.scope" class="auto">
              <option value="project">Alle IFC-Modelle des Projekts</option>
              <option value="folder">Einen Ordner (inkl. Unterordner)</option>
              <option value="model">Ein einzelnes Modell</option>
            </select>
            <select v-if="form.scope === 'folder'" v-model="form.folder" class="auto">
              <option value="" disabled>Ordner wählen …</option>
              <option v-for="folder in detail?.folders ?? []" :key="folder" :value="folder">{{ folder }}/</option>
            </select>
            <select v-if="form.scope === 'model'" v-model="form.modelId" class="auto">
              <option value="" disabled>Modell wählen …</option>
              <option v-for="model in (models ?? []).filter((m) => m.kind === 'ifc')" :key="model.id" :value="model.id">
                {{ model.folder ? `${model.folder}/` : "" }}{{ model.name }}
              </option>
            </select>
          </div>
        </div>

        <label class="switch">
          <input v-model="form.runOnCommit" type="checkbox" />
          <span class="switch-track" />
          Bei jedem neuen Commit im Geltungsbereich automatisch ausführen
        </label>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="createBusy" @click="createOpen = false">Abbrechen</button>
        <button type="button" class="btn btn-primary" :disabled="createBusy || !form.name.trim()" @click="createAction">
          <span v-if="createBusy" class="spinner" /> Action anlegen
        </button>
      </template>
    </UiDialog>

    <!-- ============ Dialog: Python-Vorlage ============ -->
    <UiDialog v-model:open="templateOpen" title="Python-Skript-Vorlage" subtitle="check.py" size="lg" flush>
      <template #header-actions>
        <button type="button" class="btn btn-sm" @click="copyTemplate">
          {{ templateCopied ? "Kopiert ✓" : "Kopieren" }}
        </button>
        <button v-if="canWrite" type="button" class="btn btn-sm btn-primary" @click="useTemplate">
          Als Action verwenden
        </button>
      </template>
      <pre class="code-block"><code v-html="templateHtml" /></pre>
    </UiDialog>
  </div>
</template>
