<script setup lang="ts">
import { PhCheck, PhGear } from "@phosphor-icons/vue";

import type { PickerItem } from "~/types/ui";

/**
 * Abschnitt der Issue-Seitenleiste wie bei GitHub: Überschrift mit Zahnrad
 * öffnet ein Auswahlmenü (Filter, Mehrfachauswahl), darunter die gewählten
 * Einträge. Für Bearbeiter, Modelle usw.
 */

const props = withDefaults(
  defineProps<{
    title: string;
    items: PickerItem[];
    selected: string[];
    editable?: boolean;
    emptyText?: string;
    menuTitle?: string;
  }>(),
  { editable: false, emptyText: "Keine", menuTitle: "" },
);

const emit = defineEmits<{ (e: "update", ids: string[]): void }>();

const filter = ref("");
const draft = ref<Set<string>>(new Set());

const chosen = computed(() => props.items.filter((item) => props.selected.includes(item.id)));
const visible = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return props.items.filter(
    (item) => !needle || `${item.label} ${item.sub ?? ""}`.toLowerCase().includes(needle),
  );
});

function onOpen(): void {
  draft.value = new Set(props.selected);
  filter.value = "";
}

function toggle(id: string): void {
  const next = new Set(draft.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  draft.value = next;
}

/** Beim Schließen übernehmen (wie GitHub) — nur wenn sich etwas geändert hat. */
function onClose(): void {
  const next = [...draft.value];
  const changed =
    next.length !== props.selected.length || next.some((id) => !props.selected.includes(id));
  if (changed) emit("update", next);
}
</script>

<template>
  <section class="side-section">
    <UiMenu v-if="editable" align="right" wide :close-on-click="false" @open="onOpen" @close="onClose">
      <template #trigger="{ toggle: open }">
        <button type="button" class="side-head side-head-btn" @click="open">
          <span>{{ title }}</span>
          <PhGear :size="16" />
        </button>
      </template>
      <div class="menu-heading">{{ menuTitle || title }}</div>
      <div v-if="items.length > 6" class="menu-filter">
        <input v-model="filter" type="text" placeholder="Filtern …" />
      </div>
      <button
        v-for="item in visible"
        :key="item.id"
        type="button"
        class="menu-item"
        @click="toggle(item.id)"
      >
        <PhCheck :size="14" :style="{ visibility: draft.has(item.id) ? 'visible' : 'hidden' }" />
        <UserAvatar v-if="item.user !== undefined" :user="item.user" :size="20" :titled="false" />
        <ModelIcon v-else-if="item.model" :kind="item.model.kind" :name="item.model.name" />
        <span class="truncate" style="flex: 1">
          {{ item.label }}
          <span v-if="item.sub" class="menu-item-desc truncate">{{ item.sub }}</span>
        </span>
      </button>
      <div v-if="!visible.length" class="menu-empty">Keine Treffer.</div>
    </UiMenu>
    <div v-else class="side-head">
      <span>{{ title }}</span>
    </div>

    <ul v-if="chosen.length" class="side-list">
      <li v-for="item in chosen" :key="item.id">
        <slot name="item" :item="item">
          <UserAvatar v-if="item.user !== undefined" :user="item.user" :size="20" />
          <ModelIcon v-else-if="item.model" :kind="item.model.kind" :name="item.model.name" />
          <span class="truncate">{{ item.label }}</span>
        </slot>
      </li>
    </ul>
    <p v-else class="side-empty">{{ emptyText }}</p>
    <slot />
  </section>
</template>
