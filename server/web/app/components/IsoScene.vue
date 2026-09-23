<script setup lang="ts">
/**
 * Isometrische Blueprint-Illustration: Gebäude als Quader mit
 * Geschosslinien, am Boden ein Git-Branch mit Commit-Knoten — das Motiv
 * des Logos (Würfel + Versionsbaum) als Szene. Baut sich animiert auf.
 *
 * variant "hero"  = kleiner Campus (Login, Dashboard)
 * variant "empty" = geplantes Gebäude als gestrichelte Hülle (leere Zustände)
 * variant "seed"  = generative Bebauung aus `seed` (z. B. Projekt-Id) in
 *                   der Farbe `hue` — jedes Projekt bekommt sein eigenes Cover
 */
const props = withDefaults(
  defineProps<{
    size?: number;
    variant?: "hero" | "empty" | "seed";
    animated?: boolean;
    seed?: string;
    hue?: number;
  }>(),
  { size: 420, variant: "hero", animated: true, seed: "", hue: 212 },
);

interface Box {
  x: number;
  y: number;
  w: number;
  d: number;
  floors: number;
  dashed?: boolean;
  accent?: boolean;
}

const UNIT = 24;
const FLOOR = 0.42;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

function project(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS * UNIT, (x + y) * SIN * UNIT - z * UNIT];
}

function pts(points: [number, number, number][]): string {
  return points
    .map(([x, y, z]) => project(x, y, z).map((v) => v.toFixed(1)).join(","))
    .join(" ");
}

/** Deterministische Bebauung: 3×3 Grundstücke, Höhen und Maße aus dem Seed. */
function seededBoxes(seed: string): Box[] {
  let state = hashString(seed) || 1;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const result: Box[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (rand() < 0.28) continue;
      const w = 1.4 + rand() * 1.3;
      const d = 1.4 + rand() * 1.3;
      result.push({
        x: col * 3.2 + rand() * (2.9 - w),
        y: row * 3.2 + rand() * (2.9 - d),
        w,
        d,
        floors: 1 + Math.floor(Math.pow(rand(), 1.6) * 10),
      });
    }
  }
  if (result.length < 3) {
    result.push({ x: 3.4, y: 3.4, w: 2.2, d: 2.2, floors: 5 });
  }
  const tallest = result.reduce((best, box) => (box.floors > best.floors ? box : best), result[0]!);
  tallest.accent = true;
  return result;
}

const boxes = computed<Box[]>(() =>
  props.variant === "seed"
    ? seededBoxes(props.seed || "ifc-hub")
    : props.variant === "empty"
    ? [
        { x: 1, y: 1, w: 3, d: 2.4, floors: 6, dashed: true },
        { x: 1, y: 1, w: 3, d: 2.4, floors: 1 },
      ]
    : [
        { x: 0, y: 0, w: 2, d: 2, floors: 11, accent: true },
        { x: 3, y: 0.2, w: 3, d: 1.6, floors: 4 },
        { x: 7, y: 0.4, w: 1.5, d: 1.5, floors: 6 },
        { x: 0.2, y: 3, w: 2.8, d: 2.2, floors: 3 },
        { x: 4, y: 3, w: 1.7, d: 1.7, floors: 7 },
        { x: 6.6, y: 3.2, w: 2.2, d: 2, floors: 2 },
        { x: 1, y: 6.2, w: 3.4, d: 1.4, floors: 2 },
        { x: 5.4, y: 6.2, w: 1.6, d: 1.6, floors: 4 },
      ],
);

/** Hinten nach vorn zeichnen (Maler-Algorithmus über x + y). */
const drawn = computed(() =>
  [...boxes.value]
    .sort((a, b) => a.x + a.y + a.w / 2 + a.d / 2 - (b.x + b.y + b.w / 2 + b.d / 2))
    .map((box) => ({ box, face: faces(box) })),
);

function faces(box: Box) {
  const h = box.floors * FLOOR;
  const { x, y, w, d } = box;
  return {
    top: pts([
      [x, y, h],
      [x + w, y, h],
      [x + w, y + d, h],
      [x, y + d, h],
    ]),
    right: pts([
      [x + w, y, 0],
      [x + w, y + d, 0],
      [x + w, y + d, h],
      [x + w, y, h],
    ]),
    left: pts([
      [x, y + d, 0],
      [x + w, y + d, 0],
      [x + w, y + d, h],
      [x, y + d, h],
    ]),
    floorLines: Array.from({ length: Math.max(0, box.floors - 1) }, (_, index) => {
      const z = (index + 1) * FLOOR;
      return pts([
        [x, y + d, z],
        [x + w, y + d, z],
        [x + w, y, z],
      ]);
    }),
  };
}

