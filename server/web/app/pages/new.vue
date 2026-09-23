<script setup lang="ts">
import { PhGlobeSimple, PhLockSimple } from "@phosphor-icons/vue";

import type { Model, Project } from "~/types/api";

/**
 * Neues Projekt wie GitHubs „Create a new repository“: Name mit
 * Adress-Vorschau, Beschreibung, Sichtbarkeit — optional gleich mit README.
 */
const { api } = useApi();
const { token, user } = useAuth();
const toast = useToast();

useHead({ title: "Neues Projekt · IFC Hub" });

const name = ref("");
const description = ref("");
const visibility = ref<"public" | "private">("public");
const withReadme = ref(true);
const busy = ref(false);
const error = ref<string | null>(null);

/** Spiegel der Server-Regel (slugify in server/src/http/app.ts). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const slug = computed(() => slugify(name.value));

async function submit(): Promise<void> {
  if (!name.value.trim() || !slug.value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const { project } = await api<{ project: Project }>("/projects", {
      method: "POST",
      body: { name: name.value.trim(), description: description.value.trim(), visibility: visibility.value },
    });
    if (withReadme.value) {
      try {
        const { model } = await api<{ model: Model }>(`/projects/${project.slug}/models`, {
          method: "POST",
          body: { name: "README.md", kind: "md", folder: "" },
        });
        const text = `# ${project.name}\n\n${description.value.trim() || "Beschreibung des Projekts."}\n\n## Inhalt\n\n- IFC-Modelle und Pläne liegen in den Ordnern dieses Projekts.\n- Offene Punkte werden als Issues verfolgt.\n`;
        await $fetch(`/api/projects/${project.slug}/models/${model.slug}/commits`, {
          method: "POST",
          query: { message: "README angelegt" },
          body: text,
          headers: {
            "content-type": "text/markdown",
            ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
          },
        });
      } catch {
        // Projekt existiert trotzdem — README ist nur Komfort.
      }
    }
    toast.success(`Projekt „${project.name}“ erstellt.`);
    await navigateTo(`/p/${project.slug}`);
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page narrow new-project">
    <div class="new-project-head">
      <div>
        <h1 class="display">Neues Projekt erstellen</h1>
        <p class="muted">
          Ein Projekt bündelt IFC-Modelle, Pläne und Dokumente mit ihrer Versionsgeschichte — dazu Issues,
          automatische Prüfungen und eine gemeinsame 3D-Szene.
        </p>
      </div>
      <IsoScene :size="180" variant="empty" class="hide-sm" />
    </div>

    <form class="new-project-form" @submit.prevent="submit">
      <div v-if="error" class="flash flash-danger">{{ error }}</div>

      <div class="form-group owner-row">
        <div>
          <span class="form-label">Owner</span>
          <span class="btn owner-chip">
            <UserAvatar :user="user" :size="20" :titled="false" /> {{ user?.name }}
          </span>
        </div>
        <span class="owner-slash">/</span>
        <div style="flex: 1">
          <label class="form-label" for="new-name">Projektname <span class="color-danger">*</span></label>
          <input id="new-name" v-model="name" type="text" required autofocus maxlength="100" placeholder="z. B. Bürohaus Hafenkante" />
        </div>
      </div>
      <p class="form-hint new-slug">
        <template v-if="slug">
          Adresse: <code>/p/<strong>{{ slug }}</strong></code>
        </template>
        <template v-else>Gute Namen sind kurz und eindeutig — Umlaute werden in der Adresse umschrieben.</template>
      </p>

      <div class="form-group">
        <label class="form-label" for="new-description">Beschreibung <span class="muted">(optional)</span></label>
        <input id="new-description" v-model="description" type="text" maxlength="500" placeholder="Worum geht es in diesem Projekt?" />
      </div>

      <hr />

      <div class="choice-list">
        <label class="choice">
          <input v-model="visibility" type="radio" value="public" />
          <span class="choice-icon"><PhGlobeSimple :size="22" /></span>
          <span class="choice-text">
            <strong>Öffentlich</strong>
            <span>Alle angemeldeten Benutzer sehen das Projekt lesend. Du entscheidest, wer mitarbeitet.</span>
          </span>
        </label>
        <label class="choice">
          <input v-model="visibility" type="radio" value="private" />
          <span class="choice-icon"><PhLockSimple :size="22" /></span>
          <span class="choice-text">
            <strong>Privat</strong>
            <span>Nur eingeladene Mitglieder sehen das Projekt.</span>
          </span>
        </label>
      </div>

      <hr />

      <label class="check">
        <input v-model="withReadme" type="checkbox" />
        <span class="check-text">
          <strong>Mit README beginnen</strong>
          <span>Eine README.md erscheint wie bei GitHub auf der Projektseite — ideal für Ziele, Ansprechpartner und Konventionen.</span>
        </span>
      </label>

      <hr />

      <div class="form-actions start">
        <button type="submit" class="btn btn-primary btn-lg" :disabled="busy || !slug">
          <span v-if="busy" class="spinner" /> Projekt erstellen
        </button>
      </div>
    </form>
  </div>
</template>
