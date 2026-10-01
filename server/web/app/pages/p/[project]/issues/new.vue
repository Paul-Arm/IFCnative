<script setup lang="ts">
import { PhCube, PhInfo, PhListChecks, PhQuestion, PhWarningDiamond } from "@phosphor-icons/vue";

import type { ActionRun, Commit, Issue, IssueKind, Label } from "~/types/api";
import type { PickerItem } from "~/types/ui";

/**
 * Neues Issue: Titel, Markdown-Beschreibung (mit Vorlagen), Art
 * (virtuell/BCF) und rechts Bearbeiter, Labels, Modelle mit Versionsbezug,
 * übergeordnetes Issue. Vorbelegung aus ?fromRun= (fehlgeschlagene
 * Prüfung inkl. betroffener GUIDs) oder ?forModel=.
 */
const route = useRoute();
const project = useProject();
const { slug, detail, models, canWrite } = project;
const { api } = useApi();
const { user } = useAuth();
const toast = useToast();

useHead({ title: computed(() => `Neues Issue · ${detail.value?.project.name ?? slug}`) });

const title = ref("");
const body = ref("");
const kind = ref<IssueKind>("virtual");
const assignees = ref<string[]>([]);
const labelIds = ref<string[]>([]);
const modelIds = ref<string[]>([]);
const foundCommits = reactive(new Map<string, string>());
const parentId = ref("");
const guids = ref<string[]>([]);
const fromRun = ref<number | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

const { data: labelsData, refresh: refreshLabels } = useAsyncData(
  `labels-${slug}`,
  () => api<{ labels: Label[] }>(`/projects/${slug}/labels`),
  { lazy: true },
);
const { data: issuesData } = useAsyncData(
  `issues-${slug}`,
  () => api<{ issues: Issue[] }>(`/projects/${slug}/issues`),
  { lazy: true },
);

// ---- Auswahllisten --------------------------------------------------------

const memberItems = computed<PickerItem[]>(() =>
  (detail.value?.members ?? [])
    .filter((member) => member.user)
    .map((member) => ({ id: member.userId, label: member.user!.name, sub: member.user!.email, user: member.user })),
);
const modelItems = computed<PickerItem[]>(() =>
  (models.value ?? []).map((model) => ({
    id: model.id,
    label: model.name,
    sub: model.folder || undefined,
    model: { kind: model.kind, name: model.name },
  })),
);

const commitsByModel = reactive(new Map<string, Commit[]>());
async function loadCommits(modelId: string): Promise<void> {
  if (commitsByModel.has(modelId)) return;
  const model = (models.value ?? []).find((entry) => entry.id === modelId);
  if (!model) return;
  commitsByModel.set(modelId, []);
  try {
    const result = await api<{ commits: Commit[] }>(`/projects/${slug}/models/${model.slug}/commits`);
    commitsByModel.set(modelId, result.commits);
  } catch {
    commitsByModel.delete(modelId);
  }
}
watch(
  [modelIds, models],
  () => {
    for (const id of modelIds.value) void loadCommits(id);
    for (const id of [...foundCommits.keys()]) {
      if (!modelIds.value.includes(id)) foundCommits.delete(id);
    }
  },
  { deep: true },
);

async function createLabel(name: string, color: string): Promise<Label | null> {
  try {
    const { label } = await api<{ label: Label }>(`/projects/${slug}/labels`, {
      method: "POST",
      body: { name, color },
    });
    await refreshLabels();
    return label;
  } catch (e) {
    toast.error(apiErrorMessage(e));
    return null;
  }
}

// ---- Vorlagen ----------------------------------------------------------------

const TEMPLATES = [
  {
    key: "finding",
    label: "Befund",
    icon: PhWarningDiamond,
    body: "## Beschreibung\n\n\n## Betroffene Bauteile\n\n- \n\n## Erwartet\n\n\n## Vorschlag\n\n",
  },
  {
    key: "question",
    label: "Frage",
    icon: PhQuestion,
    body: "## Frage\n\n\n## Hintergrund\n\n\n## Antwort benötigt bis\n\n",
  },
  {
    key: "task",
    label: "Aufgabe",
    icon: PhListChecks,
    body: "## Aufgabe\n\n\n## Schritte\n\n- [ ] \n- [ ] \n",
  },
];

