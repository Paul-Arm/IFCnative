<script setup lang="ts">
import { PhBooks, PhTrash } from "@phosphor-icons/vue";

import type { ActionKind, LibraryFile } from "~/types/api";

const { api } = useApi();
const { user, token } = useAuth();

const { data, refresh, status } = useAsyncData(
  "library",
  () => api<{ files: LibraryFile[] }>("/library"),
  { lazy: true },
);
const pending = computed(() => status.value === "pending" || status.value === "idle");

const error = ref<string | null>(null);
const notice = ref<string | null>(null);

// ---- Hochladen ---------------------------------------------------------

const newName = ref("");
const newKind = ref<ActionKind>("ids");
const newFile = ref<File | null>(null);
const uploadBusy = ref(false);

function onFile(event: Event): void {
  newFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  if (!newName.value && newFile.value) {
    newName.value = newFile.value.name.replace(/\.(ids|xml|py)$/i, "");
  }
}

async function upload(): Promise<void> {
  error.value = null;
  notice.value = null;
  if (!newFile.value) {
    error.value = "Bitte eine Datei auswählen.";
    return;
  }
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
    notice.value = `„${newName.value}" in der Bibliothek abgelegt.`;
    newName.value = "";
    newFile.value = null;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    uploadBusy.value = false;
  }
}

// ---- Aktualisieren / Löschen / Download --------------------------------

function canModify(entry: LibraryFile): boolean {
  return Boolean(user.value?.isAdmin || entry.ownerId === user.value?.id);
}

/** Neue Version der Datei hochladen — gilt sofort in allen Actions. */
async function replaceFile(entry: LibraryFile, event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  error.value = null;
  notice.value = null;
  try {
    await api(`/library/${entry.id}`, {
      method: "PATCH",
      body: { content: await file.text(), fileName: file.name },
    });
    notice.value = `„${entry.name}" aktualisiert — gilt sofort in allen ${entry.usageCount} verknüpften Action(s).`;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

async function remove(entry: LibraryFile): Promise<void> {
  if (!window.confirm(`„${entry.name}" aus der Bibliothek löschen?`)) return;
  error.value = null;
  notice.value = null;
  try {
    await api(`/library/${entry.id}`, { method: "DELETE" });
    notice.value = `„${entry.name}" gelöscht.`;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

async function download(entry: LibraryFile): Promise<void> {
  const blob = await $fetch<Blob>(`/api/library/${entry.id}/file`, {
    responseType: "blob",
    headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
</script>

<template>
  <div>
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <strong>Bibliothek</strong>
    </nav>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="notice" class="alert success">{{ notice }}</div>

    <div class="card">
      <div class="card-header">
        <PhBooks :size="18" aria-hidden="true" style="color: var(--text-muted)" />
        <h2>Zentrale Prüfdateien</h2>
        <span class="topbar-spacer" />
        <span class="muted small">
          IDS-Dateien und Python-Prüfskripte, projektübergreifend nutzbar
        </span>
      </div>
      <SkeletonRows v-if="pending" :rows="3" />
      <div v-else-if="!data?.files.length" class="empty">
        Noch keine Dateien in der Bibliothek — unten die erste IDS-Datei oder
        das erste Prüfskript ablegen. Projekte können sie dann im Tab
        „Actions" über „Aus zentraler Bibliothek" verwenden.
      </div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Art</th>
              <th>Datei</th>
              <th>Verwendet von</th>
              <th>Abgelegt von</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in data.files" :key="entry.id">
              <td><strong>{{ entry.name }}</strong></td>
              <td>
                <span class="badge" :class="entry.kind === 'ids' ? 'accent' : ''">
                  {{ entry.kind === "ids" ? "IDS" : "Python" }}
                </span>
              </td>
              <td class="small mono">
                <a href="#" @click.prevent="download(entry)">{{ entry.fileName }}</a>
              </td>
              <td class="small">
                {{ entry.usageCount }}
                {{ entry.usageCount === 1 ? "Action" : "Actions" }}
              </td>
              <td class="small muted">
                {{ entry.owner?.name ?? "?" }} ·
                {{ dateFmt.format(new Date(entry.createdAt)) }}
              </td>
              <td style="white-space: nowrap; text-align: right">
                <label
                  v-if="canModify(entry)"
                  class="link small"
                  style="cursor: pointer"
                  title="Neue Version hochladen — gilt sofort in allen verknüpften Actions"
                >
                  Aktualisieren
                  <input
                    type="file"
                    style="display: none"
                    :accept="entry.kind === 'ids' ? '.ids,.xml' : '.py'"
                    @change="replaceFile(entry, $event)"
                  />
                </label>
                <button
                  v-if="canModify(entry)"
                  class="link danger"
                  :title="
                    entry.usageCount
                      ? 'Wird noch verwendet — erst in den Projekten entfernen'
                      : 'Aus der Bibliothek löschen'
                  "
                  @click="remove(entry)"
                >
                  <PhTrash :size="15" aria-hidden="true" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card-body" style="border-top: 1px solid var(--border)">
        <form class="form-inline" @submit.prevent="upload">
          <div class="shrink">
            <label for="lib-kind">Art</label>
            <select id="lib-kind" v-model="newKind" style="width: auto">
              <option value="ids">IDS-Prüfung (.ids)</option>
              <option value="python">Python-Skript (.py)</option>
            </select>
          </div>
          <div>
            <label for="lib-file">Datei</label>
            <input
              id="lib-file"
              type="file"
              :accept="newKind === 'ids' ? '.ids,.xml' : '.py'"
              @change="onFile"
            />
          </div>
          <div>
            <label for="lib-name">Name</label>
            <input
              id="lib-name"
              v-model="newName"
              placeholder="z. B. Firmen-IDS Hochbau"
              required
            />
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="uploadBusy">
              Ablegen
            </button>
          </div>
        </form>
        <p class="muted small" style="margin-top: 0.5rem">
          Eine Aktualisierung hier gilt sofort in allen Actions, die den
          Eintrag referenzieren. Ändern und Löschen darf, wer die Datei
          abgelegt hat — und Admins.
        </p>
      </div>
    </div>
  </div>
</template>
