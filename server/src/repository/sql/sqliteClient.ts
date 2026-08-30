import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { SqlClient } from "./sqlClient";

/**
 * SqlClient auf Basis des eingebauten node:sqlite (Node >= 22.13) — die
 * Standard-Metadaten-DB im lokalen Modus (DATA_DIR/catalog.sqlite).
 *
 * Die SqlRepository-Queries sind in Postgres-Syntax geschrieben; hier wird
 * minimal übersetzt:
 * - "$N"-Platzhalter -> "?N" (nummerierte SQLite-Parameter, wiederverwendbar)
 * - "::jsonb"-Casts entfernt (Summary wird als TEXT gespeichert)
 */
export class SqliteClient implements SqlClient {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = WAL;");
    this.db.exec("pragma foreign_keys = ON;");
  }

  async query<T = unknown>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const sql = text
      .replace(/::jsonb/g, "")
      .replace(/\$(\d+)/g, "?$1");
    const values = params.map((value) =>
      value === undefined ? null : value,
    ) as (string | number | null)[];
    const statement = this.db.prepare(sql);
    if (/^\s*select/i.test(sql) || /returning/i.test(sql)) {
      return { rows: statement.all(...values) as T[] };
    }
    statement.run(...values);
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.db.close();
  }
}
