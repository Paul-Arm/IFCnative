<script setup lang="ts">
/** Rendert den Dialog von useConfirm() — einmal im App-Root. */
const { state, settle } = useConfirm();

const typed = ref("");
watch(state, () => {
  typed.value = "";
});

const canConfirm = computed(
  () => !state.value?.typeToConfirm || typed.value.trim() === state.value.typeToConfirm,
);

const open = computed({
  get: () => state.value !== null,
  set: (value: boolean) => {
    if (!value) settle(false);
  },
});

function submit(): void {
  if (canConfirm.value) settle(true);
}
</script>

<template>
  <UiDialog v-model:open="open" :title="state?.title ?? ''">
    <form v-if="state" @submit.prevent="submit">
      <p v-if="state.message" style="margin: 0 0 12px; white-space: pre-line">
        {{ state.message }}
      </p>
      <div v-if="state.typeToConfirm" class="form-group" style="margin: 0">
        <label class="form-label" for="confirm-typed">
          Zur Bestätigung <code>{{ state.typeToConfirm }}</code> eingeben
        </label>
        <input
          id="confirm-typed"
          v-model="typed"
          type="text"
          autocomplete="off"
          spellcheck="false"
          autofocus
        />
      </div>
      <!-- Enter im Formular bestätigt — Button unsichtbar, Fuß zeigt die echten. -->
      <button type="submit" hidden />
    </form>
    <template #footer>
      <button type="button" class="btn" @click="settle(false)">
        {{ state?.cancelLabel ?? "Abbrechen" }}
      </button>
      <button
        type="button"
        class="btn"
        :class="state?.danger ? 'btn-danger-solid' : 'btn-primary'"
        :disabled="!canConfirm"
        @click="submit"
      >
        {{ state?.confirmLabel ?? "Bestätigen" }}
      </button>
    </template>
  </UiDialog>
</template>
