import { AsyncLocalStorage } from "node:async_hooks";
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
 *
 * Transaktionen: Es gibt genau EINE Verbindung. Damit parallele Requests
 * nicht in eine fremde offene Transaktion hineinschreiben, serialisiert ein
 * Mutex die Transaktionen, und einfache Queries warten, solange eine fremde
 * Transaktion offen ist. Der eigene Transaktions-Kontext wird per
 * AsyncLocalStorage erkannt (verschachtelte Aufrufe treten der äußeren
 * Transaktion bei).
 */
export class SqliteClient implements SqlClient {
  private readonly db: DatabaseSync;
  private readonly txContext = new AsyncLocalStorage<true>();
  /** Kette der wartenden Transaktionen (Mutex) — zeigt auf das Ende. */
  private txTail: Promise<void> = Promise.resolve();
  /** Auflösung der aktuell OFFENEN Transaktion (null = keine offen). */
  private openTx: Promise<void> | null = null;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = WAL;");
    this.db.exec("pragma foreign_keys = ON;");
  }

  private run<T>(text: string, params: unknown[]): { rows: T[] } {
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

  async query<T = unknown>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    // Fremde offene Transaktion nicht kontaminieren: warten, bis sie zu ist.
    while (this.openTx && !this.txContext.getStore()) {
      await this.openTx;
    }
    return this.run<T>(text, params);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txContext.getStore()) {
      // Verschachtelt: in der äußeren Transaktion weiterlaufen.
      return fn();
    }
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.txTail;
    this.txTail = previous.then(() => turn);
    await previous;
    this.openTx = turn;
    try {
      return await this.txContext.run(true, async () => {
        this.db.exec("begin immediate");
        try {
          const result = await fn();
          this.db.exec("commit");
          return result;
        } catch (error) {
          try {
            this.db.exec("rollback");
          } catch {
            // Rollback-Fehler nicht über den eigentlichen Fehler stellen.
          }
          throw error;
        }
      });
    } finally {
      this.openTx = null;
      release();
    }
  }

  async end(): Promise<void> {
    this.db.close();
  }
}
