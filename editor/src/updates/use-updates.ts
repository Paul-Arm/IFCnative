import { useEffect, useSyncExternalStore } from "react";
import { editorUpdates } from "./client";

export function useUpdates() {
  return useSyncExternalStore(
    editorUpdates.subscribe,
    editorUpdates.getSnapshot,
  );
}

/** Mount once per window: first check 15 s after start, then throttled ticks. */
export function useUpdateScheduler() {
  useEffect(() => {
    void editorUpdates.initialize();
    const first = window.setTimeout(() => {
      void editorUpdates.tick();
    }, 15_000);
    const timer = window.setInterval(() => {
      void editorUpdates.tick();
    }, 60_000);
    const onFocus = () => {
      void editorUpdates.tick();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
