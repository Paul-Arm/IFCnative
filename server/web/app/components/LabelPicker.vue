<script setup lang="ts">
// Label-Auswahl wie bei GitHub: Abschnitt mit Zahnrad, Menü mit Filter und
// Häkchen; wer Schreibrecht hat, legt neue Labels direkt im Menü an.
import { PhCheck, PhGear, PhPlus } from "@phosphor-icons/vue";

import type { Label } from "~/types/api";

const props = withDefaults(
  defineProps<{
    labels: Label[];
    selectedIds: string[];
    editable: boolean;
    /** Wenn gesetzt: neue Labels dürfen angelegt werden (write-Rolle). */
    createLabel?: (name: string, color: string) => Promise<Label | null>;
    title?: string;
  }>(),
  { createLabel: undefined, title: "Labels" },
);

const emit = defineEmits<{ update: [ids: string[]] }>();

const filter = ref("");
const draft = ref<Set<string>>(new Set());
const creating = ref(false);
const newColor = ref(randomLabelColor());

const selected = computed(() => props.labels.filter((label) => props.selectedIds.includes(label.id)));
const visible = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return props.labels.filter((label) => !needle || label.name.toLowerCase().includes(needle));
});
const canCreate = computed(
  () =>
    Boolean(props.createLabel) &&
    filter.value.trim().length > 0 &&
    !props.labels.some((label) => label.name.toLowerCase() === filter.value.trim().toLowerCase()),
);

function onOpen(): void {
  draft.value = new Set(props.selectedIds);
  filter.value = "";
  newColor.value = randomLabelColor();
}

function toggle(id: string): void {
  const next = new Set(draft.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  draft.value = next;
}

function onClose(): void {
  const next = [...draft.value];
  const changed =
    next.length !== props.selectedIds.length || next.some((id) => !props.selectedIds.includes(id));
  if (changed) emit("update", next);
}

async function create(): Promise<void> {
  if (!props.createLabel || !canCreate.value || creating.value) return;
  creating.value = true;
  try {
    const label = await props.createLabel(filter.value.trim(), newColor.value);
    if (label) {
      draft.value = new Set([...draft.value, label.id]);
      filter.value = "";
      newColor.value = randomLabelColor();
    }
  } finally {
    creating.value = false;
  }
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
      <div class="menu-heading">Labels anwenden</div>
      <div class="menu-filter">
        <input
          v-model="filter"
          type="text"
          :placeholder="createLabel ? 'Filtern oder neues Label …' : 'Filtern …'"
          @keydown.enter.prevent="canCreate ? create() : visible[0] && toggle(visible[0].id)"
        />
      </div>
      <button
        v-for="label in visible"
        :key="label.id"
        type="button"
        class="menu-item"
        @click="toggle(label.id)"
      >
        <PhCheck :size="14" :style="{ visibility: draft.has(label.id) ? 'visible' : 'hidden' }" />
        <span class="label-dot" :style="{ '--lc': label.color }" />
        <span class="truncate" style="flex: 1">
          {{ label.name }}
          <span v-if="label.description" class="menu-item-desc truncate">{{ label.description }}</span>
        </span>
      </button>
      <div v-if="!visible.length && !canCreate" class="menu-empty">
        {{ labels.length ? "Kein Label gefunden." : "Noch keine Labels." }}
      </div>
      <template v-if="canCreate">
        <div class="menu-sep" />
        <div class="menu-item" data-keep-open style="cursor: default">
          <input v-model="newColor" type="color" aria-label="Farbe" @click.stop />
          <button type="button" class="btn btn-sm" :disabled="creating" style="flex: 1" @click="create">
            <PhPlus :size="14" />
            Label „{{ filter.trim() }}“ anlegen
          </button>
        </div>
      </template>
    </UiMenu>
    <div v-else class="side-head"><span>{{ title }}</span></div>

    <div v-if="selected.length" class="side-labels">
      <LabelChip v-for="label in selected" :key="label.id" :label="label" />
    </div>
    <p v-else class="side-empty">Keine</p>
  </section>
</template>
