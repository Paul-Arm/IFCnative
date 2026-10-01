<script setup lang="ts">
import { PhGear, PhTag, PhUsers } from "@phosphor-icons/vue";

/** Rahmen der Projekt-Einstellungen: Navigation links, Bereich rechts. */
const route = useRoute();
const { slug, isAdmin, detail } = useProject();

useHead({ title: computed(() => `Einstellungen · ${detail.value?.project.name ?? slug}`) });

const base = `/p/${slug}/settings`;
const section = computed(() => {
  if (route.path.endsWith("/members")) return "members";
  if (route.path.endsWith("/labels")) return "labels";
  return "general";
});
</script>

<template>
  <div class="layout side-left narrow-side settings-page">
    <aside class="layout-side">
      <nav class="sidenav">
        <NuxtLink :to="base" class="sidenav-item" :class="{ active: section === 'general' }">
          <PhGear :size="16" /> Allgemein
        </NuxtLink>
        <div class="sidenav-heading">Zugriff</div>
        <NuxtLink :to="`${base}/members`" class="sidenav-item" :class="{ active: section === 'members' }">
          <PhUsers :size="16" /> Mitglieder
          <span v-if="detail" class="counter">{{ detail.members.length }}</span>
        </NuxtLink>
        <div class="sidenav-heading">Issues</div>
        <NuxtLink :to="`${base}/labels`" class="sidenav-item" :class="{ active: section === 'labels' }">
          <PhTag :size="16" /> Labels
        </NuxtLink>
      </nav>
    </aside>
    <div class="layout-main">
      <div v-if="detail && !isAdmin && section !== 'labels'" class="flash flash-warn">
        Nur Owner und Maintainer können die Projekteinstellungen ändern.
      </div>
      <NuxtPage />
    </div>
  </div>
</template>
