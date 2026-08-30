import { AsyncLocalStorage } from "node:async_hooks";

import pg from "pg";

import type { SqlClient } from "./sqlClient";

export interface PgClient extends SqlClient {
  close(): Promise<void>;
}

/**
 * Production SqlClient backed by a node-postgres connection pool.
 *
 * Transaktionen laufen auf einer dedizierten Pool-Verbindung; alle
 * `query`-Aufrufe im selben async-Fluss (AsyncLocalStorage) gehen über diese
 * Verbindung, parallele Requests bekommen wie gewohnt eigene Verbindungen.
 */
export function createPgClient(connectionString: string): PgClient {
  const pool = new pg.Pool({ connectionString });
  const txClient = new AsyncLocalStorage<pg.PoolClient>();

  async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (txClient.getStore()) {
      // Verschachtelt: in der äußeren Transaktion weiterlaufen.
      return fn();
    }
    const client = await pool.connect();
    try {
      return await txClient.run(client, async () => {
        await client.query("begin");
        try {
          const result = await fn();
          await client.query("commit");
          return result;
        } catch (error) {
          try {
            await client.query("rollback");
          } catch {
            // Rollback-Fehler nicht über den eigentlichen Fehler stellen.
          }
          throw error;
        }
      });
    } finally {
      client.release();
    }
  }

  return {
    async query(text, params) {
      const executor = txClient.getStore() ?? pool;
      const result = await executor.query(text, params as unknown[]);
      return { rows: result.rows };
    },
    transaction,
    close: () => pool.end(),
  };
}
