<script setup lang="ts">
import { PhCopy, PhCheck, PhDownloadSimple, PhEye, PhGitCommit } from "@phosphor-icons/vue";

import type { Commit } from "~/types/api";
import type { CommitCheck } from "~/utils/runs";

/**
 * Versionsverlauf eines Modells: Commits nach Tagen gruppiert, links ein
 * Branch-Graph (eine Spur je Branch, Kanten zum Vorgänger), rechts
 * Prüfstatus, Änderungsumfang und Aktionen.
 */
const props = defineProps<{
  commits: Commit[];
  slug: string;
  modelSlug: string;
  defaultBranch: string;
  isIfc: boolean;
  /** Branch-Kennzeichen an jedem Commit (Ansicht „Alle Branches“). */
  showBranches: boolean;
  checks: Map<string, CommitCheck>;
  downloadExt: string;
}>();

const emit = defineEmits<{ (e: "download", commit: Commit): void }>();

const HEADER_H = 37;
const ROW_H = 64;
const LANE_W = 16;
const LANE_COLORS = ["var(--accent)", "var(--success)", "var(--done)", "var(--attention)", "var(--danger)", "#39c5cf"];

interface Row {
  type: "day" | "commit";
  key: string;
  y: number;
  label?: string;
  commit?: Commit;
  lane?: number;
}

const layout = computed(() => {
  const lanes: string[] = [];
  if (props.commits.some((c) => c.branchName === props.defaultBranch)) lanes.push(props.defaultBranch);
  for (const commit of props.commits) {
    if (!lanes.includes(commit.branchName)) lanes.push(commit.branchName);
  }
  const rows: Row[] = [];
  let y = 0;
  let lastDay = "";
  for (const commit of props.commits) {
    const day = dayKey(commit.createdAt);
    if (day !== lastDay) {
      rows.push({ type: "day", key: `day-${day}`, y, label: formatLongDate(commit.createdAt) });
      y += HEADER_H;
      lastDay = day;
    }
    rows.push({
      type: "commit",
      key: commit.id,
      y: y + ROW_H / 2,
      commit,
      lane: Math.max(0, lanes.indexOf(commit.branchName)),
    });
    y += ROW_H;
  }
  const byId = new Map(rows.filter((r) => r.type === "commit").map((r) => [r.commit!.id, r]));
  const x = (lane: number) => 14 + lane * LANE_W;
  const edges: { d: string; color: string }[] = [];
  for (const row of rows) {
    if (row.type !== "commit") continue;
    const parentId = row.commit!.parentCommitId;
    const parent = parentId ? byId.get(parentId) : undefined;
    const color = LANE_COLORS[row.lane! % LANE_COLORS.length]!;
    if (!parent) {
      // Vorgänger nicht in der Liste (anderer Branch gefiltert): Stummel nach unten.
      if (parentId) {
        edges.push({ d: `M ${x(row.lane!)} ${row.y} L ${x(row.lane!)} ${row.y + ROW_H / 2}`, color });
      }
      continue;
    }
    const x1 = x(row.lane!);
    const x2 = x(parent.lane!);
    const d =
      x1 === x2
        ? `M ${x1} ${row.y} L ${x2} ${parent.y}`
        : `M ${x1} ${row.y} L ${x1} ${parent.y - 22} Q ${x1} ${parent.y - 6} ${x2} ${parent.y}`;
    edges.push({ d, color });
  }
  return {
    rows,
    edges,
    height: y,
    width: 14 + Math.max(1, lanes.length) * LANE_W,
    laneColor: (lane: number) => LANE_COLORS[lane % LANE_COLORS.length]!,
    x,
  };
});

/** Anteile neu/geändert/entfernt als 5 Kästchen (wie GitHubs Diffstat). */
function blocks(commit: Commit): ("add" | "mod" | "del" | "none")[] {
  const total = commit.added + commit.modified + commit.removed;
  if (!total) return ["none", "none", "none", "none", "none"];
  const parts = [
    ["add", commit.added],
    ["mod", commit.modified],
    ["del", commit.removed],
  ] as const;
  const result: ("add" | "mod" | "del" | "none")[] = [];
  for (const [kind, count] of parts) {
    const n = Math.round((count / total) * 5);
    for (let i = 0; i < n && result.length < 5; i += 1) result.push(kind);
  }
  while (result.length < 5) result.push("none");
  return result;
}

