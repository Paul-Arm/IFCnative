/**
 * Verbindungsleiste: Basis-URL, optionales Token, Autorname und Statuspunkt.
 *
 * Die Felder arbeiten mit einem lokalen Entwurf und melden erst beim Verlassen
 * (oder mit Enter) an die Einstellungen — sonst liefe pro Tastendruck eine
 * neue /api/health-Prüfung.
 */
import { useEffect, useState } from "react";

import { DEFAULT_HUB_URL } from "../../domain/hub/settings";
import type { HubConnectionState } from "./useHubStatus";

const DOT_COLOR: Record<HubConnectionState, string> = {
  unknown: "var(--text-dim)",
  checking: "var(--warn)",
  online: "var(--accent)",
  offline: "var(--error)",
};

const DOT_LABEL: Record<HubConnectionState, string> = {
  unknown: "ungeprüft",
  checking: "prüfe …",
  online: "verbunden",
  offline: "getrennt",
};

export interface ConnectionBarProps {
  baseUrl: string;
  token: string;
  author: string;
  state: HubConnectionState;
  version: string | null;
  onBaseUrl(value: string): void;
  onToken(value: string): void;
  onAuthor(value: string): void;
  onCheck(): void;
}

/** Eingabefeld mit Entwurf; übernimmt bei Blur und Enter. */
function DraftInput({
  value,
  width,
  placeholder,
  title,
  type,
  onCommit,
}: {
  value: string;
  width: number;
  placeholder: string;
  title: string;
  type?: "password";
  onCommit(next: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className="input"
      style={{ width }}
      type={type ?? "text"}
      value={draft}
      placeholder={placeholder}
      title={title}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(value);
      }}
    />
  );
}

export default function ConnectionBar({
  baseUrl,
  token,
  author,
  state,
  version,
  onBaseUrl,
  onToken,
  onAuthor,
  onCheck,
}: ConnectionBarProps) {
  return (
    <div className="pane-toolbar">
      <label className="card-title">Hub</label>
      <DraftInput
        value={baseUrl}
        width={190}
        placeholder={DEFAULT_HUB_URL}
        title={`Basis-URL des Hub-Dienstes (Default ${DEFAULT_HUB_URL})`}
        onCommit={onBaseUrl}
      />
      <DraftInput
        value={token}
        width={110}
        placeholder="Token (optional)"
        title="Optionales Bearer-Token; leer lassen, wenn der Hub ohne Token läuft"
        type="password"
        onCommit={onToken}
      />
      <DraftInput
        value={author}
        width={110}
        placeholder="Autor"
        title="Name, der beim Sichern eines Standes mitgeschickt wird"
        onCommit={onAuthor}
      />
      <button
        className="btn"
        onClick={onCheck}
        disabled={state === "checking"}
        title="Verbindung über /api/health prüfen"
        type="button"
      >
        Verbinden
      </button>
      <span
        aria-label={DOT_LABEL[state]}
        title={DOT_LABEL[state]}
        className="dot"
        style={{ background: DOT_COLOR[state] }}
      />
      <span className="text-dim">
        {state === "online"
          ? `verbunden${version ? ` · Hub ${version}` : ""}`
          : DOT_LABEL[state]}
      </span>
    </div>
  );
}
