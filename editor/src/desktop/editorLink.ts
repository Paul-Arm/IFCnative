/**
 * Editor-Links "ifcnative://open?…": der IFC Hub (auch eingebettet in
 * OpenProject) öffnet damit ein Modell direkt im Desktop-Editor.
 *
 *   ifcnative://open?hub=<Hub-URL>&project=<Slug>&model=<Slug>
 *                    [&branch=<Name>][&commit=<Id>]
 *
 * Ohne commit wird der aktuelle Stand des Branches geladen, ohne branch der
 * Standard-Branch des Modells. Das Format erzeugt der Hub in
 * server/web/app/composables/useEditorLink.ts.
 *
 * Der Link kommt von einer Webseite und ist damit nicht vertrauenswürdig:
 * hier wird nur geprüft, dass er wohlgeformt ist. Der Editor schickt seine
 * Anmeldung nur an den eingestellten Hub; verweist ein Link auf einen
 * anderen, muss der Benutzer den Wechsel bestätigen und sich neu anmelden.
 */

export const EDITOR_LINK_SCHEME = "ifcnative";

/** Windows übergibt den Link als Kommandozeilenargument; mehr ist verdächtig. */
export const EDITOR_LINK_MAX_LENGTH = 2048;

export interface EditorOpenRequest {
  /** Basis-URL des Hubs ohne abschließenden Schrägstrich. */
  hub: string;
  project: string;
  model: string;
  branch: string | null;
  commit: string | null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Wie BRANCH_NAME im Hub (server/src/http/app.ts).
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
const COMMIT = /^[0-9a-fA-F-]{8,64}$/;

/** Hub-Basis-URL vergleichbar machen ("http://x:8787/" == "http://x:8787"). */
export function normalizeHubUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Prüft einen Editor-Link; null bei allem, was nicht exakt passt. */
export function parseEditorLink(value: string): EditorOpenRequest | null {
  if (value.length > EDITOR_LINK_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Manche Browser hängen "/" an: ifcnative://open/?…
  if (url.protocol !== `${EDITOR_LINK_SCHEME}:` || url.host !== "open") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.username || url.password || url.hash) return null;

  const params = url.searchParams;
  const hub = normalizeHubUrl(params.get("hub") ?? "");
  const project = params.get("project") ?? "";
  const model = params.get("model") ?? "";
  const branch = params.get("branch");
  const commit = params.get("commit");
  if (!hub || !SLUG.test(project) || !SLUG.test(model)) return null;
  if (branch !== null && !BRANCH.test(branch)) return null;
  if (commit !== null && !COMMIT.test(commit)) return null;
  return { hub, project, model, branch, commit };
}

/** Link aus der Kommandozeile des Editors (Start über das URL-Protokoll). */
export async function readDesktopStartupEditorLink(): Promise<EditorOpenRequest | null> {
  if (!("__TAURI_INTERNALS__" in globalThis)) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const link = await invoke<string | null>("startup_editor_link");
  return link ? parseEditorLink(link) : null;
}
