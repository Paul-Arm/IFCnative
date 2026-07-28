/**
 * Browser-Zustand der Hub-Pane: Projekte → Modelle → Stände.
 *
 * Geladen wird erst, wenn die Verbindung steht (`online`); jede Auswahl weiter
 * links setzt die Ebenen rechts davon zurück. Alle Ladevorgänge laufen über
 * `track()` — dort sitzen Fehlerfang (deutsche Meldung), Busy-Zähler und der
 * Unmount-Schutz an genau einer Stelle.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createModel,
  createProject,
  listModels,
  listProjects,
  listVersions,
} from "../../domain/hub/client";
import { hubErrorMessage } from "../../domain/hub/error";
import type {
  HubConfig,
  HubModel,
  HubProject,
  HubVersion,
} from "../../domain/hub/types";

export interface HubBrowser {
  projects: HubProject[];
  models: HubModel[];
  versions: HubVersion[];
  projectId: string | null;
  modelId: string | null;
  project: HubProject | null;
  model: HubModel | null;
  busy: boolean;
  error: string | null;
  setError(message: string | null): void;
  selectProject(id: string | null): void;
  selectModel(id: string | null): void;
  refreshProjects(): Promise<void>;
  refreshVersions(): Promise<void>;
  addProject(name: string): Promise<void>;
  addModel(name: string): Promise<void>;
}

const NOOP = (): void => {};

export function useHubBrowser(config: HubConfig, online: boolean): HubBrowser {
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [models, setModels] = useState<HubModel[]>([]);
  const [versions, setVersions] = useState<HubVersion[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Einen Ladevorgang ausführen; Ergebnis nur anwenden, solange die Pane lebt. */
  const track = useCallback(
    async <T,>(
      load: () => Promise<T>,
      apply: (value: T) => void,
      onFailure: () => void,
    ): Promise<void> => {
      running.current++;
      setBusy(true);
      try {
        const value = await load();
        if (!alive.current) return;
        apply(value);
        setError(null);
      } catch (cause) {
        if (!alive.current) return;
        onFailure();
        setError(hubErrorMessage(cause));
      } finally {
        running.current--;
        if (alive.current) setBusy(running.current > 0);
      }
    },
    [],
  );

  const refreshProjects = useCallback(
    () =>
      track(
        () => listProjects(config),
        setProjects,
        () => setProjects([]),
      ),
    [config, track],
  );

  const refreshModels = useCallback(async () => {
    if (!projectId) {
      setModels([]);
      return;
    }
    await track(
      () => listModels(config, projectId),
      setModels,
      () => setModels([]),
    );
  }, [config, projectId, track]);

  const refreshVersions = useCallback(async () => {
    if (!projectId || !modelId) {
      setVersions([]);
      return;
    }
    await track(
      () => listVersions(config, projectId, modelId),
      setVersions,
      () => setVersions([]),
    );
  }, [config, modelId, projectId, track]);

  useEffect(() => {
    if (online) void refreshProjects();
  }, [online, refreshProjects]);

  useEffect(() => {
    if (online) void refreshModels();
  }, [online, refreshModels]);

  useEffect(() => {
    if (online) void refreshVersions();
  }, [online, refreshVersions]);

  const selectProject = useCallback((id: string | null) => {
    setProjectId(id);
    setModelId(null);
    setVersions([]);
    setError(null);
  }, []);

  const selectModel = useCallback((id: string | null) => {
    setModelId(id);
    setError(null);
  }, []);

  const addProject = useCallback(
    async (name: string) => {
      await track(
        () => createProject(config, name),
        (project) => {
          setProjectId(project.id);
          setModelId(null);
          setVersions([]);
        },
        NOOP,
      );
      await refreshProjects();
    },
    [config, refreshProjects, track],
  );

  const addModel = useCallback(
    async (name: string) => {
      if (!projectId) return;
      await track(
        () => createModel(config, projectId, name),
        (model) => {
          setModelId(model.id);
          setVersions([]);
        },
        NOOP,
      );
      await refreshModels();
    },
    [config, projectId, refreshModels, track],
  );

  const project = useMemo(
    () => projects.find((entry) => entry.id === projectId) ?? null,
    [projectId, projects],
  );
  const model = useMemo(
    () => models.find((entry) => entry.id === modelId) ?? null,
    [modelId, models],
  );

  return {
    projects,
    models,
    versions,
    projectId,
    modelId,
    project,
    model,
    busy,
    error,
    setError,
    selectProject,
    selectModel,
    refreshProjects,
    refreshVersions,
    addProject,
    addModel,
  };
}
