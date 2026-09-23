<script setup lang="ts">
import { PhCheck, PhGitBranch, PhCaretDown, PhPlus } from "@phosphor-icons/vue";

import type { Branch } from "~/types/api";

/**
 * Branch-Auswahl wie bei GitHub: Dropdown mit Filterfeld; wer Schreibrecht
 * hat, legt einen neuen Branch direkt aus dem Filtertext an („Branch xy von
 * main erstellen“). `allowAll` bietet zusätzlich „Alle Branches“ an.
 */
const props = withDefaults(
  defineProps<{
    branches: Branch[];
    modelValue: string;
    defaultBranch: string;
    canCreate?: boolean;
    allowAll?: boolean;
  }>(),
  { canCreate: false, allowAll: false },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "create", name: string, from: string): void;
}>();

const filter = ref("");
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

const filtered = computed(() => {
  const needle = filter.value.trim().toLowerCase();
  return props.branches
    .filter((branch) => !needle || branch.name.toLowerCase().includes(needle))
    .sort((a, b) =>
      a.name === props.defaultBranch ? -1 : b.name === props.defaultBranch ? 1 : a.name.localeCompare(b.name),
    );
});

const canCreateFromFilter = computed(() => {
  const name = filter.value.trim();
  return (
    props.canCreate &&
    BRANCH_NAME.test(name) &&
    !props.branches.some((branch) => branch.name === name)
  );
});

const label = computed(() => (props.modelValue === "" ? "Alle Branches" : props.modelValue));

function pick(name: string, close: () => void): void {
  emit("update:modelValue", name);
  filter.value = "";
  close();
}

function create(close: () => void): void {
  const from = props.modelValue || props.defaultBranch;
  emit("create", filter.value.trim(), from);
  filter.value = "";
  close();
}
</script>

<template>
  <UiMenu wide :close-on-click="false">
    <template #trigger="{ toggle, open }">
      <button type="button" class="btn branch-btn" :aria-expanded="open" @click="toggle">
        <PhGitBranch :size="16" />
        <span class="truncate">{{ label }}</span>
        <PhCaretDown :size="12" />
      </button>
    </template>
    <template #default="{ close }">
      <div class="menu-heading">Branch wechseln</div>
      <div class="menu-filter">
        <input
          v-model="filter"
          type="text"
          :placeholder="canCreate ? 'Branch suchen oder anlegen …' : 'Branch suchen …'"
          spellcheck="false"
          @keydown.enter.prevent="canCreateFromFilter ? create(close) : filtered[0] && pick(filtered[0].name, close)"
        />
      </div>
      <button
        v-for="branch in filtered"
        :key="branch.id"
        type="button"
        class="menu-item"
        @click="pick(branch.name, close)"
      >
        <PhCheck :size="14" :style="{ visibility: branch.name === modelValue ? 'visible' : 'hidden' }" />
        <span class="truncate" style="flex: 1">
          {{ branch.name }}
          <span v-if="branch.head" class="menu-item-desc truncate">
            {{ branch.head.message || "(ohne Nachricht)" }} · <RelTime :date="branch.head.createdAt" />
          </span>
        </span>
        <span v-if="branch.name === defaultBranch" class="tag">Standard</span>
      </button>
      <template v-if="allowAll">
        <div class="menu-sep" />
        <button type="button" class="menu-item" @click="pick('', close)">
          <PhCheck :size="14" :style="{ visibility: modelValue === '' ? 'visible' : 'hidden' }" />
          Alle Branches
        </button>
      </template>
      <div v-if="!filtered.length && !canCreateFromFilter" class="menu-empty">Kein Branch gefunden.</div>
      <template v-if="canCreateFromFilter">
        <div class="menu-sep" />
        <button type="button" class="menu-item" @click="create(close)">
          <PhPlus :size="14" />
          <span>
            Branch <strong>{{ filter.trim() }}</strong> von
            <strong>{{ modelValue || defaultBranch }}</strong> erstellen
          </span>
        </button>
      </template>
    </template>
  </UiMenu>
</template>

<style scoped>
.branch-btn {
  max-width: 240px;
}
</style>
