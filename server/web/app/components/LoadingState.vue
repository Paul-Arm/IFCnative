<script setup lang="ts">
/**
 * Einheitlicher Ladehinweis: Spinner + Text. `center` für Karten-Inhalte,
 * die komplett nachgeladen werden; ohne `center` als schlanke Zeile.
 */
withDefaults(
  defineProps<{
    text?: string;
    center?: boolean;
    large?: boolean;
  }>(),
  { text: "Lädt …", center: false, large: false },
);
</script>

<template>
  <div class="loading-state" :class="{ center }" role="status" aria-live="polite">
    <span class="spinner" :class="{ large }" aria-hidden="true" />
    <span>{{ text }}</span>
    <slot />
  </div>
</template>
