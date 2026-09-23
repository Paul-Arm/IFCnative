<script setup lang="ts">
import { PhBuildings, PhSquaresFour } from "@phosphor-icons/vue";

import type { ContributionDay } from "~/types/api";

/**
 * Beitragskalender: ein Jahr Aktivität als GitHub-Raster — oder als
 * isometrische „Skyline“, in der jeder Tag ein Gebäude ist, dessen Höhe
 * der Zahl der Beiträge entspricht.
 */
const props = withDefaults(
  defineProps<{
    days: ContributionDay[];
    loading?: boolean;
    /** Beschriftung der Summe, z. B. „Beiträge“ oder „Commits“. */
    noun?: [string, string];
  }>(),
  { loading: false, noun: () => ["Beitrag", "Beiträge"] },
);

const MODE_KEY = "ifc-hub:heat-mode";
const mode = ref<"grid" | "iso">("grid");
onMounted(() => {
  try {
    if (localStorage.getItem(MODE_KEY) === "iso") mode.value = "iso";
  } catch {
    // nur Komfort
  }
});
function setMode(next: "grid" | "iso"): void {
  mode.value = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {
    // nur Komfort
  }
}

const total = computed(() => props.days.reduce((sum, day) => sum + day.total, 0));
const activeDays = computed(() => props.days.filter((day) => day.total > 0).length);

/** Stufen 1..4 aus den Quartilen der aktiven Tage (wie GitHub). */
const thresholds = computed(() => {
  const values = props.days
    .map((day) => day.total)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (!values.length) return [1, 2, 3];
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))]!;
  return [q(0.25), q(0.5), q(0.75)];
});

function level(count: number): number {
  if (!count) return 0;
  const [a, b, c] = thresholds.value;
  if (count <= a!) return 1;
  if (count <= b!) return 2;
  if (count <= c!) return 3;
  return 4;
}

interface Cell {
  day: ContributionDay;
  week: number;
  weekday: number; // 0 = Montag
  level: number;
}

const cells = computed<Cell[]>(() => {
  if (!props.days.length) return [];
  const first = new Date(`${props.days[0]!.date}T00:00:00Z`);
  const offset = (first.getUTCDay() + 6) % 7; // Montag = 0
  return props.days.map((day, index) => {
    const position = index + offset;
    return {
      day,
      week: Math.floor(position / 7),
      weekday: position % 7,
      level: level(day.total),
    };
  });
});
const weeks = computed(() => (cells.value.length ? cells.value[cells.value.length - 1]!.week + 1 : 53));

const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "short", timeZone: "UTC" });
const months = computed(() => {
  const labels: { week: number; label: string }[] = [];
  let last = -1;
  for (const cell of cells.value) {
    if (cell.weekday !== 0) continue;
    const month = new Date(`${cell.day.date}T00:00:00Z`).getUTCMonth();
    if (month !== last) {
      labels.push({ week: cell.week, label: monthFmt.format(new Date(`${cell.day.date}T00:00:00Z`)) });
      last = month;
    }
  }
  // Erstes Label entfällt, wenn es zu nah am zweiten steht.
  if (labels.length > 1 && labels[1]!.week - labels[0]!.week < 3) labels.shift();
  return labels;
});

// ---- Raster -------------------------------------------------------------

const SIZE = 11;
const GAP = 3;
const LEFT = 28;
const TOP = 16;
const gridWidth = computed(() => LEFT + weeks.value * (SIZE + GAP));
const gridHeight = TOP + 7 * (SIZE + GAP);

const HEAT = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

// ---- Isometrische Skyline --------------------------------------------------

// Flacher als echte Isometrie (22° statt 30°) — wirkt wie ein Panorama.
const ISO = 9;
const COS = Math.cos((22 * Math.PI) / 180);
const SIN = Math.sin((22 * Math.PI) / 180);
const maxTotal = computed(() => Math.max(1, ...props.days.map((day) => day.total)));

function iso(x: number, y: number, z: number): [number, number] {
  return [(x - y) * COS * ISO, (x + y) * SIN * ISO - z];
}

function pts(list: [number, number, number][]): string {
  return list.map(([x, y, z]) => iso(x, y, z).map((v) => v.toFixed(1)).join(",")).join(" ");
}

const isoBars = computed(() =>
  [...cells.value]
    .sort((a, b) => a.week + a.weekday - (b.week + b.weekday) || a.week - b.week)
    .map((cell) => {
      const x = cell.week;
      const y = cell.weekday;
      const w = 0.78;
      const h = cell.day.total ? 4 + (cell.day.total / maxTotal.value) * 64 : 1.5;
      const color = HEAT[cell.level]!;
      return {
        cell,
        top: pts([
          [x, y, h],
          [x + w, y, h],
          [x + w, y + w, h],
          [x, y + w, h],
        ]),
        left: pts([
          [x, y + w, 0],
          [x + w, y + w, 0],
          [x + w, y + w, h],
          [x, y + w, h],
        ]),
        right: pts([
          [x + w, y, 0],
          [x + w, y + w, 0],
          [x + w, y + w, h],
          [x + w, y, h],
        ]),
        color,
      };
    }),
);

