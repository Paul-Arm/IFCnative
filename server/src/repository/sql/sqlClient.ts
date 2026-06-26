/**
 * Minimal SQL client surface that both the production `pg` Pool and the
 * PGlite-backed test client satisfy. Keeps SqlRepository driver-agnostic.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
