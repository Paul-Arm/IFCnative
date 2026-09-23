import type { ComputedRef, InjectionKey, Ref } from "vue";

import type { Model, ProjectDetail, ProjectStats, Role } from "~/types/api";

/**
 * Projekt-Kontext: Die Rahmenseite `p/[project].vue` lädt Projekt, Modelle
 * und Kennzahlen EINMAL und stellt sie allen Unterseiten (Dateien, Issues,
 * Actions …) per provide/inject bereit — statt dass jede Seite dieselben
 * Anfragen erneut stellt.
 */
export interface ProjectContext {
  slug: string;
  detail: Ref<ProjectDetail | null | undefined>;
  models: Ref<Model[] | null>;
  stats: Ref<ProjectStats | null>;
  error: Ref<unknown>;
  modelsPending: ComputedRef<boolean>;
  role: ComputedRef<Role | null>;
  /** contributor und höher: committen, Dateien/Issues bearbeiten. */
  canWrite: ComputedRef<boolean>;
  /** maintainer und höher: Einstellungen, Mitglieder. */
  isAdmin: ComputedRef<boolean>;
  isOwner: ComputedRef<boolean>;
  refreshProject: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

const PROJECT_KEY: InjectionKey<ProjectContext> = Symbol("hub-project");

/** Kurzinfo zum geöffneten Projekt für Kopfzeile und Befehlspalette. */
export interface ProjectHeaderContext {
  slug: string;
  name: string;
  canWrite: boolean;
}

/**
 * Geteilter Projektkontext für Komponenten außerhalb der Projektseiten
 * (Kopfzeile, Befehlspalette). Kann von einem vorher besuchten Projekt
 * stammen — Nutzer vergleichen `slug` mit der aktuellen Route.
 */
export function useProjectHeaderContext() {
  return useState<ProjectHeaderContext | null>("hub:project-context", () => null);
}

export function provideProject(slug: string): ProjectContext {
  const { api } = useApi();
  const context = useProjectHeaderContext();

  const {
    data: detail,
    refresh: refreshDetail,
    error,
  } = useAsyncData(`project-${slug}`, () => api<ProjectDetail>(`/projects/${slug}`), {
    lazy: true,
  });

  const {
    data: modelsData,
    refresh: refreshModelsData,
    status: modelsStatus,
  } = useAsyncData(
    `models-${slug}`,
    () => api<{ models: Model[] }>(`/projects/${slug}/models`),
    { lazy: true },
  );

  const { data: statsData, refresh: refreshStatsData } = useAsyncData(
    `stats-${slug}`,
    () =>
      api<ProjectStats>(`/projects/${slug}/stats`).catch(() => null),
    { lazy: true },
  );

  // Globale Admins haben serverseitig Owner-Rechte in jedem Projekt — ohne
  // Mitgliedschaft (API: role null) wie mit einer niedrigeren Rolle.
  const { user } = useAuth();
  const role = computed<Role | null>(() => {
    if (!detail.value) return null;
    if (user.value?.isAdmin) return "owner";
    return detail.value.role ?? null;
  });
  const isAdmin = computed(() => role.value === "owner" || role.value === "maintainer");
  const canWrite = computed(() => isAdmin.value || role.value === "contributor");
  const isOwner = computed(() => role.value === "owner");

  watch(
    [detail, canWrite],
    ([value, write]) => {
      if (value?.project) {
        context.value = { slug, name: value.project.name, canWrite: write };
      }
    },
    { immediate: true },
  );

  const models = computed(() => modelsData.value?.models ?? null);
  const stats = computed(() => statsData.value ?? null);

  const value: ProjectContext = {
    slug,
    detail: detail as Ref<ProjectDetail | null | undefined>,
    models: models as unknown as Ref<Model[] | null>,
    stats: stats as unknown as Ref<ProjectStats | null>,
    error,
    modelsPending: computed(
      () =>
        (modelsStatus.value === "pending" || modelsStatus.value === "idle") &&
        !modelsData.value,
    ),
    role,
    canWrite,
    isAdmin,
    isOwner,
    refreshProject: async () => {
      await refreshDetail();
    },
    refreshModels: async () => {
      await refreshModelsData();
    },
    refreshStats: async () => {
      await refreshStatsData();
    },
  };
  provide(PROJECT_KEY, value);
  return value;
}

export function useProject(): ProjectContext {
  const value = inject(PROJECT_KEY, null);
  if (!value) {
    throw new Error("useProject() nur innerhalb von /p/[project] verwenden");
  }
  return value;
}
