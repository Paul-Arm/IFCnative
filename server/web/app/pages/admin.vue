<script setup lang="ts">
import { PhKey, PhTrash, PhUsersThree } from "@phosphor-icons/vue";

import type { AdminUser } from "~/types/api";

const { api } = useApi();
const { user: me } = useAuth();

// Nur für globale Admins — alle anderen zurück zur Startseite.
if (!me.value?.isAdmin) {
  await navigateTo("/");
}

const { data, refresh } = await useAsyncData("admin-users", () =>
  api<{ users: AdminUser[] }>("/admin/users"),
);

const error = ref<string | null>(null);
const notice = ref<string | null>(null);

// ---- Neuer Benutzer ----------------------------------------------------

const newName = ref("");
const newEmail = ref("");
const newPassword = ref("");
const newIsAdmin = ref(false);
const createBusy = ref(false);

async function createUser(): Promise<void> {
  error.value = null;
  notice.value = null;
  createBusy.value = true;
  try {
    await api("/admin/users", {
      method: "POST",
      body: {
        email: newEmail.value.trim(),
        name: newName.value.trim(),
        password: newPassword.value,
        isAdmin: newIsAdmin.value,
      },
    });
    notice.value = `Benutzer ${newEmail.value.trim()} angelegt.`;
    newName.value = "";
    newEmail.value = "";
    newPassword.value = "";
    newIsAdmin.value = false;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    createBusy.value = false;
  }
}

// ---- Aktionen ----------------------------------------------------------

async function toggleAdmin(target: AdminUser, isAdmin: boolean): Promise<void> {
  error.value = null;
  notice.value = null;
  try {
    await api(`/admin/users/${target.id}`, {
      method: "PATCH",
      body: { isAdmin },
    });
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
    await refresh();
  }
}

async function setPassword(target: AdminUser): Promise<void> {
  const password = window.prompt(
    `Neues Passwort für ${target.email} (min. 8 Zeichen):`,
  );
  if (password === null) return;
  error.value = null;
  notice.value = null;
  try {
    await api(`/admin/users/${target.id}`, {
      method: "PATCH",
      body: { password },
    });
    notice.value = `Passwort für ${target.email} gesetzt.`;
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

async function deleteUser(target: AdminUser): Promise<void> {
  if (!window.confirm(`Benutzer ${target.email} löschen?`)) return;
  error.value = null;
  notice.value = null;
  try {
    await api(`/admin/users/${target.id}`, { method: "DELETE" });
    notice.value = `${target.email} gelöscht.`;
    await refresh();
  } catch (e) {
    error.value = apiErrorMessage(e);
  }
}

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
</script>

<template>
  <div>
    <nav class="breadcrumbs">
      <NuxtLink to="/">Projekte</NuxtLink>
      <span>/</span>
      <strong>Verwaltung</strong>
    </nav>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="notice" class="alert success">{{ notice }}</div>

    <div class="card">
      <div class="card-header">
        <PhUsersThree :size="18" aria-hidden="true" style="color: var(--text-muted)" />
        <h2>Benutzer</h2>
        <span class="topbar-spacer" />
        <span class="muted small">
          Admins haben vollen Zugriff auf alle Projekte.
        </span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>E-Mail</th>
              <th>Admin</th>
              <th>Erstellt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in data?.users ?? []" :key="entry.id">
              <td>
                {{ entry.name }}
                <span v-if="entry.id === me?.id" class="badge accent">du</span>
              </td>
              <td class="small">{{ entry.email }}</td>
              <td>
                <input
                  type="checkbox"
                  style="width: auto"
                  :checked="entry.isAdmin"
                  :disabled="entry.id === me?.id"
                  :title="
                    entry.id === me?.id
                      ? 'Eigenen Admin-Status kannst du nicht ändern'
                      : 'Admin-Status umschalten'
                  "
                  @change="
                    toggleAdmin(entry, ($event.target as HTMLInputElement).checked)
                  "
                />
              </td>
              <td class="small muted">
                {{ dateFmt.format(new Date(entry.createdAt)) }}
              </td>
              <td style="white-space: nowrap">
                <button class="link" title="Passwort setzen" @click="setPassword(entry)">
                  <PhKey :size="15" aria-hidden="true" />
                </button>
                <button
                  v-if="entry.id !== me?.id"
                  class="link danger"
                  title="Benutzer löschen"
                  @click="deleteUser(entry)"
                >
                  <PhTrash :size="15" aria-hidden="true" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Neuer Benutzer</h2></div>
      <div class="card-body">
        <form class="form-inline" @submit.prevent="createUser">
          <div>
            <label for="admin-new-name">Name</label>
            <input id="admin-new-name" v-model="newName" type="text" />
          </div>
          <div>
            <label for="admin-new-email">E-Mail</label>
            <input id="admin-new-email" v-model="newEmail" type="email" required />
          </div>
          <div>
            <label for="admin-new-password">Passwort (min. 8)</label>
            <input
              id="admin-new-password"
              v-model="newPassword"
              type="password"
              required
              minlength="8"
            />
          </div>
          <div class="shrink" style="align-self: center; padding-top: 1rem">
            <label style="display: flex; align-items: center; gap: 0.4rem; font-weight: 400">
              <input v-model="newIsAdmin" type="checkbox" style="width: auto" />
              Admin
            </label>
          </div>
          <div class="shrink">
            <button class="primary" type="submit" :disabled="createBusy">
              Anlegen
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
