<script setup lang="ts">
/** Issue-Label als Pille — Farbe aus dem Label, Textfarbe automatisch. */
const props = defineProps<{
  label: { name: string; color: string; description?: string | null };
}>();

const style = computed(() => ({
  "--lc": props.label.color,
  "--lf": labelTextColor(props.label.color),
}));
</script>

<template>
  <span class="label-chip" :style="style" :title="label.description || undefined">
    {{ label.name }}<slot />
  </span>
</template>
