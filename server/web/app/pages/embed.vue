<script setup lang="ts">
import type { ApiUser } from "~/types/api";

// Einstieg aus OpenProject: /embed#ticket=<JWT>&path=/m/<modell>
// Das Ticket steht im Fragment, damit es nie an einen Server geht.
definePageMeta({ layout: false });

interface OpenProjectInfo {
  url: string;
  projectIdentifier: string;
  projectName: string;
}

interface Candidate {
  slug: string;
  name: string;
  visibility: "public" | "private";
}

type SessionResponse =
  | {
      status: "linked";
      token: string;
      user: ApiUser;
      project: { slug: string; name: string };
      openproject: OpenProjectInfo;
    }
  | { status: "unlinked"; canSetup: false; openproject: OpenProjectInfo }
  | {
      status: "unlinked";
      canSetup: true;
      token: string;
      user: ApiUser;
      openproject: OpenProjectInfo;
      setup: { grant: string; candidates: Candidate[] };
    };

const { setSession } = useAuth();
const { setEmbed } = useEmbed();
const error = ref<string | null>(null);
const notSetUp = ref<OpenProjectInfo | null>(null);
/** Auswahl beim ersten Öffnen durch einen Projektadministrator. */
const chooser = ref<{
  token: string;
  grant: string;
  candidates: Candidate[];
  openproject: OpenProjectInfo;
  subPath: string;
} | null>(null);
/** "" = neues Hub-Projekt anlegen, sonst Slug des zu verknüpfenden Projekts. */
const choice = ref("");
const busy = ref(false);

/** Nur Unterpfade eines Projekts (Modell, Issue, Commit) zulassen. */
function safeSubPath(raw: string | null): string {
  if (!raw || !/^\/[A-Za-z0-9/_.-]*$/.test(raw) || raw.includes("..")) {
    return "";
  }
  return raw;
}

async function enter(openproject: OpenProjectInfo, slug: string, subPath: string): Promise<void> {
  setEmbed({
    openprojectUrl: openproject.url,
    projectIdentifier: openproject.projectIdentifier,
    projectSlug: slug,
  });
  await navigateTo(`/p/${slug}${subPath}`, { replace: true });
}

onMounted(async () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const ticket = params.get("ticket");
  const subPath = safeSubPath(params.get("path"));
  // Ticket sofort aus Adresszeile und Verlauf entfernen.
  history.replaceState(history.state, "", window.location.pathname);

  if (!ticket) {
    error.value = "Die Sitzung ist abgelaufen. Bitte die Seite in OpenProject neu laden.";
    return;
  }
  try {
    const result = await $fetch<SessionResponse>("/api/integrations/openproject/session", {
      method: "POST",
      body: { ticket },
    });
    if (result.status === "linked") {
      setSession(result.token, result.user);
      await enter(result.openproject, result.project.slug, subPath);
    } else if (!result.canSetup) {
      notSetUp.value = result.openproject;
    } else {
      setSession(result.token, result.user);
      chooser.value = {
        token: result.token,
        grant: result.setup.grant,
        candidates: result.setup.candidates,
        openproject: result.openproject,
        subPath,
      };
    }
  } catch (e) {
    error.value = `Anmeldung aus OpenProject fehlgeschlagen: ${apiErrorMessage(e)}`;
  }
});

async function submitSetup(): Promise<void> {
  if (!chooser.value) return;
  busy.value = true;
  error.value = null;
  try {
    const { project } = await $fetch<{ project: { slug: string } }>(
      "/api/integrations/openproject/setup",
      {
        method: "POST",
        headers: { authorization: `Bearer ${chooser.value.token}` },
        body: { grant: chooser.value.grant, slug: choice.value || undefined },
      },
    );
    // OpenProject aktiviert daraufhin den Speicher "IFC Hub" im Projekt.
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "ifc-hub:linked" },
        new URL(chooser.value.openproject.url).origin,
      );
    }
    await enter(chooser.value.openproject, project.slug, chooser.value.subPath);
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="card login-card" :style="chooser ? 'max-width: 34rem' : ''">
      <div class="card-body">
        <div style="display: flex; justify-content: center">
          <HubLogo :size="40" node-fill="var(--surface)" />
        </div>

        <template v-if="chooser">
          <h1 style="text-align: center; font-size: 1.25rem">IFC Hub einrichten</h1>
          <p class="muted small" style="text-align: center">
            Das OpenProject-Projekt <strong>{{ chooser.openproject.projectName }}</strong>
            ist noch mit keinem Hub-Projekt verknüpft.
          </p>
          <div class="embed-choices">
            <label class="embed-choice">
              <input v-model="choice" type="radio" name="hub-project" value="" />
              <span>
                <strong>Neues Hub-Projekt anlegen</strong>
                <span class="muted small">„{{ chooser.openproject.projectName }}“, privat</span>
              </span>
            </label>
            <label v-for="candidate in chooser.candidates" :key="candidate.slug" class="embed-choice">
              <input v-model="choice" type="radio" name="hub-project" :value="candidate.slug" />
              <span>
                <strong>{{ candidate.name }}</strong>
                <span class="muted small">
                  vorhandenes Hub-Projekt ({{ candidate.slug }}) verknüpfen — Modelle und Historie bleiben
                </span>
              </span>
            </label>
          </div>
          <p v-if="!chooser.candidates.length" class="muted small">
            Es gibt keine Hub-Projekte, die du verwaltest und die noch frei sind.
          </p>
          <div v-if="error" class="alert error">{{ error }}</div>
          <button class="primary" style="width: 100%" :disabled="busy" @click="submitSetup">
            {{ choice ? "Verknüpfen" : "Anlegen" }}
          </button>
        </template>

        <p v-else-if="notSetUp" class="muted" style="text-align: center; margin-top: 1rem">
          Der IFC Hub ist für <strong>{{ notSetUp.projectName }}</strong> noch nicht eingerichtet.
          Ein Projektadministrator (Recht „IFC Hub verwalten“) muss ihn einmal öffnen.
        </p>
        <div v-else-if="error" class="alert error" style="margin-top: 1rem">{{ error }}</div>
        <p v-else class="muted" style="text-align: center; margin-top: 1rem">
          Anmeldung über OpenProject …
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.embed-choices {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0;
}
.embed-choice {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
/* Globale Formularregeln (width: 100 %) gelten nicht für Radios. */
.embed-choice input {
  width: auto;
  flex: none;
  margin: 0.2rem 0 0;
}
.embed-choice > span {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.embed-choice:has(input:checked) {
  border-color: var(--accent);
}
</style>
