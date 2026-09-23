<script setup lang="ts">
import { PhCheckCircle, PhCircleDashed, PhRecord } from "@phosphor-icons/vue";

/** Offen = grüner Ring, geschlossen = lila Haken (wie GitHub). */
withDefaults(
  defineProps<{
    state: "open" | "closed";
    size?: number;
    /** Sammel-Issue mit Unter-Issues: gestrichelter Ring. */
    parent?: boolean;
  }>(),
  { size: 16, parent: false },
);
</script>

<template>
  <span
    class="issue-icon"
    :class="state"
    :title="state === 'open' ? 'Offen' : 'Geschlossen'"
  >
    <template v-if="state === 'open'">
      <PhCircleDashed v-if="parent" :size="size" weight="bold" />
      <PhRecord v-else :size="size" weight="bold" />
    </template>
    <PhCheckCircle v-else :size="size" weight="fill" />
  </span>
</template>

<style scoped>
.issue-icon {
  display: inline-flex;
  flex-shrink: 0;
}

.issue-icon.open {
  color: var(--success);
}

.issue-icon.closed {
  color: var(--done);
}
</style>
