<script setup lang="ts">
import {
  PhClock,
  PhCpu,
  PhDatabase,
  PhFiles,
  PhFolderSimple,
  PhGitCommit,
  PhHardDrives,
  PhKey,
  PhMagnifyingGlass,
  PhPlayCircle,
  PhRecord,
  PhTrash,
  PhUserPlus,
  PhUsers,
} from "@phosphor-icons/vue";

import type { AdminUser, SystemInfo } from "~/types/api";

/** Verwaltung (nur globale Admins): Systemzustand und Benutzer. */
const { api } = useApi();
const { user: me } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();

useHead({ title: "Verwaltung · IFC Hub" });

if (!me.value?.isAdmin) {
  await navigateTo("/");
}

const { data, refresh, status } = useAsyncData("admin-users", () => api<{ users: AdminUser[] }>("/admin/users"), {
  lazy: true,
});
const { data: system, refresh: refreshSystem } = useAsyncData(
  "admin-system",
  () => api<SystemInfo>("/admin/system").catch(() => null),
  { lazy: true },
);

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => void refreshSystem(), 15_000);
});
onBeforeUnmount(() => clearInterval(timer));

const query = ref("");
const users = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return (data.value?.users ?? [])
    .filter((entry) => !needle || `${entry.name} ${entry.email}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.name.localeCompare(b.name, "de"));
});

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

// ---- Benutzer ---------------------------------------------------------------

async function toggleAdmin(target: AdminUser, input: HTMLInputElement): Promise<void> {
  const isAdmin = input.checked;
  try {
    await api(`/admin/users/${target.id}`, { method: "PATCH", body: { isAdmin } });
    toast.success(`${target.name} ist ${isAdmin ? "jetzt Admin" : "kein Admin mehr"}.`);
  } catch (e) {
    // Schalter zurückstellen — unveränderte Daten patcht Vue nicht.
    input.checked = Boolean(target.isAdmin);
    toast.error(apiErrorMessage(e));
  }
  await refresh();
}

async function deleteUser(target: AdminUser): Promise<void> {
  const ok = await confirm({
    title: `${target.name} löschen?`,
    message: `Das Konto ${target.email} wird entfernt. Benutzer mit eigenen Commits, Issues oder Kommentaren können nicht gelöscht werden.`,
    confirmLabel: "Benutzer löschen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/admin/users/${target.id}`, { method: "DELETE" });
    toast.success(`${target.email} gelöscht.`);
    await Promise.all([refresh(), refreshSystem()]);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}

const createOpen = ref(false);
const form = reactive({ name: "", email: "", password: "", isAdmin: false });
const createBusy = ref(false);

function openCreate(): void {
  Object.assign(form, { name: "", email: "", password: "", isAdmin: false });
  createOpen.value = true;
}

async function createUser(): Promise<void> {
  createBusy.value = true;
  try {
    await api("/admin/users", {
      method: "POST",
      body: { email: form.email.trim(), name: form.name.trim(), password: form.password, isAdmin: form.isAdmin },
    });
    createOpen.value = false;
    toast.success(`Benutzer ${form.email.trim()} angelegt.`);
    await Promise.all([refresh(), refreshSystem()]);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    createBusy.value = false;
  }
}

const pwTarget = ref<AdminUser | null>(null);
const pwValue = ref("");
const pwBusy = ref(false);

