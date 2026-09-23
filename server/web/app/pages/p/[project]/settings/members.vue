<script setup lang="ts">
import { PhUserPlus } from "@phosphor-icons/vue";

import type { Member, Role } from "~/types/api";

/** Mitglieder und Rollen des Projekts. */
const project = useProject();
const { slug, detail, isAdmin, isOwner } = project;
const { api } = useApi();
const { user } = useAuth();
const toast = useToast();
const { confirm } = useConfirm();

const email = ref("");
const role = ref<Role>("contributor");
const busy = ref(false);
const filter = ref("");
/** Neu rendern, damit eine abgelehnte Rollenänderung im Select zurückspringt. */
const roleKey = ref(0);

// Die Owner-Rolle vergeben und entziehen nur Owner (der Server prüft das
// ebenso); die eigene Rolle ändert man nicht selbst.
const roleOptions = computed(() => ROLES.filter((entry) => entry.value !== "owner" || isOwner.value));

function canManage(member: Member): boolean {
  return (
    isAdmin.value &&
    member.userId !== detail.value?.project.ownerId &&
    member.userId !== user.value?.id &&
    (member.role !== "owner" || isOwner.value)
  );
}

const members = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return (detail.value?.members ?? [])
    .filter(
      (member) =>
        !needle ||
        `${member.user?.name ?? ""} ${member.user?.email ?? ""}`.toLowerCase().includes(needle),
    )
    .sort((a, b) => ROLES.findIndex((r) => r.value === a.role) - ROLES.findIndex((r) => r.value === b.role));
});

async function add(): Promise<void> {
  busy.value = true;
  try {
    await api(`/projects/${slug}/members`, {
      method: "POST",
      body: { email: email.value.trim(), role: role.value },
    });
    toast.success(`${email.value.trim()} hinzugefügt.`);
    email.value = "";
    await Promise.all([project.refreshProject(), project.refreshStats()]);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  } finally {
    busy.value = false;
  }
}

async function changeRole(member: Member, next: Role): Promise<void> {
  try {
    await api(`/projects/${slug}/members`, {
      method: "POST",
      body: { email: member.user?.email, role: next },
    });
    await project.refreshProject();
    toast.success(`${member.user?.name ?? "Mitglied"} ist jetzt ${roleLabel(next)}.`);
  } catch (e) {
    roleKey.value += 1;
    toast.error(apiErrorMessage(e));
  }
}

async function remove(member: Member): Promise<void> {
  const ok = await confirm({
    title: `${member.user?.name ?? "Mitglied"} entfernen?`,
    message: "Die Person verliert ihre Rolle in diesem Projekt. Bei öffentlichen Projekten bleibt der Lesezugriff.",
    confirmLabel: "Entfernen",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/projects/${slug}/members/${member.userId}`, { method: "DELETE" });
    await Promise.all([project.refreshProject(), project.refreshStats()]);
  } catch (e) {
    toast.error(apiErrorMessage(e));
  }
}
</script>

<template>
  <div class="settings-stack">
    <div class="divided-head"><h2>Mitglieder</h2></div>

    <form v-if="isAdmin" class="box member-add" @submit.prevent="add">
      <div class="box-body form-row">
        <div>
          <label class="form-label" for="member-email">Person hinzufügen</label>
          <input id="member-email" v-model="email" type="email" required placeholder="kollegin@firma.de" />
        </div>
        <div class="shrink">
          <label class="form-label" for="member-role">Rolle</label>
          <select id="member-role" v-model="role" class="auto">
            <option v-for="entry in ROLES.filter((r) => r.value !== 'owner')" :key="entry.value" :value="entry.value">
              {{ entry.label }}
            </option>
          </select>
        </div>
        <div class="shrink">
          <button type="submit" class="btn btn-primary" :disabled="busy || !email.trim()">
            <PhUserPlus :size="16" /> Hinzufügen
          </button>
        </div>
      </div>
      <div class="box-footer muted small">
        Die Person braucht ein Konto im Hub. {{ ROLES.find((r) => r.value === role)?.hint }}.
      </div>
    </form>

    <div class="box">
      <div class="box-header">
        <span class="box-title">{{ plural(detail?.members.length ?? 0, "Mitglied", "Mitglieder") }}</span>
        <span class="spacer" />
        <input v-model="filter" type="search" class="input-sm" placeholder="Mitglieder filtern" style="max-width: 220px" />
      </div>
      <div v-for="member in members" :key="member.userId" class="box-row member-row">
        <UserAvatar :user="member.user" :size="32" />
        <div class="member-main">
          <strong>{{ member.user?.name ?? member.userId }}</strong>
          <span v-if="member.userId === user?.id" class="tag" style="margin-left: 6px">du</span>
          <div class="muted small">{{ member.user?.email }}</div>
        </div>
        <template v-if="canManage(member)">
          <select
            :key="`${member.role}-${roleKey}`"
            class="auto input-sm"
            :value="member.role"
            :aria-label="`Rolle von ${member.user?.name}`"
            @change="changeRole(member, ($event.target as HTMLSelectElement).value as Role)"
          >
            <option v-for="entry in roleOptions" :key="entry.value" :value="entry.value">{{ entry.label }}</option>
          </select>
          <button type="button" class="btn btn-sm btn-danger" @click="remove(member)">Entfernen</button>
        </template>
        <span v-else class="tag tag-accent">{{ roleLabel(member.role) }}</span>
      </div>
    </div>

    <div class="box roles-help">
      <div class="box-header"><span class="box-title">Rollen</span></div>
      <div v-for="entry in ROLES" :key="entry.value" class="box-row">
        <span class="tag tag-accent" style="min-width: 96px; justify-content: center">{{ entry.label }}</span>
        <span class="muted">{{ entry.hint }}</span>
      </div>
    </div>
  </div>
</template>