// Boden: Platte + Raster
const extent = computed(() =>
  props.variant === "seed"
    ? { x0: -0.8, y0: -0.8, x1: 9.8, y1: 9.8 }
    : { x0: -1.5, y0: -1.5, x1: 10, y1: 9 },
);
const plate = computed(() => {
  const e = extent.value;
  return pts([
    [e.x0, e.y0, 0],
    [e.x1, e.y0, 0],
    [e.x1, e.y1, 0],
    [e.x0, e.y1, 0],
  ]);
});
const gridLines = computed(() => {
  const e = extent.value;
  const lines: string[] = [];
  for (let x = Math.ceil(e.x0); x <= e.x1; x += 1) {
    lines.push(pts([[x, e.y0, 0], [x, e.y1, 0]]));
  }
  for (let y = Math.ceil(e.y0); y <= e.y1; y += 1) {
    lines.push(pts([[e.x0, y, 0], [e.x1, y, 0]]));
  }
  return lines;
});

/** Farbton des Seed-Modus als CSS-Variablen (Flächen + Linien). */
const tint = computed(() =>
  props.variant === "seed"
    ? {
        "--iso-top": `light-dark(hsl(${props.hue} 80% 97%), hsl(${props.hue} 40% 24%))`,
        "--iso-left": `light-dark(hsl(${props.hue} 65% 89%), hsl(${props.hue} 40% 17%))`,
        "--iso-right": `light-dark(hsl(${props.hue} 55% 80%), hsl(${props.hue} 42% 12%))`,
        "--iso-ink": `light-dark(hsl(${props.hue} 55% 40%), hsl(${props.hue} 75% 68%))`,
      }
    : undefined,
);

// Git-Branch am Boden: main (Akzent) + Feature-Branch (Erfolg)
const mainPath = pts([
  [-1, 2.6, 0],
  [2.6, 2.6, 0],
  [6.2, 2.6, 0],
  [9.4, 2.6, 0],
]);
const branchPath = pts([
  [2.6, 2.6, 0],
  [3.4, 5.6, 0],
  [6.2, 5.6, 0],
  [6.2, 2.6, 0],
]);
const nodes = [
  { at: [-1, 2.6] as const, main: true },
  { at: [2.6, 2.6] as const, main: true },
  { at: [3.4, 5.6] as const, main: false },
  { at: [6.2, 5.6] as const, main: false },
  { at: [6.2, 2.6] as const, main: true },
  { at: [9.4, 2.6] as const, main: true },
].map((node) => {
  const [cx, cy] = project(node.at[0], node.at[1], 0);
  return { cx, cy, main: node.main };
});

