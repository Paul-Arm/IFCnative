<script setup lang="ts">
// Label-Auswahl wie bei GitHub: gewählte Labels als Chips, Dropdown zum
// An-/Abwählen; wer Schreibrecht hat, legt neue Labels direkt im Dropdown an.
import { PhCaretDown, PhCheck, PhPlus, PhTag, PhX } from "@phosphor-icons/vue";

import type { Label } from "~/types/api";

const props = defineProps<{
  labels: Label[];
  selectedIds: string[];
  editable: boolean;
  /** Wenn gesetzt: neue Labels dürfen angelegt werden (write-Rolle). */
  createLabel?: (name: string, color: string) => Promise<Label | null>;
}>();

const emit = defineEmits<{ update: [ids: string[]] }>();

const selected = computed(() =>
  props.labels.filter((label) => props.selectedIds.includes(label.id)),
);

function toggle(labelId: string): void {
  const set = new Set(props.selectedIds);
  if (set.has(labelId)) {
    set.delete(labelId);
  } else {
    set.add(labelId);
  }
  emit("update", [...set]);
}

const newName = ref("");
const newColor = ref("#d73a4a");
const creating = ref(false);

async function create(): Promise<void> {
  if (!props.createLabel || !newName.value.trim() || creating.value) return;
  creating.value = true;
  try {
    const label = await props.createLabel(newName.value.trim(), newColor.value);
    if (label) {
      newName.value = "";
      // Neu angelegte Labels direkt auswählen.
      emit("update", [...new Set([...props.selectedIds, label.id])]);
    }
  } finally {
    creating.value = false;
  }
}

function labelTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2328" : "#ffffff";
}
</script>

<template>
  <div class="label-picker">
    <div v-if="selected.length" class="label-picker-chips">
      <span
        v-for="label in selected"
        :key="label.id"
        class="label-chip"
        :style="{
          backgroundColor: label.color,
          color: labelTextColor(label.color),
        }"
      >
        {{ label.name }}
        <button
          v-if="editable"
          type="button"
          class="chip-x"
          :style="{ color: labelTextColor(label.color) }"
          :title="`${label.name} entfernen`"
          @click="toggle(label.id)"
        >
          <PhX :size="10" weight="bold" />
        </button>
      </span>
    </div>
    <p v-else-if="!editable" class="muted small" style="margin: 0">Keine</p>

    <details v-if="editable" class="menu label-menu">
      <summary class="btn">
        <PhTag :size="14" aria-hidden="true" />
        Labels
        <PhCaretDown :size="12" aria-hidden="true" />
      </summary>
      <div class="menu-list">
        <button
          v-for="label in labels"
          :key="label.id"
          type="button"
          class="menu-item"
          @click="toggle(label.id)"
        >
          <span class="label-dot" :style="{ backgroundColor: label.color }" />
          <span class="label-menu-name">{{ label.name }}</span>
          <PhCheck
            v-if="selectedIds.includes(label.id)"
            :size="14"
            weight="bold"
            style="margin-left: auto"
          />
        </button>
        <div v-if="!labels.length" class="muted small label-menu-empty">
          Noch keine Labels.
        </div>
        <div v-if="createLabel" class="issue-new-label label-menu-create">
          <input
            v-model="newName"
            type="text"
            placeholder="Neues Label"
            @keydown.enter.prevent="create"
            @click.stop
          />
          <input v-model="newColor" type="color" @click.stop />
          <button
            type="button"
            class="link"
            :disabled="creating || !newName.trim()"
            @click="create"
          >
            <PhPlus :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </details>
  </div>
</template>
