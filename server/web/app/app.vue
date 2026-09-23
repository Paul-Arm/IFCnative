<script setup lang="ts">
const { token } = useAuth();
const { install: installTheme } = useTheme();
const { install: installShortcuts } = useShortcuts();

onMounted(() => {
  installTheme();
  installShortcuts();
});
</script>

<template>
  <!-- Fortschrittsbalken oben während Seitenwechseln: sofortiges Feedback,
       auch wenn die Zielseite noch auf Daten wartet. -->
  <NuxtLoadingIndicator color="linear-gradient(90deg, var(--accent), var(--success))" :height="2" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ToastHost />
  <ConfirmHost />
  <template v-if="token">
    <CommandPalette />
    <ShortcutsDialog />
  </template>
</template>
