<script setup lang="ts">
const { helpOpen } = useShortcuts();

const groups = computed(() => {
  const map = new Map<string, typeof SHORTCUTS>();
  for (const entry of SHORTCUTS) {
    map.set(entry.group, [...(map.get(entry.group) ?? []), entry]);
  }
  return [...map.entries()];
});
</script>

<template>
  <UiDialog v-model:open="helpOpen" title="Tastenkürzel" size="md">
    <div class="shortcut-groups">
      <section v-for="[group, entries] in groups" :key="group">
        <h3 class="shortcut-group-title">{{ group }}</h3>
        <dl class="shortcut-list">
          <template v-for="entry in entries" :key="entry.label">
            <dt>{{ entry.label }}</dt>
            <dd>
              <span class="kbd-seq">
                <kbd v-for="key in entry.keys" :key="key">{{ key }}</kbd>
              </span>
            </dd>
          </template>
        </dl>
      </section>
    </div>
  </UiDialog>
</template>

<style scoped>
.shortcut-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-5);
}

.shortcut-group-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.shortcut-list {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: var(--space-2) var(--space-3);
  margin: 0;
}

.shortcut-list dt {
  font-size: var(--text-base);
}

.shortcut-list dd {
  margin: 0;
  text-align: right;
}
</style>
