<script setup lang="ts">
const { user, token, setSession } = useAuth();
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

const version = ref<string | null>(null);
onMounted(async () => {
  try {
    const health = await $fetch<{ version: string }>("/api/health");
    version.value = health.version;
  } catch {
    // Fußzeile kommt ohne Version aus.
  }
});

const { helpOpen } = useShortcuts();
</script>

<template>
  <div class="app">
    <!-- Eingebettet liefert OpenProject Kopfzeile, Benutzer und Abmelden. -->
    <AppHeader v-if="token && !embed" />
    <main class="app-main">
      <slot />
    </main>
    <footer v-if="token && !embed && !route.meta.fullBleed" class="app-footer">
      <HubLogo :size="18" muted />
      <span>IFC Hub<template v-if="version"> · v{{ version }}</template></span>
      <span class="spacer" />
      <NuxtLink to="/projects">Projekte</NuxtLink>
      <NuxtLink to="/library">Bibliothek</NuxtLink>
      <button type="button" class="link-btn muted" @click="helpOpen = true">Tastenkürzel</button>
      <a href="/api/health" target="_blank" rel="noopener">API-Status</a>
    </footer>
  </div>
</template>
