<script setup lang="ts">
import { PhBooks, PhSignOut, PhUsersThree } from "@phosphor-icons/vue";

const { user, token, logout, setSession } = useAuth();
const { embed } = useEmbed();
const { api } = useApi();
const route = useRoute();

// Eingebettet: OpenProject die aktuelle Seite melden (relativ zum Projekt),
// damit dessen Adresszeile folgt — Neuladen/teilen landet dann hier.
watch(
  () => route.path,
  (path) => {
    if (!embed.value || window.parent === window) return;
    const prefix = `/p/${embed.value.projectSlug}`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return;
    window.parent.postMessage(
      { type: "ifc-hub:navigate", path: path.slice(prefix.length).replace(/\/$/, "") },
      new URL(embed.value.openprojectUrl).origin,
    );
  },
  { immediate: true },
);

// user-Objekt beim Laden auffrischen (z. B. neu gesetzter Admin-Status).
onMounted(async () => {
  if (!token.value) return;
  try {
    const me = await api<{ user: typeof user.value }>("/me");
    if (me.user) {
      setSession(token.value, me.user);
    }
  } catch {
    // 401 wird bereits von useApi behandelt.
  }
});
</script>

<template>
  <div>
    <!-- Eingebettet liefert OpenProject Kopfzeile, Benutzer und Abmelden. -->
    <header v-if="token && !embed" class="topbar">
      <div class="topbar-inner">
        <NuxtLink to="/" class="brand">
          <HubLogo :size="22" node-fill="var(--surface)" />
          IFC Hub
        </NuxtLink>
        <span class="topbar-spacer" />
        <NuxtLink to="/library" class="link small">
          <PhBooks :size="15" aria-hidden="true" style="vertical-align: -3px" />
          Bibliothek
        </NuxtLink>
        <NuxtLink v-if="user?.isAdmin" to="/admin" class="link small">
          <PhUsersThree :size="15" aria-hidden="true" style="vertical-align: -3px" />
          Verwaltung
        </NuxtLink>
        <NuxtLink v-if="user" to="/account" class="link small" title="Konto und Zugangstoken">{{ user.name }}</NuxtLink>
        <button class="link" @click="logout">
          <PhSignOut :size="14" aria-hidden="true" />
          Abmelden
        </button>
      </div>
    </header>
    <main :class="[token ? 'container' : '', { wide: token && route.meta.wide }]">
      <slot />
    </main>
  </div>
</template>
