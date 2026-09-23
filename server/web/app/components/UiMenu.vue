<script setup lang="ts">
/**
 * Dropdown-Menü: Auslöser im Slot `trigger` (bekommt `toggle`/`open`),
 * Inhalt im Default-Slot (`.menu-item`, `.menu-sep`, `.menu-heading` …).
 * Schließt bei Klick außerhalb, Escape und — per Default — nach Klick auf
 * ein `.menu-item`. Pfeiltasten wandern durch die Einträge.
 */
const props = withDefaults(
  defineProps<{
    align?: "left" | "right";
    wide?: boolean;
    closeOnClick?: boolean;
  }>(),
  { align: "left", wide: false, closeOnClick: true },
);

const emit = defineEmits<{ (e: "open"): void; (e: "close"): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);

/** Per Tastatur erreichbare Einträge (bei Label-Zeilen deren Checkbox). */
function items(): HTMLElement[] {
  return [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      "button.menu-item:not(:disabled), a.menu-item[href], label.menu-item input:not(:disabled)",
    ) ?? []),
  ];
}

function toggle(): void {
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

function onDocumentPointer(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
    root.value?.querySelector<HTMLElement>("button, a")?.focus();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const list = items();
  if (!list.length) return;
  event.preventDefault();
  const index = list.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown"
      ? list[(index + 1) % list.length]
      : list[(index - 1 + list.length) % list.length];
  next?.focus();
}

function onPanelClick(event: MouseEvent): void {
  if (!props.closeOnClick) return;
  const item = (event.target as HTMLElement).closest(".menu-item");
  if (item && !item.hasAttribute("data-keep-open")) close();
}

watch(open, (value) => {
  if (value) {
    emit("open");
    document.addEventListener("pointerdown", onDocumentPointer, true);
    // Erstes Eingabefeld (Filter) fokussieren, sonst bleibt der Fokus am Auslöser.
    nextTick(() => panel.value?.querySelector<HTMLInputElement>("input")?.focus());
  } else {
    emit("close");
    document.removeEventListener("pointerdown", onDocumentPointer, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointer, true);
});

defineExpose({ close, toggle });
</script>

<template>
  <div ref="root" class="menu-anchor" @keydown="onKeydown">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div
      v-if="open"
      ref="panel"
      class="menu"
      :class="[`align-${align}`, { wide }]"
      role="menu"
      @click="onPanelClick"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
