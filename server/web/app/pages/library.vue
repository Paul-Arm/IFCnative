<script setup lang="ts">
import {
  PhArrowsClockwise,
  PhBooks,
  PhDotsThree,
  PhDownloadSimple,
  PhEye,
  PhFileCode,
  PhMagnifyingGlass,
  PhPlus,
  PhTerminalWindow,
  PhTrash,
  PhUploadSimple,
} from "@phosphor-icons/vue";
import hljs from "highlight.js/lib/core";
import pythonLang from "highlight.js/lib/languages/python";
import xmlLang from "highlight.js/lib/languages/xml";

import type { ActionKind, LibraryFile } from "~/types/api";

/**
 * Zentrale Bibliothek: IDS-Dateien und Python-Prüfskripte, die Projekte
 * als Action verwenden. Aktualisierungen gelten sofort überall.
 */
const { api } = useApi();
const { user, token } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();

useHead({ title: "Bibliothek · IFC Hub" });

hljs.registerLanguage("python", pythonLang);
hljs.registerLanguage("xml", xmlLang);

const { data, refresh, status } = useAsyncData("library", () => api<{ files: LibraryFile[] }>("/library"), {
  lazy: true,
});

const query = ref("");
const kindFilter = ref<"all" | ActionKind>("all");
const files = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return (data.value?.files ?? []).filter(
    (file) =>
      (kindFilter.value === "all" || file.kind === kindFilter.value) &&
      (!needle || `${file.name} ${file.fileName}`.toLowerCase().includes(needle)),
  );
});

function canModify(entry: LibraryFile): boolean {
  return Boolean(user.value?.isAdmin || entry.ownerId === user.value?.id);
}

async function fetchText(entry: LibraryFile): Promise<string> {
  return $fetch<string>(`/api/library/${entry.id}/file`, {
    responseType: "text",
    headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
  });
}

// ---- Ansehen -------------------------------------------------------------------

const viewing = ref<LibraryFile | null>(null);
const viewHtml = ref<string | null>(null);

async function view(entry: LibraryFile): Promise<void> {
  viewing.value = entry;
  viewHtml.value = null;
  try {
    const text = await fetchText(entry);
    // Inzwischen andere Datei geöffnet oder Dialog geschlossen → verwerfen.
    if (viewing.value !== entry) return;
    viewHtml.value = hljs.highlight(text, { language: entry.kind === "python" ? "python" : "xml" }).value;
  } catch (e) {
    if (viewing.value !== entry) return;
    toast.error(apiErrorMessage(e));
    viewing.value = null;
  }
}

