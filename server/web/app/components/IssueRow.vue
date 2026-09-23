<script setup lang="ts">
import { PhCaretDown, PhCaretRight, PhChatCircle, PhCube, PhTreeStructure } from "@phosphor-icons/vue";

import type { Issue } from "~/types/api";

/**
 * Eine Zeile der Issue-Liste wie bei GitHub: Status, Titel, Labels,
 * Kurzinfos, rechts Bearbeiter und Kommentarzahl. Sammel-Issues zeigen
 * ihren Fortschritt und lassen sich aufklappen (Slot `children`).
 */
const props = withDefaults(
  defineProps<{
    issue: Issue;
    slug: string;
    expandable?: boolean;
    expanded?: boolean;
    /** Modell-Slug, dessen Versionsbezug zusätzlich gezeigt wird. */
    modelSlug?: string | null;
  }>(),
  { expandable: false, expanded: false, modelSlug: null },
);

const emit = defineEmits<{ (e: "toggle"): void; (e: "label", name: string): void }>();

const done = computed(() => props.issue.subIssueCount - props.issue.openSubIssueCount);
const linked = computed(() =>
  props.modelSlug ? props.issue.models.filter((model) => model.slug === props.modelSlug) : [],
);
</script>

<template>
  <div class="issue-row" :class="{ expanded }">
    <div class="issue-row-main">
      <IssueStateIcon :state="issue.state" :parent="issue.subIssueCount > 0" class="issue-row-icon" />
      <div class="issue-row-body">
        <div class="issue-row-title">
          <NuxtLink :to="`/p/${slug}/i/${issue.number}`" class="issue-title-link">
            {{ issue.title }}
          </NuxtLink>
          <span v-if="issue.kind === 'bcf'" class="tag tag-accent tag-mono" title="Echtes IFC-Issue — als BCF exportierbar">BCF</span>
          <button
            v-for="label in issue.labels"
            :key="label.id"
            type="button"
            class="label-btn"
            :title="`Nach „${label.name}“ filtern`"
            @click="emit('label', label.name)"
          >
            <LabelChip :label="label" />
          </button>
        </div>
        <div class="issue-row-meta">
          #{{ issue.number }}
          <template v-if="issue.state === 'open'">
            eröffnet <RelTime :date="issue.createdAt" /> von
          </template>
          <template v-else>
            von
          </template>
          <strong>{{ issue.author?.name ?? "?" }}</strong>
          <template v-if="issue.state === 'closed'">
            · geschlossen <RelTime :date="issue.updatedAt" />
          </template>
          <template v-if="issue.parent">
            · Teil von
            <NuxtLink :to="`/p/${slug}/i/${issue.parent.number}`">#{{ issue.parent.number }}</NuxtLink>
          </template>
          <span v-for="model in issue.models.slice(0, 2)" :key="model.id" class="issue-row-model">
            <ModelIcon :kind="model.kind" :name="model.name" :size="12" />
            {{ model.name }}
          </span>
          <span v-if="issue.guids.length" class="issue-row-located" :title="`${issue.guids.length} Objekt(e) im 3D verortet`">
            <PhCube :size="12" /> {{ issue.guids.length }}
          </span>
          <template v-for="link in linked" :key="`v-${link.id}`">
            <span v-if="link.foundCommit">
              · aufgefallen in
              <NuxtLink class="mono" :to="`/p/${slug}/m/${link.slug}/c/${link.foundCommit.id}`">{{ shortSha(link.foundCommit.id) }}</NuxtLink>
            </span>
            <span v-if="link.fixedCommit">
              · behoben in
              <NuxtLink class="mono" :to="`/p/${slug}/m/${link.slug}/c/${link.fixedCommit.id}`">{{ shortSha(link.fixedCommit.id) }}</NuxtLink>
            </span>
          </template>
        </div>
      </div>
      <div class="issue-row-side">
        <button
          v-if="issue.subIssueCount"
          type="button"
          class="issue-progress"
          :disabled="!expandable"
          :title="`${done} von ${issue.subIssueCount} Unter-Issues erledigt`"
          @click="emit('toggle')"
        >
          <template v-if="expandable">
            <PhCaretDown v-if="expanded" :size="12" />
            <PhCaretRight v-else :size="12" />
          </template>
          <PhTreeStructure v-else :size="12" />
          <svg class="issue-progress-ring" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <circle cx="10" cy="10" r="8" class="ring-bg" />
            <circle
              cx="10"
              cy="10"
              r="8"
              class="ring-fg"
              :stroke-dasharray="`${(done / issue.subIssueCount) * 50.27} 50.27`"
            />
          </svg>
          {{ done }}/{{ issue.subIssueCount }}
        </button>
        <span v-if="issue.assignees.length" class="avatar-stack" :title="issue.assignees.map((a) => a.name).join(', ')">
          <UserAvatar v-for="user in issue.assignees.slice(0, 3)" :key="user.id" :user="user" :size="20" :titled="false" />
        </span>
        <NuxtLink
          v-if="issue.commentCount"
          :to="`/p/${slug}/i/${issue.number}`"
          class="issue-comments"
          :title="`${issue.commentCount} Kommentare`"
        >
          <PhChatCircle :size="16" />
          {{ issue.commentCount }}
        </NuxtLink>
      </div>
    </div>
    <slot name="children" />
  </div>
</template>
