/**
 * Links "Im Editor öffnen": ifcnative://open?… startet den IFCnative-
 * Desktop-Editor (ab 1.5.0; der Installer registriert das Protokoll) und
 * lädt dort das Modell — ohne Commit den aktuellen Stand des Branches, ohne
 * Branch den Standard-Branch. Der Editor prüft den Link und schickt seine
 * Anmeldung nur an den eingestellten Hub
 * (editor/src/desktop/editorLink.ts).
 */

export interface EditorLinkTarget {
  project: string;
  model: string;
  branch?: string | null;
  commit?: string | null;
}

/** Basis-URL dieses Hubs, wie der Editor sie in den Einstellungen hat. */
function hubBaseUrl(): string {
  const base = useRuntimeConfig().app.baseURL.replace(/\/+$/, "");
  return `${window.location.origin}${base}`;
}

export function useEditorLink() {
  return (target: EditorLinkTarget): string => {
    const params = new URLSearchParams({
      hub: hubBaseUrl(),
      project: target.project,
      model: target.model,
    });
    if (target.branch) params.set("branch", target.branch);
    if (target.commit) params.set("commit", target.commit);
    return `ifcnative://open?${params}`;
  };
}

/** Tooltip der Links — erklärt, was ohne installierten Editor passiert. */
export const EDITOR_LINK_TITLE =
  "Im IFCnative-Editor öffnen (Desktop-App ab Version 1.5.0). Ohne installierten Editor passiert nichts.";
