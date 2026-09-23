<script setup lang="ts">
// IFC-Hub-Logo: ein isometrischer Würfel (das Bauwerksmodell) mit grünem
// Dach und blauen Seiten. Seine drei Innenkanten bilden einen Git-Graphen:
// der Stamm läuft von unten zur vorderen Ecke — dem Commit, an dem sich
// die Historie gabelt — und verzweigt in zwei Branches entlang der
// Dachkanten. `animated` setzt den Würfel zusammen und zeichnet danach den
// Graphen; `muted` ist die farblose Variante (z. B. im Footer). Farben aus
// den --logo-*-Tokens in tokens.css.
withDefaults(
  defineProps<{
    size?: number;
    muted?: boolean;
    animated?: boolean;
  }>(),
  { size: 20, muted: false, animated: false },
);

// Eindeutige Verlaufs-Id — das Logo steht oft mehrfach auf einer Seite.
const gradientId = `hub-logo-${useId().replace(/[^\w-]/g, "")}`;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 256 256"
    aria-hidden="true"
    class="hub-logo"
    :class="{ animated, muted }"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color: var(--logo-roof-1)" />
        <stop offset="1" style="stop-color: var(--logo-roof-2)" />
      </linearGradient>
    </defs>
    <g class="hl-faces" stroke-linejoin="round" stroke-width="14">
      <polygon
        class="hl-face hl-roof"
        points="128 24 218.07 76 128 128 37.93 76"
        :fill="`url(#${gradientId})`"
        :stroke="`url(#${gradientId})`"
      />
      <polygon class="hl-face hl-left" points="37.93 76 128 128 128 232 37.93 180" />
      <polygon class="hl-face hl-right" points="128 128 218.07 76 218.07 180 128 232" />
    </g>
    <g class="hl-graph" fill="none" stroke-width="19" stroke-linecap="round" stroke-linejoin="round">
      <path class="hl-line hl-trunk" d="M128 209.12V128" pathLength="100" />
      <path class="hl-line hl-main" d="M128 128 198.25 87.44" pathLength="100" />
      <path class="hl-line hl-branch" d="M128 128 57.75 87.44" pathLength="100" />
    </g>
    <circle class="hl-node hl-root" cx="128" cy="209.12" r="17" />
    <circle class="hl-node hl-fork" cx="128" cy="128" r="25" />
    <circle class="hl-commit" cx="128" cy="128" r="14" />
    <circle class="hl-node hl-head-main" cx="198.25" cy="87.44" r="17" />
    <circle class="hl-node hl-head-branch" cx="57.75" cy="87.44" r="17" />
  </svg>
</template>

<style scoped>
.hub-logo {
  flex-shrink: 0;
  overflow: visible;
}

.hub-logo.muted {
  filter: grayscale(1);
  opacity: 0.55;
}

.hl-left {
  fill: var(--logo-left);
  stroke: var(--logo-left);
}

.hl-right {
  fill: var(--logo-right);
  stroke: var(--logo-right);
}

.hl-line {
  stroke: var(--logo-graph);
}

.hl-node {
  fill: var(--logo-graph);
}

.hl-commit {
  fill: var(--logo-commit);
}

/* ---- Animation: Würfel setzt sich zusammen, dann wächst der Graph ---- */

@media (prefers-reduced-motion: no-preference) {
  .animated .hl-face {
    opacity: 0;
    animation: hl-face-in 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) forwards;
  }

  .animated .hl-roof {
    --hl-from: translate(0, -26px);
  }

  .animated .hl-left {
    --hl-from: translate(-22px, 13px);
    animation-delay: 0.1s;
  }

  .animated .hl-right {
    --hl-from: translate(22px, 13px);
    animation-delay: 0.2s;
  }

  .animated .hl-line {
    stroke-dasharray: 100;
    stroke-dashoffset: 100;
    animation: hl-draw 0.45s cubic-bezier(0.6, 0, 0.3, 1) forwards;
  }

  .animated .hl-trunk {
    animation-delay: 0.6s;
  }

  .animated .hl-main {
    animation-delay: 0.95s;
  }

  .animated .hl-branch {
    animation-delay: 1.1s;
  }

  .animated .hl-node,
  .animated .hl-commit {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: hl-pop 0.35s cubic-bezier(0.3, 1.6, 0.5, 1) forwards;
  }

  .animated .hl-root {
    animation-delay: 0.55s;
  }

  .animated .hl-fork,
  .animated .hl-commit {
    animation-delay: 0.9s;
  }

  .animated .hl-head-main {
    animation-delay: 1.3s;
  }

  .animated .hl-head-branch {
    animation-delay: 1.45s;
  }
}

@keyframes hl-face-in {
  from {
    opacity: 0;
    transform: var(--hl-from);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes hl-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes hl-pop {
  from {
    opacity: 0;
    transform: scale(0.2);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