function applyTemplate(template: (typeof TEMPLATES)[number]): void {
  body.value = template.body;
}

// ---- Vorbelegung --------------------------------------------------------------

async function prefillFromRun(runId: string): Promise<void> {
  try {
    const { run } = await api<{ run: ActionRun }>(`/projects/${slug}/runs/${runId}`);
    fromRun.value = run.number;
    kind.value = "bcf";
    title.value = `Prüfung fehlgeschlagen: ${run.action?.name ?? "Action"}`;
    if (run.modelId) {
      modelIds.value = [run.modelId];
      foundCommits.set(run.modelId, run.commitId);
    }
    guids.value = run.failedGuids ?? [];
    const model = (models.value ?? []).find((entry) => entry.id === run.modelId);
    const lines = [
      `Die Prüfung **${run.action?.name ?? "?"}** (Run #${run.number}) ist fehlgeschlagen.`,
      "",
      `- Modell: **${run.model?.name ?? "?"}**`,
      model
        ? `- Commit: [\`${shortSha(run.commitId)}\`](/p/${slug}/m/${model.slug}/c/${run.commitId})`
        : `- Commit: \`${shortSha(run.commitId)}\``,
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
    body.value = lines.join("\n");
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

// Auch bei reinem Query-Wechsel (gleiche Seite, anderer Run) neu vorbelegen.
watch(
  () => [route.query.fromRun, route.query.forModel] as const,
  ([runId, modelId]) => {
    if (typeof runId === "string" && runId) void prefillFromRun(runId);
    if (typeof modelId === "string" && modelId) modelIds.value = [modelId];
  },
  { immediate: true },
);

// ---- Absenden ------------------------------------------------------------------

async function submit(): Promise<void> {
  if (!title.value.trim() || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const { issue } = await api<{ issue: Issue }>(`/projects/${slug}/issues`, {
      method: "POST",
      body: {
        title: title.value.trim(),
        body: body.value,
        kind: kind.value,
        assigneeIds: assignees.value,
        labelIds: labelIds.value,
        modelLinks: modelIds.value.map((modelId) => ({
          modelId,
          foundCommitId: foundCommits.get(modelId) || null,
        })),
        guids: guids.value,
        parentId: parentId.value || undefined,
      },
    });
    await project.refreshStats();
    toast.success(`Issue #${issue.number} erstellt.`);
    await navigateTo(`/p/${slug}/i/${issue.number}`);
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}

const parentOptions = computed(() =>
  [...(issuesData.value?.issues ?? [])].filter((issue) => issue.state === "open").sort((a, b) => b.number - a.number),
);
</script>

<template>
  <div class="issue-new">
    <div class="page-head">
      <h1>Neues Issue</h1>
    </div>
    <div class="layout">
      <div class="layout-main">
        <div class="compose">
          <UserAvatar :user="user" :size="40" class="compose-avatar hide-sm" />
          <form class="box compose-box" @submit.prevent="submit">
            <div class="box-body">
              <div v-if="error" class="flash flash-danger flash-sm">{{ error }}</div>
              <div class="form-group">
                <label class="form-label" for="issue-title">Titel <span class="color-danger">*</span></label>
                <input
                  id="issue-title"
                  v-model="title"
                  class="input-lg"
                  type="text"
                  required
                  autofocus
                  maxlength="200"
                  placeholder="Kurz und präzise — z. B. „Brandschutzklasse Treppenhauswand 1.OG fehlt“"
                />
              </div>
              <div class="form-group">
                <div class="compose-label-row">
                  <label class="form-label" style="margin: 0">Beschreibung</label>
                  <span class="spacer" />
                  <span v-if="!body.trim()" class="compose-templates">
                    <span class="muted small">Vorlage:</span>
                    <button
                      v-for="template in TEMPLATES"
                      :key="template.key"
                      type="button"
                      class="btn btn-xs"
                      @click="applyTemplate(template)"
                    >
                      <component :is="template.icon" :size="12" /> {{ template.label }}
                    </button>
                  </span>
                </div>
                <MarkdownEditor v-model="body" placeholder="Was ist das Problem? Markdown wird unterstützt." min-height="14rem" />
              </div>

              <div v-if="guids.length" class="flash flash-sm">
                <PhCube :size="16" />
                <div class="flash-body">
                  <strong>{{ guids.length }}</strong> betroffene Objekte<template v-if="fromRun !== null"> aus Run #{{ fromRun }}</template>
                  werden verlinkt und im 3D-Viewer verortet.
                </div>
              </div>

              <div class="compose-foot">
                <div class="seg" role="radiogroup" aria-label="Issue-Art">
                  <button type="button" :class="{ active: kind === 'virtual' }" @click="kind = 'virtual'">
                    Virtuell
                  </button>
                  <button type="button" :class="{ active: kind === 'bcf' }" @click="kind = 'bcf'">
                    IFC-Issue (BCF)
                  </button>
                </div>
                <span class="muted small compose-kind-hint">
                  <PhInfo :size="14" />
                  {{ kind === "bcf" ? "Als BCF exportierbar, mit Viewpoint der verorteten Objekte." : "Lebt nur im Hub." }}
                </span>
                <span class="spacer" />
                <NuxtLink :to="`/p/${slug}/issues`" class="btn">Abbrechen</NuxtLink>
                <button type="submit" class="btn btn-primary" :disabled="busy || !title.trim()">
                  <span v-if="busy" class="spinner" />
                  Issue erstellen
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <aside class="layout-side issue-side">
        <SidePicker
          title="Zugewiesen"
          menu-title="Bis zu 10 Personen zuweisen"
          :items="memberItems"
          :selected="assignees"
          editable
          empty-text="Niemand — "
          @update="(ids) => (assignees = ids)"
        >
          <button
            v-if="!assignees.length && user && memberItems.some((m) => m.id === user!.id)"
            type="button"
            class="link-btn side-self"
            @click="assignees = [user!.id]"
          >
            mir selbst zuweisen
          </button>
        </SidePicker>
        <LabelPicker
          :labels="labelsData?.labels ?? []"
          :selected-ids="labelIds"
          editable
          :create-label="canWrite ? createLabel : undefined"
          @update="(ids) => (labelIds = ids)"
        />
        <SidePicker
          title="Modelle"
          menu-title="Betroffene Modelle"
          :items="modelItems"
          :selected="modelIds"
          editable
          @update="(ids) => (modelIds = ids)"
        >
          <div v-for="modelId in modelIds" :key="`found-${modelId}`" class="side-version">
            <span class="muted small">
              {{ modelItems.find((m) => m.id === modelId)?.label }} — aufgefallen in
            </span>
            <select
              class="input-sm"
              :value="foundCommits.get(modelId) ?? ''"
              @change="
                ($event.target as HTMLSelectElement).value
                  ? foundCommits.set(modelId, ($event.target as HTMLSelectElement).value)
                  : foundCommits.delete(modelId)
              "
            >
              <option value="">— kein bestimmter Stand —</option>
              <option v-for="commit in commitsByModel.get(modelId) ?? []" :key="commit.id" :value="commit.id">
                {{ shortSha(commit.id) }} · {{ commit.message || "(ohne Nachricht)" }} · {{ formatDate(commit.createdAt) }}
              </option>
            </select>
          </div>
        </SidePicker>
        <section class="side-section">
          <div class="side-head"><span>Übergeordnetes Issue</span></div>
          <select v-model="parentId" class="input-sm">
            <option value="">— keines —</option>
            <option v-for="issue in parentOptions" :key="issue.id" :value="issue.id">
              #{{ issue.number }} {{ issue.title }}
            </option>
          </select>
        </section>
      </aside>
    </div>
  </div>
</template>