async function download(entry: LibraryFile): Promise<void> {
  try {
    const text = await fetchText(entry);
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.fileName;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

// ---- Ablegen / Aktualisieren / Löschen ----------------------------------------------

const uploadOpen = ref(false);
const newKind = ref<ActionKind>("ids");
const newFile = ref<File | null>(null);
const newName = ref("");
const uploadBusy = ref(false);

function openUpload(): void {
  newKind.value = "ids";
  newFile.value = null;
  newName.value = "";
  uploadOpen.value = true;
}

function onFile(event: Event): void {
  newFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  if (newFile.value) {
    if (/\.py$/i.test(newFile.value.name)) newKind.value = "python";
    if (!newName.value) newName.value = newFile.value.name.replace(/\.(ids|xml|py)$/i, "");
  }
}

async function upload(): Promise<void> {
  if (!newFile.value) return;
  uploadBusy.value = true;
  try {
    await api("/library", {
      method: "POST",
      body: {
        name: newName.value,
        kind: newKind.value,
        fileName: newFile.value.name,
        content: await newFile.value.text(),
      },
    });
    uploadOpen.value = false;
    await refresh();
    toast.success(`„${newName.value}“ in der Bibliothek abgelegt.`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    uploadBusy.value = false;
  }
}

// Ein gemeinsames Dateifeld für „Neue Version hochladen“ — der Menüeintrag
// ist ein Button (per Tastatur erreichbar), kein Label um ein verstecktes Feld.
const replaceInput = ref<HTMLInputElement | null>(null);
const replaceTarget = ref<LibraryFile | null>(null);

function pickReplacement(entry: LibraryFile): void {
  replaceTarget.value = entry;
  // accept-Attribut erst aktualisieren, dann den Dateidialog öffnen
  nextTick(() => replaceInput.value?.click());
}

async function replace(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const entry = replaceTarget.value;
  input.value = "";
  if (!file || !entry) return;
  try {
    await api(`/library/${entry.id}`, {
      method: "PATCH",
      body: { content: await file.text(), fileName: file.name },
    });
    await refresh();
    toast.success(`„${entry.name}“ aktualisiert — gilt sofort in ${plural(entry.usageCount, "Action", "Actions")}.`);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

async function remove(entry: LibraryFile): Promise<void> {
  const ok = await confirm({
    title: `„${entry.name}“ löschen?`,
    message: entry.usageCount
      ? `Die Datei wird noch von ${plural(entry.usageCount, "Action", "Actions")} verwendet — erst dort entfernen.`
      : "Die Datei wird aus der Bibliothek entfernt.",
    confirmLabel: "Löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/library/${entry.id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Bibliothek</h1>
      <span class="spacer" />
      <button type="button" class="btn btn-primary" @click="openUpload"><PhPlus :size="16" /> Datei ablegen</button>
      <p class="page-sub">
        Zentrale IDS-Dateien und Python-Prüfskripte — Projekte nutzen sie als Action, Aktualisierungen gelten sofort überall.
      </p>
    </div>

    <div class="projects-toolbar">
      <div class="input-icon" style="flex: 1 1 260px">
        <PhMagnifyingGlass :size="16" />
        <input v-model="query" type="search" placeholder="Bibliothek durchsuchen …" aria-label="Bibliothek durchsuchen" />
      </div>
      <div class="seg" role="radiogroup" aria-label="Art">
        <button type="button" :class="{ active: kindFilter === 'all' }" @click="kindFilter = 'all'">Alle</button>
        <button type="button" :class="{ active: kindFilter === 'ids' }" @click="kindFilter = 'ids'">IDS</button>
        <button type="button" :class="{ active: kindFilter === 'python' }" @click="kindFilter = 'python'">Python</button>
      </div>
    </div>

    <div class="box">
      <SkeletonRows v-if="status === 'pending' && !data" :rows="3" dots />
      <Blankslate v-else-if="!data?.files.length" :icon="PhBooks" title="Die Bibliothek ist leer" blueprint>
        Lege firmenweite Prüfregeln einmal ab — etwa die IDS „Hochbau“ oder ein Kollisions-Skript — und nutze sie in
        jedem Projekt als Action.
        <template #actions>
          <button type="button" class="btn btn-primary" @click="openUpload"><PhUploadSimple :size="16" /> Erste Datei ablegen</button>
        </template>
      </Blankslate>
      <div v-else-if="!files.length" class="box-row muted">Keine Treffer.</div>
      <div v-for="entry in files" :key="entry.id" class="box-row hoverable lib-row">
        <span class="lib-icon" :class="entry.kind">
          <PhFileCode v-if="entry.kind === 'ids'" :size="20" />
          <PhTerminalWindow v-else :size="20" />
        </span>
        <div class="lib-main">
          <div class="row">
            <button type="button" class="link-btn lib-name" @click="view(entry)">{{ entry.name }}</button>
            <span class="tag tag-mono">{{ entry.kind === "ids" ? "IDS" : "Python" }}</span>
          </div>
          <div class="muted small row">
            <span class="mono">{{ entry.fileName }}</span> ·
            <UserAvatar :user="entry.owner" :size="14" />
            {{ entry.owner?.name ?? "?" }} · <RelTime :date="entry.createdAt" />
          </div>
        </div>
        <span class="lib-usage" :class="{ used: entry.usageCount }">
          {{ entry.usageCount ? `in ${plural(entry.usageCount, "Action", "Actions")}` : "nicht verwendet" }}
        </span>
        <button type="button" class="btn btn-sm btn-icon" aria-label="Ansehen" data-tip="Ansehen" @click="view(entry)">
          <PhEye :size="14" />
        </button>
        <UiMenu align="right">
          <template #trigger="{ toggle }">
            <button type="button" class="btn btn-sm btn-icon" aria-label="Weitere Aktionen" @click="toggle">
              <PhDotsThree :size="16" weight="bold" />
            </button>
          </template>
          <button type="button" class="menu-item" @click="download(entry)">
            <PhDownloadSimple :size="16" /> Herunterladen
          </button>
          <button v-if="canModify(entry)" type="button" class="menu-item" @click="pickReplacement(entry)">
            <PhArrowsClockwise :size="16" />
            <span>Neue Version hochladen<span class="menu-item-desc">gilt sofort in allen Actions</span></span>
          </button>
          <template v-if="canModify(entry)">
            <div class="menu-sep" />
            <button type="button" class="menu-item danger" @click="remove(entry)">
              <PhTrash :size="16" /> Löschen
            </button>
          </template>
        </UiMenu>
      </div>
    </div>

    <input
      ref="replaceInput"
      type="file"
      hidden
      :accept="replaceTarget?.kind === 'ids' ? '.ids,.xml' : '.py'"
      @change="replace"
    />

    <UiDialog v-model:open="uploadOpen" title="Datei in der Bibliothek ablegen" :persistent="uploadBusy">
      <form @submit.prevent="upload">
        <div class="form-group">
          <span class="form-label">Art</span>
          <div class="seg">
            <button type="button" :class="{ active: newKind === 'ids' }" @click="newKind = 'ids'">IDS-Prüfung</button>
            <button type="button" :class="{ active: newKind === 'python' }" @click="newKind = 'python'">Python-Skript</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="lib-file">Datei</label>
          <div class="row">
            <label class="btn file-btn">
              <PhUploadSimple :size="16" /> {{ newKind === "ids" ? ".ids wählen" : ".py wählen" }}
              <input id="lib-file" type="file" :accept="newKind === 'ids' ? '.ids,.xml' : '.py'" @change="onFile" />
            </label>
            <span v-if="newFile" class="mono small truncate">{{ newFile.name }}</span>
          </div>
        </div>
        <div class="form-group" style="margin: 0">
          <label class="form-label" for="lib-name">Name</label>
          <input id="lib-name" v-model="newName" type="text" required placeholder="z. B. Firmen-IDS Hochbau" />
        </div>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="uploadBusy" @click="uploadOpen = false">Abbrechen</button>
        <button type="button" class="btn btn-primary" :disabled="uploadBusy || !newFile || !newName.trim()" @click="upload">
          <span v-if="uploadBusy" class="spinner" /> Ablegen
        </button>
      </template>
    </UiDialog>

    <UiDialog
      :open="viewing !== null"
      :title="viewing?.name ?? ''"
      :subtitle="viewing?.fileName"
      size="lg"
      flush
      @update:open="(value) => !value && (viewing = null)"
    >
      <template #header-actions>
        <button v-if="viewing" type="button" class="btn btn-sm" @click="download(viewing)">
          <PhDownloadSimple :size="14" /> Herunterladen
        </button>
      </template>
      <pre v-if="viewHtml !== null" class="code-block"><code v-html="viewHtml" /></pre>
      <LoadingState v-else center text="Lade Datei …" />
    </UiDialog>
  </div>
</template>