const viewBox = computed(() => {
  const e = extent.value;
  const tallest = Math.max(...boxes.value.map((box) => box.floors));
  const corners = [
    project(e.x0, e.y0, 0),
    project(e.x1, e.y0, 0),
    project(e.x1, e.y1, 0),
    project(e.x0, e.y1, 0),
    ...boxes.value.map((box) => project(box.x, box.y, box.floors * FLOOR + 0.3)),
    project(0, 0, Math.min(tallest, 11) * FLOOR + 0.3),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const pad = 8;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX.toFixed(0)} ${minY.toFixed(0)} ${(Math.max(...xs) - minX + pad).toFixed(0)} ${(Math.max(...ys) - minY + pad).toFixed(0)}`;
});
</script>

<template>
  <svg
    class="iso-scene"
    :class="[`iso-${variant}`, { animated }]"
    :viewBox="viewBox"
    :width="size"
    :style="tint"
    role="img"
    aria-hidden="true"
  >
    <g class="iso-ground">
      <polygon :points="plate" class="iso-plate" />
      <polyline v-for="(line, index) in gridLines" :key="index" :points="line" class="iso-grid" />
    </g>

    <g v-if="variant === 'hero'" class="iso-git">
      <polyline :points="mainPath" class="iso-branch main" pathLength="1" />
      <polyline :points="branchPath" class="iso-branch feature" pathLength="1" />
      <ellipse
        v-for="(node, index) in nodes"
        :key="index"
        :cx="node.cx"
        :cy="node.cy"
        rx="6"
        ry="3.5"
        class="iso-node"
        :class="{ main: node.main }"
        :style="{ animationDelay: `${0.9 + index * 0.12}s` }"
      />
    </g>

    <g
      v-for="({ box, face }, index) in drawn"
      :key="index"
      class="iso-box"
      :class="{ dashed: box.dashed, accent: box.accent }"
      :style="{ animationDelay: `${0.15 + index * 0.09}s` }"
    >
      <polygon :points="face.left" class="iso-face left" />
      <polygon :points="face.right" class="iso-face right" />
      <polygon :points="face.top" class="iso-face top" />
      <polyline v-for="(line, li) in face.floorLines" :key="li" :points="line" class="iso-floor" />
    </g>
  </svg>
</template>

<style scoped>
.iso-scene {
  display: block;
  max-width: 100%;
  height: auto;
  overflow: visible;
}

.iso-plate {
  fill: color-mix(in srgb, var(--blueprint-ink) 5%, transparent);
  stroke: color-mix(in srgb, var(--blueprint-ink) 30%, transparent);
  stroke-width: 1;
}

.iso-grid {
  fill: none;
  stroke: color-mix(in srgb, var(--blueprint-ink) 14%, transparent);
  stroke-width: 0.6;
}

.iso-face {
  stroke: var(--blueprint-ink);
  stroke-width: 1.1;
  stroke-linejoin: round;
}

/* Generative Projekt-Cover: Flächen und Linien im Projekt-Farbton */
.iso-seed .iso-face {
  stroke: var(--iso-ink);
}

.iso-seed .iso-face.top,
.iso-seed .iso-box.accent .iso-face.top {
  fill: var(--iso-top);
}

.iso-seed .iso-face.left {
  fill: var(--iso-left);
}

.iso-seed .iso-face.right {
  fill: var(--iso-right);
}

.iso-seed .iso-box.accent .iso-face {
  stroke: var(--iso-ink);
  stroke-width: 1.5;
}

.iso-seed .iso-floor,
.iso-seed .iso-box.accent .iso-floor {
  stroke: color-mix(in srgb, var(--iso-ink) 40%, transparent);
}

.iso-seed .iso-plate {
  fill: color-mix(in srgb, var(--iso-ink) 6%, transparent);
  stroke: color-mix(in srgb, var(--iso-ink) 30%, transparent);
}

.iso-seed .iso-grid {
  stroke: color-mix(in srgb, var(--iso-ink) 12%, transparent);
}

.iso-face.top {
  fill: var(--scene-top);
}

.iso-face.left {
  fill: var(--scene-left);
}

.iso-face.right {
  fill: var(--scene-right);
}

.iso-box.accent .iso-face.top {
  fill: var(--scene-accent-top);
}

.iso-box.accent .iso-face {
  stroke: var(--success);
}

.iso-box.accent .iso-floor {
  stroke: color-mix(in srgb, var(--success) 45%, transparent);
}

.iso-floor {
  fill: none;
  stroke: color-mix(in srgb, var(--blueprint-ink) 40%, transparent);
  stroke-width: 0.7;
}

.iso-box.dashed .iso-face {
  fill: color-mix(in srgb, var(--blueprint-ink) 4%, transparent);
  stroke-dasharray: 4 4;
}

.iso-box.dashed .iso-floor {
  stroke-dasharray: 3 4;
}

.iso-branch {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.iso-branch.main {
  stroke: var(--accent);
}

.iso-branch.feature {
  stroke: var(--success);
}

.iso-node {
  fill: var(--bg);
  stroke: var(--success);
  stroke-width: 2.5;
}

.iso-node.main {
  stroke: var(--accent);
}

/* ---- Aufbau-Animation ---- */

.animated .iso-box {
  opacity: 0;
  animation: iso-rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

.animated .iso-branch {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: iso-draw 1.2s cubic-bezier(0.6, 0, 0.3, 1) 0.6s forwards;
}

.animated .iso-branch.feature {
  animation-delay: 1s;
}

.animated .iso-node {
  opacity: 0;
  animation: iso-pop 0.4s cubic-bezier(0.3, 1.6, 0.5, 1) forwards;
  transform-box: fill-box;
  transform-origin: center;
}

.animated .iso-ground {
  animation: iso-fade 0.6s ease-out both;
}

@keyframes iso-rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes iso-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes iso-pop {
  from {
    opacity: 0;
    transform: scale(0.2);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes iso-fade {
  from {
    opacity: 0;
  }
}
</style>
