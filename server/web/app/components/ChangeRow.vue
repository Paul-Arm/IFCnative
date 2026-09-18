<script setup lang="ts">
import {
  PhCaretRight,
  PhCopy,
  PhCrosshair,
  PhMinusCircle,
  PhPencilSimpleLine,
  PhPlusCircle,
} from "@phosphor-icons/vue";

import type {
  ChangeFacet,
  ChangeItem,
  ObjectFieldChange,
} from "~/types/api";

/**
 * Eine Zeile der Änderungsliste: zeigt sofort, WAS sich am Objekt geändert
 * hat (wichtigste Vorher/Nachher-Werte bzw. Eckdaten). Aufgeklappt folgt die
 * vollständige Feldliste, gruppiert nach Attribute / Lage / Geometrie / Pset.
 */
const props = defineProps<{
  item: ChangeItem;
  open: boolean;
  /** Vollständige Feldliste — "loading", solange sie geholt wird. */
  detail: ObjectFieldChange[] | "loading" | "error" | undefined;
  facetLabels: Record<ChangeFacet, string>;
  /** 3D-Vergleich ist offen: "In 3D zeigen" anbieten. */
  canLocate: boolean;
  located: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle"): void;
  (e: "locate"): void;
}>();

const STATUS_LABEL = { added: "Neu", modified: "Geändert", removed: "Entfernt" };

const copied = ref(false);
async function copyGuid(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.item.globalId);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Zwischenablage nicht verfügbar — GUID steht sichtbar daneben.
  }
}

/** Feldliste nach Gruppe bündeln (Reihenfolge kommt sortiert vom Server). */
const groups = computed(() => {
  if (!Array.isArray(props.detail)) return [];
  const result: { name: string; changes: ObjectFieldChange[] }[] = [];
  for (const change of props.detail) {
    const last = result[result.length - 1];
    if (last && last.name === change.group) {
      last.changes.push(change);
    } else {
      result.push({ name: change.group, changes: [change] });
    }
  }
  return result;
});

const hiddenChanges = computed(() =>
  Math.max(0, props.item.changeCount - props.item.highlights.length),
);
</script>

<template>
  <li class="chg-row" :class="[`is-${item.status}`, { open, located }]">
    <button
      class="chg-head"
      type="button"
      :aria-expanded="open"
      @click="emit('toggle')"
    >
      <span class="chg-status" :title="STATUS_LABEL[item.status]">
        <PhPlusCircle v-if="item.status === 'added'" :size="18" weight="fill" />
        <PhMinusCircle
          v-else-if="item.status === 'removed'"
          :size="18"
          weight="fill"
        />
        <PhPencilSimpleLine v-else :size="18" weight="fill" />
      </span>
      <span class="chg-main">
        <span class="chg-title">
          <span class="chg-name">{{ item.name || "(ohne Name)" }}</span>
          <span class="chg-type">{{ item.type }}</span>
          <span v-if="item.container" class="chg-container">
            {{ item.container }}
          </span>
        </span>

        <!-- Geändert: die wichtigsten Vorher/Nachher-Werte direkt in der Zeile -->
        <span v-if="item.highlights.length" class="chg-highlights">
          <span
            v-for="change in item.highlights"
            :key="`${change.group}:${change.field}`"
            class="chg-hl"
          >
            <span class="chg-hl-field">
              <span class="muted">{{ change.group }} ›</span>
              {{ change.field }}
            </span>
            <span class="chg-hl-values">
              <template v-if="change.field === 'Verschiebung'">
                <span class="val-after">{{ change.after }}</span>
              </template>
              <template v-else>
                <span v-if="change.before !== null" class="val-before">{{
                  change.before
                }}</span>
                <span v-else class="muted">—</span>
                <span class="chg-arrow" aria-hidden="true">→</span>
                <span v-if="change.after !== null" class="val-after">{{
                  change.after
                }}</span>
                <span v-else class="muted">entfernt</span>
              </template>
            </span>
          </span>
          <span v-if="hiddenChanges" class="muted small">
            + {{ hiddenChanges }}
            {{ hiddenChanges === 1 ? "weitere Änderung" : "weitere Änderungen" }}
          </span>
        </span>

        <!-- Neu/Entfernt: Eckdaten des Objekts -->
        <span v-else-if="item.facts.length" class="chg-facts">
          <span v-for="fact in item.facts" :key="fact.label" class="chg-fact">
            <span class="muted">{{ fact.label }}:</span> {{ fact.value }}
          </span>
        </span>
      </span>

      <span v-if="item.facets.length" class="chg-facets">
        <span
          v-for="facet in item.facets"
          :key="facet"
          class="facet-tag"
          :class="`facet-${facet}`"
        >
          {{ facetLabels[facet] }}
        </span>
      </span>
      <PhCaretRight class="chg-caret" :size="14" aria-hidden="true" />
    </button>

    <div v-if="open" class="chg-detail">
      <div class="chg-detail-bar">
        <code class="commit-id" title="IFC GlobalId">{{ item.globalId }}</code>
        <button class="link small" type="button" @click="copyGuid">
          <PhCopy :size="13" aria-hidden="true" />
          {{ copied ? "Kopiert" : "GUID kopieren" }}
        </button>
        <span class="topbar-spacer" />
        <button
          v-if="canLocate"
          class="btn small"
          type="button"
          @click="emit('locate')"
        >
          <PhCrosshair :size="14" aria-hidden="true" />
          In 3D zeigen
        </button>
      </div>

      <LoadingState v-if="detail === 'loading' || detail === undefined" text="Lade Details …" />
      <div v-else-if="detail === 'error'" class="alert error" style="margin: 0">
        Details konnten nicht geladen werden.
      </div>
      <div v-else-if="!groups.length" class="muted small">
        Keine Felder vorhanden.
      </div>
      <div v-else class="chg-groups">
        <section v-for="group in groups" :key="group.name" class="chg-group">
          <h4>{{ group.name }}</h4>
          <table class="chg-table">
            <tbody>
              <tr
                v-for="change in group.changes"
                :key="change.field"
                :class="`field-${change.status}`"
              >
                <th scope="row">{{ change.field }}</th>
                <template v-if="item.status === 'modified'">
                  <td class="val-before-cell">
                    {{ change.before ?? "—" }}
                  </td>
                  <td class="chg-arrow-cell" aria-hidden="true">→</td>
                  <td class="val-after-cell">
                    {{ change.after ?? "—" }}
                  </td>
                </template>
                <td v-else>{{ change.after ?? change.before }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </li>
</template>