function commitHref(commit: Commit): string {
  return props.isIfc
    ? `/p/${props.slug}/m/${props.modelSlug}/c/${commit.id}`
    : `/p/${props.slug}/m/${props.modelSlug}?at=${commit.id}`;
}

const copied = ref<string | null>(null);
async function copy(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    copied.value = id;
    setTimeout(() => (copied.value = null), 1500);
  } catch {
    // Zwischenablage nicht verfügbar
  }
}
</script>

<template>
  <div class="history box" :style="{ '--graph-w': `${layout.width}px` }">
    <svg
      class="history-graph"
      :width="layout.width"
      :height="layout.height"
      aria-hidden="true"
    >
      <path
        v-for="(edge, index) in layout.edges"
        :key="index"
        :d="edge.d"
        :stroke="edge.color"
        stroke-width="2"
        fill="none"
        stroke-linecap="round"
      />
      <template v-for="row in layout.rows" :key="row.key">
        <circle
          v-if="row.type === 'commit'"
          :cx="layout.x(row.lane!)"
          :cy="row.y"
          r="5"
          fill="var(--bg)"
          :stroke="layout.laneColor(row.lane!)"
          stroke-width="2.5"
        />
      </template>
    </svg>

    <template v-for="row in layout.rows" :key="row.key">
      <div v-if="row.type === 'day'" class="history-day">
        <PhGitCommit :size="14" />
        Commits am {{ row.label }}
      </div>
      <div v-else class="history-row">
        <div class="history-main">
          <NuxtLink :to="commitHref(row.commit!)" class="history-msg">
            {{ row.commit!.message || "(ohne Nachricht)" }}
          </NuxtLink>
          <div class="history-meta">
            <UserAvatar :user="row.commit!.author ?? null" :size="16" />
            <strong>{{ row.commit!.author?.name ?? "?" }}</strong>
            committete <RelTime :date="row.commit!.createdAt" />
            <span
              v-if="showBranches || row.commit!.branchName !== defaultBranch"
              class="tag history-branch"
              :style="{ color: layout.laneColor(row.lane!), borderColor: 'currentColor' }"
            >{{ row.commit!.branchName }}</span>
          </div>
        </div>
        <div class="history-side">
          <CommitStatus :check="checks.get(row.commit!.id)" :slug="slug" />
          <span
            v-if="isIfc"
            class="diffstat hide-sm"
            :title="`${row.commit!.added} neu · ${row.commit!.modified} geändert · ${row.commit!.removed} entfernt`"
          >
            <span class="add">+{{ formatNumber(row.commit!.added) }}</span>
            <span class="mod">~{{ formatNumber(row.commit!.modified) }}</span>
            <span class="del">−{{ formatNumber(row.commit!.removed) }}</span>
            <span class="diffblocks">
              <span v-for="(kind, index) in blocks(row.commit!)" :key="index" :class="kind" />
            </span>
          </span>
          <span class="btn-group">
            <button
              type="button"
              class="btn btn-sm sha-btn"
              :title="`Commit-Id kopieren: ${row.commit!.id}`"
              @click="copy(row.commit!.id)"
            >
              <PhCheck v-if="copied === row.commit!.id" :size="14" class="color-success" />
              <PhCopy v-else :size="14" />
              <span class="mono">{{ shortSha(row.commit!.id) }}</span>
            </button>
            <NuxtLink
              :to="`/p/${slug}/m/${modelSlug}?at=${row.commit!.id}`"
              class="btn btn-sm btn-icon"
              :aria-label="isIfc ? 'Diesen Stand in 3D ansehen' : 'Diesen Stand ansehen'"
              :data-tip="isIfc ? 'Stand in 3D ansehen' : 'Stand ansehen'"
            >
              <PhEye :size="14" />
            </NuxtLink>
            <button
              type="button"
              class="btn btn-sm btn-icon"
              :aria-label="`.${downloadExt} herunterladen`"
              :data-tip="`.${downloadExt} herunterladen`"
              @click="emit('download', row.commit!)"
            >
              <PhDownloadSimple :size="14" />
            </button>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
