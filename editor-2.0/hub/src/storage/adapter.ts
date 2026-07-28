/**
 * Persistenz-Adapter des Hubs.
 *
 * Die Katalogschicht (`HubService`) kennt nur dieses Interface. Aktuell gibt es
 * genau eine Implementierung (`FilesystemStore`); der zentrale Team-Betrieb
 * ersetzt sie später durch Postgres + S3, ohne dass der Service sich ändert.
 *
 * Zwei getrennte Verantwortlichkeiten:
 *  - **Katalog** (Projekte/Modelle/Versionen) — klein, wird komplett gelesen
 *    und atomar geschrieben; Änderungen laufen über `transaction()`.
 *  - **Blobs** — content-addressed über sha256; unveränderlich und dedupliziert.
 */
import type { Catalog } from "../types.js";

export interface CatalogStore {
  /** Legt Verzeichnisse/Tabellen an, falls sie fehlen. Idempotent. */
  init(): Promise<void>;

  /** Momentaufnahme des Katalogs (nur lesen). */
  read(): Promise<Catalog>;

  /**
   * Serialisierter Lesen-Ändern-Schreiben-Zyklus. Die Rückgabe von `mutate`
   * wird durchgereicht; der Katalog wird nur geschrieben, wenn `mutate`
   * ohne Fehler zurückkehrt. Gleichzeitige Aufrufe laufen nacheinander.
   */
  transaction<T>(mutate: (catalog: Catalog) => Promise<T> | T): Promise<T>;

  /**
   * Legt einen Blob unter seinem Hash ab. Rückgabe `true`, wenn er neu
   * geschrieben wurde, `false`, wenn er bereits vorhanden war (Dedup).
   */
  putBlob(hash: string, bytes: Uint8Array): Promise<boolean>;

  /** Liest einen Blob. Wirft, wenn er fehlt. */
  getBlob(hash: string): Promise<Uint8Array>;

  /** Prüft, ob ein Blob vorliegt — Basis für späteres Push/Pull. */
  hasBlob(hash: string): Promise<boolean>;
}
