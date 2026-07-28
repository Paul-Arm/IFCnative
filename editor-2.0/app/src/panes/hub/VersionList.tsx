/**
 * Ständeliste eines Modells mit Meta-Angaben. Die Ankreuzfelder wählen die
 * zwei Stände für den Vergleich; der aktuellste Stand steht oben, sofern der
 * Hub Zeitstempel liefert.
 */
import { useMemo } from "react";

import type { HubVersion } from "../../domain/hub/types";
import { formatBytes, formatCount, formatDate, versionLabel } from "./format";

export interface VersionListProps {
  versions: readonly HubVersion[];
  /** Ids der für den Vergleich angekreuzten Stände (höchstens zwei). */
  compare: readonly string[];
  emptyText: string;
  onToggleCompare(id: string): void;
  onOpen(version: HubVersion): void;
}

export default function VersionList({
  versions,
  compare,
  emptyText,
  onToggleCompare,
  onOpen,
}: VersionListProps) {
  const sorted = useMemo(
    () =>
      [...versions].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          0,
      ),
    [versions],
  );

  if (sorted.length === 0) {
    return (
      <p className="empty-state" style={{ margin: 4 }}>
        {emptyText}
      </p>
    );
  }

  return (
    <table className="kv-table table-hover">
      <thead>
        <tr>
          <th style={{ width: 24 }} title="Für den Vergleich wählen">
            ⇄
          </th>
          <th>Stand</th>
          <th>Erstellt</th>
          <th>Schema</th>
          <th>Objekte</th>
          <th>Größe</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {sorted.map((version) => {
          const checked = compare.includes(version.id);
          return (
            <tr
              key={version.id}
              style={checked ? { background: "var(--accent-10)" } : undefined}
            >
              <td>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCompare(version.id)}
                  title="Diesen Stand für den Vergleich wählen (zwei nötig)"
                />
              </td>
              <td>
                <div>{versionLabel(version)}</div>
                <div className="text-dim" style={{ fontSize: "0.75rem" }}>
                  {version.author || "ohne Autor"}
                  {version.blobHash ? ` · ${version.blobHash.slice(0, 8)}` : ""}
                </div>
              </td>
              <td className="dim mono">{formatDate(version.createdAt)}</td>
              <td className="dim">{version.schema || "—"}</td>
              <td className="dim mono">{formatCount(version.entityCount)}</td>
              <td className="dim mono">{formatBytes(version.byteSize)}</td>
              <td>
                <span className="row-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => onOpen(version)}
                    title="Diesen Stand als neuen Tab öffnen"
                    type="button"
                  >
                    Öffnen
                  </button>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
