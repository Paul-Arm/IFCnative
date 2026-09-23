<script setup lang="ts">
import {
  PhChatCircleText,
  PhCheckCircle,
  PhFolderSimple,
  PhGitCommit,
  PhProhibit,
  PhRecord,
  PhShieldCheck,
  PhWarningCircle,
  PhXCircle,
} from "@phosphor-icons/vue";

import type { ActivityEvent } from "~/types/api";

/**
 * Aktivitäts-Feed nach Tagen gruppiert: Commits (mit Änderungsumfang),
 * eröffnete/geschlossene Issues, Kommentare, Prüf-Runs, neue Projekte.
 */
const props = withDefaults(
  defineProps<{
    events: ActivityEvent[];
    /** Projektname je Eintrag zeigen (Dashboard), im Projekt nicht. */
    showProject?: boolean;
    loading?: boolean;
  }>(),
  { showProject: true, loading: false },
);

const groups = computed(() => {
  const result: { key: string; label: string; items: ActivityEvent[] }[] = [];
  const today = dayKey(new Date());
  const yesterday = dayKey(Date.now() - 24 * 3600 * 1000);
  for (const event of props.events) {
    const key = dayKey(event.at);
    let group = result[result.length - 1];
    if (!group || group.key !== key) {
      const label = key === today ? "Heute" : key === yesterday ? "Gestern" : formatLongDate(event.at);
      group = { key, label, items: [] };
      result.push(group);
    }
    group.items.push(event);
  }
  return result;
});

function badge(event: ActivityEvent): { icon: unknown; cls: string } {
  switch (event.type) {
    case "commit":
      return { icon: PhGitCommit, cls: "commit" };
    case "issue_opened":
    case "issue_reopened":
      return { icon: PhRecord, cls: "open" };
    case "issue_closed":
      return { icon: PhCheckCircle, cls: "closed" };
    case "comment":
      return { icon: PhChatCircleText, cls: "" };
    case "project_created":
      return { icon: PhFolderSimple, cls: "project" };
    case "run": {
      const status = event.run?.status;
      if (status === "success") return { icon: PhShieldCheck, cls: "run-success" };
      if (status === "failed") return { icon: PhXCircle, cls: "run-failed" };
      if (status === "error") return { icon: PhWarningCircle, cls: "run-failed" };
      if (status === "cancelled") return { icon: PhProhibit, cls: "" };
      return { icon: PhShieldCheck, cls: "" };
    }
    default:
      return { icon: PhRecord, cls: "" };
  }
}

function projectPath(event: ActivityEvent): string {
  return `/p/${event.project.slug}`;
}

function commitPath(event: ActivityEvent): string {
  if (!event.model || !event.commit) return projectPath(event);
  return event.model.kind === "ifc"
    ? `${projectPath(event)}/m/${event.model.slug}/c/${event.commit.id}`
    : `${projectPath(event)}/m/${event.model.slug}?at=${event.commit.id}`;
}

function issuePath(event: ActivityEvent): string {
  return `${projectPath(event)}/i/${event.issue?.number ?? ""}`;
}
</script>

