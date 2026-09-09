import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { WorkspaceDocumentSession } from "./documentTransaction";

/** Dispatches against the latest committed state, including several edits in one event. */
export function useDocumentSessions(initial: WorkspaceDocumentSession) {
  const [sessions, setState] = useState([initial]);
  const current = useRef(sessions);
  const setSessions = useCallback((action: SetStateAction<WorkspaceDocumentSession[]>) => {
    const next = typeof action === "function" ? action(current.current) : action;
    current.current = next;
    setState(next);
  }, []);
  return [sessions, setSessions] as const;
}
