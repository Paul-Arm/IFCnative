<script setup lang="ts">
import {
  PhCheckCircle,
  PhCircle,
  PhProhibit,
  PhWarningCircle,
  PhXCircle,
} from "@phosphor-icons/vue";

import type { ActionRunStatus } from "~/types/api";

/** Status eines Prüf-Runs als Icon — wie die Checks bei GitHub Actions. */
withDefaults(defineProps<{ status: ActionRunStatus; size?: number }>(), { size: 16 });

const LABELS: Record<ActionRunStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  success: "Bestanden",
  failed: "Fehlgeschlagen",
  error: "Fehler",
  cancelled: "Abgebrochen",
};
</script>

<template>
  <span class="run-icon" :class="status" :title="LABELS[status]">
    <PhCheckCircle v-if="status === 'success'" :size="size" weight="fill" />
    <PhXCircle v-else-if="status === 'failed'" :size="size" weight="fill" />
    <PhWarningCircle v-else-if="status === 'error'" :size="size" weight="fill" />
    <PhProhibit v-else-if="status === 'cancelled'" :size="size" />
    <span v-else-if="status === 'running'" class="run-spin" :style="{ width: `${size}px`, height: `${size}px` }" />
    <PhCircle v-else :size="size" weight="bold" />
  </span>
</template>

<style scoped>
.run-icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.run-icon.success {
  color: var(--success);
}

.run-icon.failed {
  color: var(--danger);
}

.run-icon.error {
  color: var(--attention);
}

.run-icon.cancelled,
.run-icon.queued {
  color: var(--text-muted);
}

.run-icon.queued {
  opacity: 0.8;
}

.run-spin {
  display: inline-block;
  border: 2px solid var(--attention-muted);
  border-top-color: var(--attention-emphasis);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
</style>
