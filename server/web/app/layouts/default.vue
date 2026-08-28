<script setup lang="ts">
import { PhSignOut, PhUsersThree } from "@phosphor-icons/vue";

const { user, token, logout, setSession } = useAuth();
const { api } = useApi();

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
    <header v-if="token" class="topbar">
      <div class="topbar-inner">
        <NuxtLink to="/" class="brand">
          <HubLogo :size="22" node-fill="var(--surface)" />
          IFC Hub
        </NuxtLink>
        <span class="topbar-spacer" />
        <NuxtLink v-if="user?.isAdmin" to="/admin" class="link small">
          <PhUsersThree :size="15" aria-hidden="true" style="vertical-align: -3px" />
          Verwaltung
        </NuxtLink>
        <span v-if="user" class="muted small">{{ user.name }}</span>
        <button class="link" @click="logout">
          <PhSignOut :size="14" aria-hidden="true" />
          Abmelden
        </button>
      </div>
    </header>
    <main :class="token ? 'container' : ''">
      <slot />
    </main>
  </div>
</template>
