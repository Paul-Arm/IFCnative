<script setup lang="ts">
/**
 * Leerer Zustand mit Icon (oder Illustration im Slot `art`), Titel, Text
 * und Aktionen — statt nackter „Keine Einträge“-Zeilen.
 */
withDefaults(
  defineProps<{
    icon?: unknown;
    title: string;
    compact?: boolean;
    blueprint?: boolean;
  }>(),
  { icon: undefined, compact: false, blueprint: false },
);
</script>

<template>
  <div class="blankslate" :class="{ compact, blueprint }">
    <div v-if="$slots.art" class="blankslate-art"><slot name="art" /></div>
    <div v-else-if="icon" class="blankslate-icon">
      <component :is="icon" :size="compact ? 28 : 36" weight="duotone" />
    </div>
    <h3>{{ title }}</h3>
    <p v-if="$slots.default"><slot /></p>
    <div v-if="$slots.actions" class="blankslate-actions">
      <slot name="actions" />
    </div>
  </div>
</template>
