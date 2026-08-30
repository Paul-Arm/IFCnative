/**
 * Minimal SQL client surface that both the production `pg` Pool and the
 * PGlite-backed test client satisfy. Keeps SqlRepository driver-agnostic.
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;

  /**
   * Führt `fn` atomar aus: BEGIN vor dem Aufruf, COMMIT danach, ROLLBACK
   * bei einem Fehler. Alle `query`-Aufrufe innerhalb von `fn` laufen in der
   * Transaktion. Verschachtelte `transaction`-Aufrufe (gleicher async-Fluss)
   * treten der äußeren Transaktion bei statt eine neue zu öffnen.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
