<script setup lang="ts">
import { PhBuildings, PhSignOut } from "@phosphor-icons/vue";

const { user, token, logout } = useAuth();
</script>

<template>
  <div>
    <header v-if="token" class="topbar">
      <div class="topbar-inner">
        <NuxtLink to="/" class="brand">
          <PhBuildings :size="18" weight="fill" aria-hidden="true" />
          IFC Hub
        </NuxtLink>
        <span class="topbar-spacer" />
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
