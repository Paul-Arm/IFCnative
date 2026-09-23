<script setup lang="ts">
/**
 * Avatar als GitHub-artiges Identicon (aus der User-Id). Ohne Benutzer
 * (gelöscht/unbekannt) ein neutraler Platzhalter.
 */
const props = withDefaults(
  defineProps<{
    user?: { id: string; name?: string | null } | null;
    size?: number;
    /** Tooltip mit dem Namen anzeigen. */
    titled?: boolean;
  }>(),
  { user: null, size: 20, titled: true },
);

const icon = computed(() => (props.user ? identicon(props.user.id) : null));
const fill = computed(() =>
  icon.value
    ? `hsl(${icon.value.hue} ${icon.value.saturation}% ${icon.value.lightness}%)`
    : "var(--text-subtle)",
);
</script>

<template>
  <span
    class="avatar"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="titled ? (user?.name ?? 'Unbekannt') : undefined"
    role="img"
    :aria-label="user?.name ?? 'Unbekannt'"
  >
    <svg viewBox="-0.5 -0.5 6 6" aria-hidden="true" shape-rendering="crispEdges">
      <rect x="-0.5" y="-0.5" width="6" height="6" class="avatar-bg" />
      <template v-if="icon">
        <rect
          v-for="([x, y], index) in icon.cells"
          :key="index"
          :x="x"
          :y="y"
          width="1"
          height="1"
          :fill="fill"
        />
      </template>
      <circle v-else cx="2.5" cy="2.5" r="1.4" :fill="fill" />
    </svg>
  </span>
</template>

<style scoped>
.avatar-bg {
  fill: var(--avatar-bg);
}
</style>
