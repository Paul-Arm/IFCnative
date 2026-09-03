<script setup lang="ts">
import type { ActionRun } from "~/types/api";

/**
 * Aufgeklappter Inhalt eines Action-Runs: Zusammenfassung, Live-Protokoll
 * (SSE, solange der Run läuft), Abbrechen/Erneut ausführen.
 *
 * Wird erst gemountet, wenn der Nutzer den Run aufklappt — sonst würde jede
 * Runs-Liste sofort alle Protokolle laden.
 */
const props = defineProps<{
  slug: string;
  run: ActionRun;
  canWrite: boolean;
}>();

const emit = defineEmits<{
  /** Status/Zusammenfassung des Runs hat sich geändert (Liste aktualisieren). */
  (e: "updated", run: ActionRun): void;
  /** „Erneut ausführen“ hat einen neuen Run angelegt. */
  (e: "retried", run: ActionRun): void;
}>();

const { api } = useApi();
const { token } = useAuth();

const log = ref<string | null>(null);
const loading = ref(true);
const live = ref(false);
const error = ref<string | null>(null);
const busy = ref<"cancel" | "retry" | null>(null);
const logEl = ref<HTMLPreElement | null>(null);
let abort: AbortController | null = null;

const isPending = computed(
  () => props.run.status === "queued" || props.run.status === "running",
);

function scrollLog(): void {
  const el = logEl.value;
  if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
}

async function loadOnce(): Promise<void> {
  try {
    const result = await api<{ run: ActionRun & { log?: string } }>(
      `/projects/${props.slug}/runs/${props.run.id}`,
    );
    log.value = result.run.log ?? "";
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function follow(): Promise<void> {
  abort?.abort();
  abort = new AbortController();
  live.value = true;
  try {
    await streamRunEvents(`/api/projects/${props.slug}/runs/${props.run.id}/events`, {
      token: token.value,
      signal: abort.signal,
      onStatus: (run) => {
        loading.value = false;
        if (typeof run.log === "string") {
          // Endstand bzw. bisheriges Protokoll (ersetzt die Live-Chunks).
          log.value = run.log;
        }
        const { log: _log, ...rest } = run;
        emit("updated", rest as ActionRun);
        scrollLog();
      },
      onLog: (chunk) => {
        loading.value = false;
        log.value = (log.value ?? "") + chunk;
        scrollLog();
      },
    });
  } catch (e) {
    if ((e as { name?: string })?.name !== "AbortError") {
      error.value = apiErrorMessage(e);
      // Fallback: Stand einmal laden.
      await loadOnce();
    }
  } finally {
    live.value = false;
  }
}

async function cancel(): Promise<void> {
  busy.value = "cancel";
  error.value = null;
  try {
    const result = await api<{ run: ActionRun }>(
      `/projects/${props.slug}/runs/${props.run.id}/cancel`,
      { method: "POST" },
    );
    emit("updated", result.run);
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = null;
  }
}

async function retry(): Promise<void> {
  busy.value = "retry";
  error.value = null;
  try {
    const result = await api<{ run: ActionRun }>(
      `/projects/${props.slug}/runs/${props.run.id}/retry`,
      { method: "POST" },
    );
    emit("retried", result.run);
  } catch (e) {
    error.value = apiErrorMessage(e);
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  if (isPending.value) {
    void follow();
  } else {
    void loadOnce();
  }
});

// Wird ein fertiger Run später wieder aktiv (Retry ersetzt ihn nicht), oder
// war die Verbindung weg: beim Wechsel auf pending neu anhängen.
watch(isPending, (pending) => {
  if (pending && !live.value) {
    void follow();
  }
});

onBeforeUnmount(() => {
  abort?.abort();
});
</script>

<template>
  <div class="run-details">
    <p v-if="run.summary" class="small" style="margin: 0.5rem 0">
      {{ run.summary }}
    </p>
    <p class="run-actions" style="margin: 0.5rem 0">
      <slot name="actions" />
      <button
        v-if="canWrite && isPending"
        class="btn small danger"
        :disabled="busy !== null"
        @click="cancel"
      >
        <span v-if="busy === 'cancel'" class="spinner" aria-hidden="true" />
        Abbrechen
      </button>
      <button
        v-if="canWrite && !isPending"
        class="btn small"
        :disabled="busy !== null"
        @click="retry"
      >
        <span v-if="busy === 'retry'" class="spinner" aria-hidden="true" />
        Erneut ausführen
      </button>
      <span v-if="live" class="muted small">
        <span class="spinner" aria-hidden="true" /> Live-Protokoll
      </span>
    </p>
    <div v-if="error" class="alert error" style="margin: 0.5rem 0">{{ error }}</div>
    <LoadingState v-if="loading" text="Lade Protokoll …" />
    <pre v-else-if="log" ref="logEl" class="run-log" :class="{ live }">{{ log }}</pre>
    <div v-else-if="isPending" class="muted small">
      Noch keine Ausgabe — der Lauf {{ run.status === "queued" ? "wartet in der Warteschlange" : "läuft" }}.
    </div>
    <div v-else class="muted small">Kein Protokoll vorhanden.</div>
  </div>
</template>