async function submitPassword(): Promise<void> {
  const target = pwTarget.value;
  if (!target) return;
  pwBusy.value = true;
  try {
    await api(`/admin/users/${target.id}`, { method: "PATCH", body: { password: pwValue.value } });
    toast.success(`Passwort für ${target.email} gesetzt.`);
    pwTarget.value = null;
    pwValue.value = "";
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    pwBusy.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>Verwaltung</h1>
      <span class="tag tag-attention">Admin</span>
      <p class="page-sub">Systemzustand und Benutzerkonten dieses Hubs.</p>
    </div>

    <!-- ============ System ============ -->
    <div class="section-head"><h2>System</h2></div>
    <div class="stat-grid">
      <div class="stat-tile">
        <span class="stat-tile-label"><PhUsers :size="14" /> Benutzer</span>
        <span class="stat-tile-value">{{ system?.counts.users ?? "–" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhFolderSimple :size="14" /> Projekte</span>
        <span class="stat-tile-value">{{ system?.counts.projects ?? "–" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhFiles :size="14" /> Modelle & Dateien</span>
        <span class="stat-tile-value">{{ system ? formatNumber(system.counts.models) : "–" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhGitCommit :size="14" /> Commits</span>
        <span class="stat-tile-value">{{ system ? formatNumber(system.counts.commits) : "–" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhRecord :size="14" /> Issues</span>
        <span class="stat-tile-value">{{ system ? formatNumber(system.counts.issues) : "–" }}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile-label"><PhPlayCircle :size="14" /> Prüf-Runs</span>
        <span class="stat-tile-value">{{ system ? formatNumber(system.counts.runs) : "–" }}</span>
        <span v-if="system" class="stat-tile-sub">
          {{ system.runner.running ? "1 läuft" : "keiner läuft" }} · {{ system.runner.queued }} wartend
        </span>
      </div>
    </div>
    <div v-if="system" class="box admin-system">
      <dl class="kv-list">
        <dt>Version</dt>
        <dd><span class="mono">{{ system.version }}</span></dd>
        <dt><PhDatabase :size="14" /> Datenbank</dt>
        <dd>{{ system.database === "postgres" ? "PostgreSQL" : system.database === "sqlite" ? "SQLite" : "Arbeitsspeicher" }}</dd>
        <dt><PhHardDrives :size="14" /> Dateiablage</dt>
        <dd>{{ system.storage === "azure" ? "Azure Blob Storage" : "Dateisystem" }}</dd>
        <dt><PhCpu :size="14" /> IFC-Worker</dt>
        <dd>{{ system.workers }} Threads · Node {{ system.node }}</dd>
        <dt><PhClock :size="14" /> Laufzeit</dt>
        <dd>{{ uptime(system.uptimeSec) }}</dd>
        <dt>Speicher</dt>
        <dd>
          {{ formatFileSize(system.memory.rss) }} belegt · Heap {{ formatFileSize(system.memory.heapUsed) }} /
          {{ formatFileSize(system.memory.heapTotal) }}
        </dd>
      </dl>
    </div>

    <!-- ============ Benutzer ============ -->
    <div class="section-head">
      <h2>Benutzer</h2>
      <span class="spacer" />
      <button type="button" class="btn btn-primary btn-sm" @click="openCreate"><PhUserPlus :size="14" /> Neuer Benutzer</button>
    </div>
    <div class="box">
      <div class="box-header">
        <div class="input-icon" style="flex: 1; max-width: 320px">
          <PhMagnifyingGlass :size="16" />
          <input v-model="query" type="search" class="input-sm" placeholder="Benutzer suchen …" />
        </div>
        <span class="spacer" />
        <span class="muted small">Admins haben Owner-Rechte in allen Projekten.</span>
      </div>
      <SkeletonRows v-if="status === 'pending' && !data" :rows="4" dots />
      <div v-for="entry in users" :key="entry.id" class="box-row admin-user">
        <UserAvatar :user="entry" :size="32" />
        <div class="admin-user-main">
          <div class="row">
            <strong>{{ entry.name }}</strong>
            <span v-if="entry.id === me?.id" class="tag">du</span>
            <span v-if="entry.isAdmin" class="tag tag-attention">Admin</span>
          </div>
          <div class="muted small">{{ entry.email }} · seit {{ formatDate(entry.createdAt) }}</div>
        </div>
        <label class="switch small" :title="entry.id === me?.id ? 'Eigenen Admin-Status kannst du nicht ändern' : 'Admin-Status'">
          <input
            type="checkbox"
            :checked="entry.isAdmin"
            :disabled="entry.id === me?.id"
            @change="toggleAdmin(entry, $event.target as HTMLInputElement)"
          />
          <span class="switch-track" />
          Admin
        </label>
        <button type="button" class="btn btn-sm btn-icon" aria-label="Passwort setzen" data-tip="Passwort setzen" @click="pwTarget = entry; pwValue = ''">
          <PhKey :size="14" />
        </button>
        <button
          type="button"
          class="btn btn-sm btn-icon btn-danger"
          :disabled="entry.id === me?.id"
          aria-label="Benutzer löschen"
          data-tip="Löschen"
          @click="deleteUser(entry)"
        >
          <PhTrash :size="14" />
        </button>
      </div>
    </div>

    <UiDialog v-model:open="createOpen" title="Neuer Benutzer" :persistent="createBusy">
      <form @submit.prevent="createUser">
        <div class="form-group">
          <label class="form-label" for="new-user-name">Name</label>
          <input id="new-user-name" v-model="form.name" type="text" autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label" for="new-user-email">E-Mail</label>
          <input id="new-user-email" v-model="form.email" type="email" required autocomplete="off" />
        </div>
        <div class="form-group">
          <label class="form-label" for="new-user-password">Passwort</label>
          <input id="new-user-password" v-model="form.password" type="password" required minlength="8" autocomplete="new-password" />
          <p class="form-hint">Mindestens 8 Zeichen — die Person kann es später nicht selbst ändern, nur Admins.</p>
        </div>
        <label class="switch">
          <input v-model="form.isAdmin" type="checkbox" />
          <span class="switch-track" />
          Globaler Admin
        </label>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="createBusy" @click="createOpen = false">Abbrechen</button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="createBusy || !form.email.trim() || form.password.length < 8"
          @click="createUser"
        >
          <span v-if="createBusy" class="spinner" /> Anlegen
        </button>
      </template>
    </UiDialog>

    <UiDialog
      :open="pwTarget !== null"
      title="Passwort setzen"
      :subtitle="pwTarget?.email"
      :persistent="pwBusy"
      @update:open="(value) => !value && (pwTarget = null)"
    >
      <form @submit.prevent="submitPassword">
        <label class="form-label" for="set-password">Neues Passwort</label>
        <input id="set-password" v-model="pwValue" type="password" required minlength="8" autocomplete="new-password" autofocus />
        <p class="form-hint">Mindestens 8 Zeichen.</p>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <button type="button" class="btn" :disabled="pwBusy" @click="pwTarget = null">Abbrechen</button>
        <button type="button" class="btn btn-primary" :disabled="pwBusy || pwValue.length < 8" @click="submitPassword">
          <span v-if="pwBusy" class="spinner" /> Passwort setzen
        </button>
      </template>
    </UiDialog>
  </div>
</template>
