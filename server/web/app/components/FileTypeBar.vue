<script setup lang="ts">
/**
 * Anteile der Dateiarten eines Projekts — wie GitHubs Sprachen-Leiste
 * (IFC, Markdown, PDF, DWG …) mit Legende.
 */
const props = defineProps<{
  kinds: { extension: string; count: number }[];
}>();

const total = computed(() => props.kinds.reduce((sum, kind) => sum + kind.count, 0));

const parts = computed(() => {
  // Gleiche Endungen zusammenfassen (z. B. jpg/jpeg), sortiert nach Anzahl.
  const map = new Map<string, number>();
  for (const kind of props.kinds) {
    const key = kind.extension || "?";
    map.set(key, (map.get(key) ?? 0) + kind.count);
  }
  return [...map.entries()]
    .map(([extension, count]) => ({
      extension,
      count,
      color: kindColor(extension),
      name: kindName(extension),
      percent: total.value ? (count / total.value) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
});
</script>

<template>
  <div v-if="total" class="filetypes">
    <div class="meter" role="img" :aria-label="parts.map((p) => `${p.name} ${Math.round(p.percent)} %`).join(', ')">
      <span
        v-for="part in parts"
        :key="part.extension"
        :style="{ width: `${part.percent}%`, background: part.color }"
        :title="`${part.name}: ${part.count}`"
      />
    </div>
    <ul class="filetypes-legend">
      <li v-for="part in parts" :key="part.extension">
        <span class="filetypes-dot" :style="{ background: part.color }" />
        <strong>{{ part.name }}</strong>
        <span class="muted">{{ part.percent < 10 ? part.percent.toFixed(1) : Math.round(part.percent) }} %</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.filetypes .meter {
  margin-bottom: var(--space-2);
}

.filetypes-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
}

.filetypes-legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.filetypes-legend strong {
  font-weight: 600;
}

.filetypes-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