<template>
  <div class="feed">
    <div v-if="loading && !events.length" class="feed-list">
      <div v-for="index in 5" :key="index" class="feed-item">
        <span class="skeleton dot" style="width: 32px; height: 32px" />
        <div class="feed-body"><span class="skeleton" style="max-width: 420px" /></div>
      </div>
    </div>

    <template v-for="group in groups" :key="group.key">
      <div class="feed-day">{{ group.label }}</div>
      <ul class="feed-list">
        <li v-for="event in group.items" :key="event.id" class="feed-item">
          <span class="feed-badge" :class="badge(event).cls">
            <component :is="badge(event).icon" :size="16" :weight="event.type === 'issue_closed' ? 'fill' : 'regular'" />
          </span>
          <div class="feed-body">
            <!-- Commit -->
            <template v-if="event.type === 'commit'">
              <div class="feed-line">
                <span class="actor">{{ event.actor?.name ?? "?" }}</span>
                committete in
                <NuxtLink :to="`${projectPath(event)}/m/${event.model?.slug}`">{{ event.model?.name }}</NuxtLink>
                <template v-if="showProject">
                  · <NuxtLink :to="projectPath(event)">{{ event.project.name }}</NuxtLink>
                </template>
                · <RelTime :date="event.at" />
              </div>
              <NuxtLink :to="commitPath(event)" class="feed-card" style="display: block; text-decoration: none">
                <div class="feed-card-title">
                  <ModelIcon v-if="event.model" :kind="event.model.kind" :name="event.model.name" />
                  <span class="truncate">{{ event.commit?.message || "(ohne Nachricht)" }}</span>
                  <span class="sha">{{ shortSha(event.commit?.id ?? "") }}</span>
                </div>
                <div class="feed-card-meta">
                  <span class="tag tag-mono">{{ event.commit?.branchName }}</span>
                  <span v-if="event.model?.kind === 'ifc' && event.commit" class="diffstat">
                    <span class="add">+{{ formatNumber(event.commit.added) }}</span>
                    <span class="mod">~{{ formatNumber(event.commit.modified) }}</span>
                    <span class="del">−{{ formatNumber(event.commit.removed) }}</span>
                    <span class="muted">Objekte</span>
                  </span>
                  <span v-else-if="event.model?.folder" class="muted">{{ event.model.folder }}/</span>
                </div>
              </NuxtLink>
            </template>

            <!-- Issues -->
            <template v-else-if="event.type === 'issue_opened' || event.type === 'issue_closed' || event.type === 'issue_reopened'">
              <div class="feed-line">
                <span class="actor">{{ event.actor?.name ?? "?" }}</span>
                {{
                  event.type === "issue_opened"
                    ? "eröffnete"
                    : event.type === "issue_closed"
                      ? "schloss"
                      : "öffnete wieder"
                }}
                <NuxtLink :to="issuePath(event)">{{ event.issue?.title }}</NuxtLink>
                <span class="muted">#{{ event.issue?.number }}</span>
                <template v-if="showProject">
                  · <NuxtLink :to="projectPath(event)">{{ event.project.name }}</NuxtLink>
                </template>
                · <RelTime :date="event.at" />
              </div>
            </template>

            <!-- Kommentar -->
            <template v-else-if="event.type === 'comment'">
              <div class="feed-line">
                <span class="actor">{{ event.actor?.name ?? "?" }}</span>
                kommentierte
                <NuxtLink :to="issuePath(event)">{{ event.issue?.title }}</NuxtLink>
                <span class="muted">#{{ event.issue?.number }}</span>
                <template v-if="showProject">
                  · <NuxtLink :to="projectPath(event)">{{ event.project.name }}</NuxtLink>
                </template>
                · <RelTime :date="event.at" />
              </div>
              <NuxtLink
                v-if="event.comment?.excerpt"
                :to="`${issuePath(event)}#comment-${event.comment.id}`"
                class="feed-card feed-excerpt"
                style="display: block; text-decoration: none"
              >
                {{ event.comment.excerpt }}
              </NuxtLink>
            </template>

            <!-- Prüf-Run -->
            <template v-else-if="event.type === 'run'">
              <div class="feed-line">
                Prüfung
                <NuxtLink :to="`${projectPath(event)}/actions?run=${event.run?.id}`">{{ event.run?.actionName }}</NuxtLink>
                <span class="muted">#{{ event.run?.number }}</span>
                <strong :class="event.run?.status === 'success' ? 'color-success' : event.run?.status === 'failed' || event.run?.status === 'error' ? 'color-danger' : ''">
                  {{ RUN_STATUS_LABEL[event.run?.status ?? "queued"].toLowerCase() }}
                </strong>
                <template v-if="event.model">
                  für <NuxtLink :to="`${projectPath(event)}/m/${event.model.slug}`">{{ event.model.name }}</NuxtLink>
                </template>
                <template v-if="showProject">
                  · <NuxtLink :to="projectPath(event)">{{ event.project.name }}</NuxtLink>
                </template>
                · <RelTime :date="event.at" />
              </div>
              <div v-if="event.run?.summary" class="feed-excerpt">{{ event.run.summary }}</div>
            </template>

            <!-- Projekt -->
            <template v-else-if="event.type === 'project_created'">
              <div class="feed-line">
                <span class="actor">{{ event.actor?.name ?? "?" }}</span>
                legte das Projekt
                <NuxtLink :to="projectPath(event)">{{ event.project.name }}</NuxtLink>
                an · <RelTime :date="event.at" />
              </div>
            </template>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
