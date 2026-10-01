<script setup lang="ts">
import { PhX } from "@phosphor-icons/vue";

/**
 * Modaler Dialog: Kopf mit Titel + Schließen, Inhalt, optionaler Fuß.
 * Escape und Klick auf den Hintergrund schließen (außer `persistent`, z. B.
 * während eines Uploads). Der Seiteninhalt scrollt solange nicht, der Fokus
 * bleibt im Dialog und kehrt danach zum Auslöser zurück.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    subtitle?: string;
    size?: "sm" | "md" | "lg" | "xl";
    persistent?: boolean;
    /** Inhalt ohne Innenabstand (Listen, Code). */
    flush?: boolean;
  }>(),
  { title: "", subtitle: "", size: "sm", persistent: false, flush: false },
);

const emit = defineEmits<{ (e: "update:open", value: boolean): void; (e: "close"): void }>();

const panel = ref<HTMLElement | null>(null);
useFocusTrap(panel, () => props.open);

function close(): void {
  if (props.persistent) return;
  emit("update:open", false);
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
  }
}

watch(
  () => props.open,
  (value) => {
    if (!import.meta.client) return;
    document.body.style.overflow = value ? "hidden" : "";
    if (value) {
      nextTick(() => {
        const target = panel.value?.querySelector<HTMLElement>(
          "[autofocus], input:not([type=hidden]):not([disabled]), textarea, select",
        );
        (target ?? panel.value)?.focus();
      });
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (import.meta.client) document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      @mousedown.self="close"
      @keydown="onKeydown"
    >
      <div
        ref="panel"
        class="dialog"
        :class="size !== 'sm' ? `dialog-${size}` : ''"
        role="dialog"
        aria-modal="true"
        :aria-label="title || undefined"
        tabindex="-1"
      >
        <header v-if="title || $slots.header" class="dialog-header">
          <div style="flex: 1; min-width: 0">
            <slot name="header">
              <h2 class="dialog-title">{{ title }}</h2>
              <p v-if="subtitle" class="dialog-subtitle">{{ subtitle }}</p>
            </slot>
          </div>
          <slot name="header-actions" />
          <button
            type="button"
            class="btn btn-invisible btn-sm btn-icon"
            aria-label="Schließen"
            :disabled="persistent"
            @click="close"
          >
            <PhX :size="16" />
          </button>
        </header>
        <div class="dialog-body" :class="{ flush }">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="dialog-footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
