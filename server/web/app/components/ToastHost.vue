<script setup lang="ts">
import { PhCheck, PhInfo, PhWarning, PhX } from "@phosphor-icons/vue";

const { toasts, dismiss } = useToast();
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind" role="status">
        <span class="toast-icon" aria-hidden="true">
          <PhCheck v-if="toast.kind === 'success'" :size="14" weight="bold" />
          <PhWarning v-else-if="toast.kind === 'error'" :size="14" weight="bold" />
          <PhInfo v-else :size="14" weight="bold" />
        </span>
        <span class="toast-text">{{ toast.message }}</span>
        <NuxtLink
          v-if="toast.action"
          :to="toast.action.to"
          class="btn btn-sm"
          @click="dismiss(toast.id)"
        >
          {{ toast.action.label }}
        </NuxtLink>
        <button
          type="button"
          class="btn btn-invisible btn-sm btn-icon"
          aria-label="Meldung schließen"
          @click="dismiss(toast.id)"
        >
          <PhX :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
