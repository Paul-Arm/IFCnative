<script setup lang="ts">
import type { CommitCheck } from "~/utils/runs";

/**
 * Prüfstatus eines Commits (✓ / ✗ / ●) mit Aufklapp-Details wie die
 * Commit-Checks bei GitHub. Klick öffnet die Einzelergebnisse.
 */
const props = withDefaults(
  defineProps<{
    check: CommitCheck | null | undefined;
    slug: string;
    size?: number;
  }>(),
  { size: 16 },
);

const title = computed(() => {
  const check = props.check;
  if (!check) return "";
  if (check.status === "running" || check.status === "queued") {
    return `Prüfungen laufen (${check.total})`;
  }
  return `${check.passed} von ${check.total} Prüfungen bestanden`;
});
</script>

<template>
  <UiMenu v-if="check" align="right" wide>
    <template #trigger="{ toggle }">
      <button
        type="button"
        class="commit-status-btn"
        :title="title"
        :aria-label="title"
        @click.stop.prevent="toggle"
      >
        <RunStatusIcon :status="check.status" :size="size" />
      </button>
    </template>
    <div class="menu-heading">{{ title }}</div>
    <NuxtLink
      v-for="run in check.runs"
      :key="run.id"
      class="menu-item"
      :to="`/p/${slug}/actions?run=${run.id}`"
    >
      <RunStatusIcon :status="run.status" />
      <span class="truncate" style="flex: 1">
        {{ run.action?.name ?? "(gelöschte Action)" }}
        <span class="menu-item-desc truncate">{{ run.summary || RUN_STATUS_LABEL[run.status] }}</span>
      </span>
      <span class="muted small">#{{ run.number }}</span>
    </NuxtLink>
  </UiMenu>
</template>

<style scoped>
.commit-status-btn {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  background: none;
  border: 0;
  border-radius: var(--radius-sm);
}

.commit-status-btn:hover {
  background: var(--bg-hover);
}
</style>
