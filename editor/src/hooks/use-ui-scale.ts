import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ifcnative:ui-scale:v1";

/** Prozentwerte relativ zur Browser-Standardgröße (rem-basiert). */
export const UI_SCALE_OPTIONS = [70, 80, 90, 100, 110, 125] as const;
export type UiScale = (typeof UI_SCALE_OPTIONS)[number];

const DEFAULT_SCALE: UiScale = 100;

let currentScale: UiScale = readStoredScale();
const listeners = new Set<() => void>();

function readStoredScale(): UiScale {
  try {
    const raw = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    if ((UI_SCALE_OPTIONS as readonly number[]).includes(raw)) {
      return raw as UiScale;
    }
  } catch {
    // localStorage nicht verfügbar
  }
  return DEFAULT_SCALE;
}

function applyScaleToDocument(doc: Document = globalThis.document) {
  // rem-Basis skalieren: alle Tailwind-Größen (text-*, size-*, h-*, …) folgen.
  doc.documentElement.style.fontSize =
    currentScale === 100 ? "" : `${currentScale}%`;
}

function setScaleValue(next: UiScale) {
  currentScale = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(next));
  } catch {
    // ignore
  }
  applyScaleToDocument();
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Einmalig beim Start anwenden (vor dem ersten Paint). */
export function initUiScale() {
  applyScaleToDocument();
}

export function useUiScale() {
  const scale = useSyncExternalStore(
    subscribe,
    () => currentScale,
    () => currentScale,
  );

  const setScale = useCallback((next: UiScale) => {
    setScaleValue(next);
  }, []);

  return { scale, setScale };
}
