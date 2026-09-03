<script setup lang="ts">
/** Platzhalter-Zeilen, solange eine Liste/Tabelle noch lädt. */
withDefaults(defineProps<{ rows?: number; dots?: boolean }>(), {
  rows: 4,
  dots: false,
});
</script>

<template>
  <div class="skeleton-rows" role="status" aria-label="Lädt …">
    <div v-for="index in rows" :key="index" class="skeleton-row">
      <span v-if="dots" class="skeleton dot" />
      <span class="skeleton" />
      <span class="skeleton short" />
    </div>
  </div>
</template>
