<script setup lang="ts">
// IFC-Hub-Logo (Variante A): isometrischer Würfel als Hexagon, dessen
// Innenkanten einen Git-Branch bilden — Root-Commit unten, Fork-Knoten in
// der Mitte, main-Head oben rechts (accent), Branch oben links (success).
// nodeFill = Hintergrundfarbe der Fläche, auf der das Logo sitzt (für die
// "Donut"-Commit-Knoten).
const props = withDefaults(
  defineProps<{
    size?: number;
    nodeFill?: string;
    /** Graue, farblose Variante (z. B. fuer Platzhalter). */
    muted?: boolean;
  }>(),
  { size: 20, nodeFill: "var(--surface)", muted: false },
);

const mainColor = computed(() =>
  props.muted ? "var(--text-muted)" : "var(--accent)",
);
const branchColor = computed(() =>
  props.muted ? "var(--text-muted)" : "var(--success)",
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 256 256"
    aria-hidden="true"
    style="flex-shrink: 0"
  >
    <path
      d="M128 28 214.6 78 214.6 178 128 228 41.4 178 41.4 78 Z"
      fill="none"
      :stroke="mainColor"
      stroke-width="16"
      stroke-linejoin="round"
    />
    <path
      d="M128 228 128 128 214.6 78"
      fill="none"
      :stroke="mainColor"
      stroke-width="16"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M128 128 41.4 78"
      fill="none"
      :stroke="branchColor"
      stroke-width="16"
      stroke-linecap="round"
    />
    <circle cx="128" cy="228" r="19" :fill="nodeFill" :stroke="mainColor" stroke-width="14" />
    <circle cx="214.6" cy="78" r="19" :fill="nodeFill" :stroke="mainColor" stroke-width="14" />
    <circle cx="128" cy="128" r="19" :fill="nodeFill" :stroke="mainColor" stroke-width="14" />
    <circle cx="41.4" cy="78" r="19" :fill="nodeFill" :stroke="branchColor" stroke-width="14" />
  </svg>
</template>
