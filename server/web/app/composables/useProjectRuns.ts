import type { ActionRun } from "~/types/api";

/**
 * Alle Runs eines Projekts (bzw. gefiltert) plus Prüfstatus je Commit.
 * Solange Runs warten oder laufen, wird alle 3 s nachgeladen — der
 * Status-Haken an Commits springt so ohne Neuladen auf ✓/✗.
 */
export function useProjectRuns(
  slug: string,
  filter: () => { commit?: string; action?: string; model?: string } = () => ({}),
) {
  const { api } = useApi();
  const key = computed(() => {
    const f = filter();
    return `runs-${slug}-${f.commit ?? ""}-${f.action ?? ""}-${f.model ?? ""}`;
  });

  const { data, refresh, status } = useAsyncData(
    key,
    () => api<{ runs: ActionRun[] }>(`/projects/${slug}/runs`, { query: filter() }),
    { lazy: true, watch: [key] },
  );

  const runs = computed(() => data.value?.runs ?? []);
  const checks = computed(() => checksByCommit(runs.value));
  const pending = computed(
    () => (status.value === "pending" || status.value === "idle") && !data.value,
  );
  const hasActive = computed(() => runs.value.some((run) => isRunPending(run.status)));

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    timer = setInterval(() => {
      if (hasActive.value) void refresh();
    }, 3000);
  });
  onBeforeUnmount(() => clearInterval(timer));

  /**
   * Statuswechsel aus einem Live-Stream direkt übernehmen. `data` ist in
   * Nuxt 4 ein shallowRef — deshalb ein neues Objekt statt Mutation.
   */
  function apply(updated: ActionRun): void {
    const list = data.value?.runs;
    if (!list?.some((run) => run.id === updated.id)) return;
    data.value = { runs: list.map((run) => (run.id === updated.id ? { ...run, ...updated } : run)) };
  }

  return { runs, checks, pending, hasActive, refresh, apply };
}
