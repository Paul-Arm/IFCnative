<script setup lang="ts">
/**
 * Projekt-Kennzeichen: das Projektbild (3D-Szene), sonst ein isometrischer
 * Würfel in der Projektfarbe (deterministisch aus der Id).
 */
const props = withDefaults(
  defineProps<{
    project: { id: string; slug: string; hasImage?: boolean } | null;
    size?: number;
    /** Bild laden, falls vorhanden (aus in dichten Listen möglich). */
    image?: boolean;
    radius?: number;
  }>(),
  { size: 32, image: true, radius: 8 },
);

const { load, imageFor } = useProjectImage();

watch(
  () => [props.project?.slug, props.project?.hasImage, props.image] as const,
  ([slug, hasImage, image]) => {
    if (slug && hasImage && image) load(slug);
  },
  { immediate: true },
);

const src = computed(() =>
  props.project?.hasImage && props.image ? imageFor(props.project.slug) : null,
);

const hue = computed(() => hashString(props.project?.id ?? "?") % 360);
</script>

<template>
  <span
    class="project-mark-el"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` }"
  >
    <img v-if="src" :src="src" alt="" />
    <svg v-else viewBox="0 0 64 64" aria-hidden="true">
      <!-- isometrischer Würfel: oben hell, links mittel, rechts dunkel -->
      <polygon points="32,10 52,21.5 32,33 12,21.5" :fill="`hsl(${hue} 70% 68%)`" />
      <polygon points="12,21.5 32,33 32,56 12,44.5" :fill="`hsl(${hue} 55% 50%)`" />
      <polygon points="52,21.5 32,33 32,56 52,44.5" :fill="`hsl(${hue} 60% 38%)`" />
      <polyline
        points="32,33 32,56"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        stroke-width="1"
      />
    </svg>
  </span>
</template>

<style scoped>
.project-mark-el {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    linear-gradient(var(--blueprint-line-strong) 1px, transparent 1px) 0 0 / 8px 8px,
    linear-gradient(90deg, var(--blueprint-line-strong) 1px, transparent 1px) 0 0 / 8px 8px,
    var(--blueprint-bg);
  box-shadow: inset 0 0 0 1px var(--border-muted);
}

.project-mark-el img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.project-mark-el svg {
  width: 78%;
  height: 78%;
}
</style>
