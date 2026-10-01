<script setup lang="ts">
import { PhArrowLeft, PhCopy, PhKey, PhTrash } from "@phosphor-icons/vue";

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
const { confirm } = useConfirm();
const toast = useToast();

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
  // window.confirm ist in eingebetteten Browsern (OpenProject-iframe) blockiert.
  const ok = await confirm({
    title: `Zugangstoken „${entry.name}“ widerrufen?`,
    message: "Programme, die es nutzen, verlieren den Zugang.",
    confirmLabel: "Widerrufen",
    danger: true,
  });
  if (!ok) return;
  error.value = null;
  try {
    await api(`/me/tokens/${entry.id}`, { method: "DELETE" });
    await refresh();
    toast.success(`Zugangstoken „${entry.name}“ widerrufen.`);
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}
</script>

<template>
  <div class="page">
    <NuxtLink v-if="embed" :to="`/p/${embed.projectSlug}`" class="btn btn-sm btn-invisible">
      <PhArrowLeft :size="16" /> Zurück zum Projekt
    </NuxtLink>

    <div class="page-head">
      <UserAvatar :user="user ?? null" :size="40" :titled="false" />
      <h1>{{ user?.name ?? "Konto" }}</h1>
      <p class="page-sub">{{ user?.email }}</p>
    </div>

    <div class="section-head">
      <h2><PhKey :size="18" style="vertical-align: -3px" /> Zugangstoken</h2>
    </div>
    <p class="muted small" style="max-width: 720px">
      Anmeldung im IFC-Editor und für Skripte, ohne Passwort. Im Editor unter
      <em>IFC Hub → Anmelden → Zugangstoken</em> einfügen. Konten, die über OpenProject angelegt
      wurden, melden sich im Editor nur so an. Ein Token hat dieselben Rechte wie dein Konto —
      nicht weitergeben, bei Verlust hier widerrufen.
    </p>

    <div v-if="error" class="flash flash-danger">{{ error }}</div>

    <div v-if="created" class="flash flash-success account-created">
      <div>
        Token „{{ created.name }}“ erzeugt. <strong>Jetzt kopieren</strong> — es wird nur einmal angezeigt.
      </div>
      <div class="account-token-row">
        <code class="mono small account-token">{{ created.token }}</code>
        <button type="button" class="btn btn-sm" @click="copyToken">
          <PhCopy :size="14" />
          {{ copied ? "Kopiert ✓" : "Kopieren" }}
        </button>
      </div>
    </div>

    <form class="form-row account-form" @submit.prevent="createToken">
      <div class="form-group">
        <label class="form-label" for="token-name">Bezeichnung</label>
        <input id="token-name" v-model="newName" maxlength="80" placeholder="z. B. Editor Laptop" />
      </div>
      <div class="shrink">
        <button class="btn btn-primary" type="submit" :disabled="busy || !newName.trim()">Token erzeugen</button>
      </div>
    </form>

    <div class="box">
      <SkeletonRows v-if="pending" :rows="2" dots />
      <div v-else-if="!data?.tokens.length" class="box-row muted small">Noch keine Zugangstokens.</div>
      <template v-else>
        <div v-for="entry in data.tokens" :key="entry.id" class="box-row account-token-entry">
          <PhKey :size="18" class="muted" />
          <div class="account-token-main">
            <strong>{{ entry.name }}</strong>
            <span class="mono small muted">{{ entry.prefix }}…</span>
            <div class="muted small">
              erzeugt {{ dateFmt.format(new Date(entry.createdAt)) }} ·
              zuletzt benutzt {{ entry.lastUsedAt ? dateFmt.format(new Date(entry.lastUsedAt)) : "nie" }}
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-danger" @click="revoke(entry)">
            <PhTrash :size="14" /> Widerrufen
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.account-created {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}
.account-token-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.account-token {
  flex: 1;
  word-break: break-all;
}
.account-form {
  max-width: 560px;
  margin: 12px 0 16px;
  align-items: flex-end;
}
.account-token-entry {
  display: flex;
  gap: 12px;
  align-items: center;
}
.account-token-main {
  flex: 1;
  min-width: 0;
}
.account-token-main strong {
  margin-right: 8px;
}
</style>
