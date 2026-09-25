<script setup lang="ts">
import { PhCopy, PhKey, PhTrash } from "@phosphor-icons/vue";

// Konto: persönliche Zugangstokens (z. B. für den IFC-Editor). Wichtig für
// Konten aus OpenProject — die haben kein Hub-Passwort.

interface AccessTokenEntry {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const { api } = useApi();
const { user } = useAuth();
const { embed } = useEmbed();

const { data, refresh, status } = useAsyncData(
  "access-tokens",
  () => api<{ tokens: AccessTokenEntry[] }>("/me/tokens"),
  { lazy: true },
);
const pending = computed(
  () => (status.value === "pending" || status.value === "idle") && !data.value,
);

const error = ref<string | null>(null);
const newName = ref("IFC-Editor");
const busy = ref(false);
/** Frisch erzeugtes Token — wird nur einmal angezeigt. */
const created = ref<{ name: string; token: string } | null>(null);
const copied = ref(false);

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

async function createToken(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const result = await api<{ token: string; entry: AccessTokenEntry }>("/me/tokens", {
      method: "POST",
      body: { name: newName.value.trim() },
    });
    created.value = { name: result.entry.name, token: result.token };
    copied.value = false;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function copyToken(): Promise<void> {
  if (!created.value) return;
  await navigator.clipboard.writeText(created.value.token);
  copied.value = true;
}

async function revoke(entry: AccessTokenEntry): Promise<void> {
  if (!window.confirm(`Zugangstoken „${entry.name}" widerrufen? Programme, die es nutzen, verlieren den Zugang.`)) {
    return;
  }
  error.value = null;
  try {
    await api(`/me/tokens/${entry.id}`, { method: "DELETE" });
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}
</script>

<template>
  <div>
    <nav class="breadcrumbs">
      <NuxtLink :to="embed ? `/p/${embed.projectSlug}` : '/'">
        {{ embed ? "Zurück zum Projekt" : "Projekte" }}
      </NuxtLink>
      <span>/</span>
      <strong>Konto</strong>
    </nav>

    <div class="card">
      <div class="card-header"><h2>{{ user?.name }}</h2></div>
      <div class="card-body muted small">{{ user?.email }}</div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="card">
      <div class="card-header">
        <PhKey :size="18" aria-hidden="true" style="color: var(--text-muted)" />
        <h2>Zugangstoken</h2>
        <span class="topbar-spacer" />
        <span class="muted small">Anmeldung im IFC-Editor und für Skripte, ohne Passwort</span>
      </div>
      <div class="card-body">
        <p class="muted small" style="margin-top: 0">
          Im Editor unter <em>IFC Hub → Anmelden → Zugangstoken</em> einfügen. Konten, die über
          OpenProject angelegt wurden, melden sich im Editor nur so an. Ein Token hat dieselben
          Rechte wie dein Konto — nicht weitergeben, bei Verlust hier widerrufen.
        </p>

        <div v-if="created" class="alert success">
          <div style="margin-bottom: 0.4rem">
            Token „{{ created.name }}" erzeugt. <strong>Jetzt kopieren</strong> — es wird nur einmal angezeigt.
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center">
            <code class="mono small" style="word-break: break-all; flex: 1">{{ created.token }}</code>
            <button type="button" @click="copyToken">
              <PhCopy :size="14" aria-hidden="true" />
              {{ copied ? "Kopiert ✓" : "Kopieren" }}
            </button>
          </div>
        </div>

        <form class="form-inline" @submit.prevent="createToken">
          <div>
            <label for="token-name">Bezeichnung</label>
            <input id="token-name" v-model="newName" maxlength="80" placeholder="z. B. Editor Laptop" />
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="busy || !newName.trim()">Token erzeugen</button>
          </div>
        </form>
      </div>

      <SkeletonRows v-if="pending" :rows="2" />
      <div v-else-if="!data?.tokens.length" class="empty">Noch keine Zugangstokens.</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Bezeichnung</th>
              <th>Token</th>
              <th>Erzeugt</th>
              <th>Zuletzt benutzt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in data.tokens" :key="entry.id">
              <td><strong>{{ entry.name }}</strong></td>
              <td class="small mono">{{ entry.prefix }}…</td>
              <td class="small muted">{{ dateFmt.format(new Date(entry.createdAt)) }}</td>
              <td class="small muted">
                {{ entry.lastUsedAt ? dateFmt.format(new Date(entry.lastUsedAt)) : "nie" }}
              </td>
              <td style="text-align: right">
                <button type="button" class="danger" @click="revoke(entry)">
                  <PhTrash :size="14" aria-hidden="true" />
                  Widerrufen
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