/** Ausschnitt aus Grundfläche + tatsächlichen Gebäudehöhen (kein Leerraum). */
const isoBox = computed(() => {
  const corners = [
    iso(0, 0, 0),
    iso(weeks.value, 0, 0),
    iso(0, 7, 0),
    iso(weeks.value, 7, 0),
    ...cells.value
      .filter((cell) => cell.day.total > 0)
      .map((cell) => iso(cell.week, cell.weekday, 4 + (cell.day.total / maxTotal.value) * 64)),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs) - 6;
  const minY = Math.min(...ys) - 6;
  return `${minX.toFixed(0)} ${minY.toFixed(0)} ${(Math.max(...xs) - minX + 6).toFixed(0)} ${(Math.max(...ys) - minY + 6).toFixed(0)}`;
});

// ---- Tooltip -----------------------------------------------------------------

const tip = ref<{ x: number; y: number; text: string } | null>(null);
const wrap = ref<HTMLElement | null>(null);
const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function describe(day: ContributionDay): string {
  const when = dayFmt.format(new Date(`${day.date}T00:00:00Z`));
  if (!day.total) return `Keine ${props.noun[1]} am ${when}`;
  const parts = [
    day.commits ? plural(day.commits, "Commit", "Commits") : "",
    day.issues ? plural(day.issues, "Issue", "Issues") : "",
    day.comments ? plural(day.comments, "Kommentar", "Kommentare") : "",
  ].filter(Boolean);
  return `${plural(day.total, props.noun[0], props.noun[1])} am ${when}${parts.length > 1 ? ` — ${parts.join(", ")}` : ""}`;
}

function showTip(event: MouseEvent, day: ContributionDay): void {
  const box = wrap.value?.getBoundingClientRect();
  const target = (event.target as Element).getBoundingClientRect();
  if (!box) return;
  tip.value = {
    x: target.left + target.width / 2 - box.left,
    y: target.top - box.top,
    text: describe(day),
  };
}
</script>

<template>
  <div ref="wrap" class="heat">
    <div class="heat-head">
      <h2>
        <strong>{{ formatNumber(total) }}</strong>
        {{ total === 1 ? noun[0] : noun[1] }} im letzten Jahr
        <span class="muted small">· an {{ activeDays }} Tagen</span>
      </h2>
      <span class="spacer" />
      <div class="seg" role="radiogroup" aria-label="Darstellung">
        <button type="button" :class="{ active: mode === 'grid' }" @click="setMode('grid')">
          <PhSquaresFour :size="14" /> Raster
        </button>
        <button type="button" :class="{ active: mode === 'iso' }" @click="setMode('iso')">
          <PhBuildings :size="14" /> Skyline
        </button>
      </div>
    </div>
    <div class="box">
      <div class="heat-body">
        <div v-if="loading && !days.length" class="skeleton" style="height: 110px" />
        <svg
          v-else-if="mode === 'grid'"
          class="heat-svg"
          :viewBox="`0 0 ${gridWidth} ${gridHeight}`"
          role="img"
          :aria-label="`${total} ${noun[1]} im letzten Jahr`"
          @mouseleave="tip = null"
        >
          <text
            v-for="month in months"
            :key="`${month.week}-${month.label}`"
            :x="LEFT + month.week * (SIZE + GAP)"
            y="10"
          >{{ month.label }}</text>
          <text :x="0" :y="TOP + 1 * (SIZE + GAP) + 9">Di</text>
          <text :x="0" :y="TOP + 3 * (SIZE + GAP) + 9">Do</text>
          <text :x="0" :y="TOP + 5 * (SIZE + GAP) + 9">Sa</text>
          <rect
            v-for="cell in cells"
            :key="cell.day.date"
            class="heat-cell"
            :x="LEFT + cell.week * (SIZE + GAP)"
            :y="TOP + cell.weekday * (SIZE + GAP)"
            :width="SIZE"
            :height="SIZE"
            rx="2"
            :fill="HEAT[cell.level]"
            @mouseenter="showTip($event, cell.day)"
          />
        </svg>
        <svg
          v-else
          class="heat-svg heat-iso"
          :viewBox="isoBox"
          role="img"
          :aria-label="`${total} ${noun[1]} im letzten Jahr als Skyline`"
          @mouseleave="tip = null"
        >
          <g
            v-for="bar in isoBars"
            :key="bar.cell.day.date"
            class="iso-bar"
            @mouseenter="showTip($event, bar.cell.day)"
          >
            <polygon :points="bar.left" :style="{ fill: `color-mix(in srgb, ${bar.color} 78%, black)` }" />
            <polygon :points="bar.right" :style="{ fill: `color-mix(in srgb, ${bar.color} 62%, black)` }" />
            <polygon :points="bar.top" class="iso-top" :style="{ fill: bar.color }" />
          </g>
        </svg>
      </div>
      <div class="heat-foot">
        <span>{{ mode === "iso" ? "Jeder Tag ein Gebäude — Höhe = Beiträge." : "Commits, eröffnete Issues und Kommentare." }}</span>
        <span class="heat-legend">
          weniger
          <span v-for="(color, index) in HEAT" :key="index" :style="{ background: color }" />
          mehr
        </span>
      </div>
    </div>
    <div v-if="tip" class="heat-tip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">{{ tip.text }}</div>
  </div>
</template>
