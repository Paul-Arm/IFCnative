<script setup lang="ts">
import type {
  EntityFieldDiff,
  GuidChangeStatus,
  GuidDiffEntry,
} from "~/types/api";

/**
 * Einträge eines Diff-Typs, gruppiert nach Name: Geänderte Entities sind
 * einzeln aufklappbar (Feld-Diff wird beim Öffnen nachgeladen), neue und
 * entfernte mit gleichem Namen zusammengefasst.
 */
defineProps<{
  names: { name: string; entries: GuidDiffEntry[] }[];
  status: GuidChangeStatus;
  details: Map<string, EntityFieldDiff | "loading">;
}>();

const emit = defineEmits<{ (e: "load-detail", entry: GuidDiffEntry): void }>();

function onToggle(event: Event, entry: GuidDiffEntry): void {
  if ((event.target as HTMLDetailsElement).open) {
    emit("load-detail", entry);
  }
}
</script>

<template>
  <template v-for="nameGroup in names" :key="nameGroup.name">
    <!-- Geändert: jede Entity einzeln aufklappbar (Feld-Diff) -->
    <template v-if="status === 'modified'">
      <details
        v-for="entry in nameGroup.entries"
        :key="entry.globalId"
        class="entity-detail tree-leaf"
        @toggle="onToggle($event, entry)"
      >
        <summary>
          {{ nameGroup.name }}
          <span class="commit-id">{{ entry.globalId }}</span>
        </summary>
        <div style="margin-top: 0.5rem">
          <LoadingState
            v-if="details.get(entry.globalId) === 'loading'"
            text="Lade Details … (beide Stände werden dafür geparst)"
          />
          <div v-else-if="details.get(entry.globalId)" class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Gruppe</th>
                  <th>Feld</th>
                  <th>Vorher</th>
                  <th>Nachher</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="change in (details.get(entry.globalId) as EntityFieldDiff).changes"
                  :key="`${change.group}:${change.field}`"
                >
                  <td class="small">{{ change.group }}</td>
                  <td class="small"><strong>{{ change.field }}</strong></td>
                  <td class="small mono diff-row-removed">
                    {{ change.before ?? "—" }}
                  </td>
                  <td class="small mono diff-row-added">
                    {{ change.after ?? "—" }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </template>
    <!-- Neu/Entfernt: gleiche Namen zusammengefasst -->
    <details v-else-if="nameGroup.entries.length > 1" class="tree-name">
      <summary>
        {{ nameGroup.name }}
        <span class="badge">{{ nameGroup.entries.length }}</span>
      </summary>
      <ul class="tree-guids">
        <li
          v-for="entry in nameGroup.entries"
          :key="entry.globalId"
          class="commit-id"
        >
          {{ entry.globalId }}
        </li>
      </ul>
    </details>
    <div v-else class="tree-leaf">
      {{ nameGroup.name }}
      <span class="commit-id">{{ nameGroup.entries[0]!.globalId }}</span>
    </div>
  </template>
</template>
