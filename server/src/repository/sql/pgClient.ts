import pg from "pg";

import type { SqlClient } from "./sqlClient";

export interface PgClient extends SqlClient {
  close(): Promise<void>;
}

/** Production SqlClient backed by a node-postgres connection pool. */
export function createPgClient(connectionString: string): PgClient {
  const pool = new pg.Pool({ connectionString });
  return {
    async query(text, params) {
      const result = await pool.query(text, params as unknown[]);
      return { rows: result.rows };
    },
    close: () => pool.end(),
  };
}
