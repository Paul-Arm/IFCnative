<script setup lang="ts">
/** Relative Zeit („vor 3 Stunden“), absolute Angabe im Tooltip. */
const props = defineProps<{ date: string | number | Date }>();

const now = useNow();
const iso = computed(() => new Date(props.date).toISOString());
const text = computed(() => relativeTime(props.date, now.value));
const title = computed(() => formatDateTime(props.date));
</script>

<template>
  <time :datetime="iso" :title="title">{{ text }}</time>
</template>
