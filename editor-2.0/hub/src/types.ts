/**
 * Datenmodell des IFC-Hub-Katalogs: Projekte → Modelle → Versionsstände.
 *
 * Ein Versionsstand verweist über `blobHash` (sha256, hex) auf den
 * content-addressed IFC-Blob. Zwei Stände mit identischen Bytes teilen sich
 * denselben Blob — der Katalog ist damit die einzige Stelle mit Historie.
 *
 * Die Feldnamen entsprechen exakt dem Vertrag, den die App in
 * `app/src/domain/hub/types.ts` erwartet.
 */

/** Metadaten eines Versionsstands (Antwortform von POST/GET .../versions). */
export interface VersionMeta {
  id: string;
  message: string;
  author: string;
  /** ISO-8601-Zeitstempel in UTC. */
  createdAt: string;
  /** IFC-Schemaversion laut Parser, z. B. `IFC4`. */
  schema: string;
  entityCount: number;
  byteSize: number;
  /** sha256 des IFC-Blobs, hex-kodiert. */
  blobHash: string;
}

/** Ein Modell mit seiner Versionshistorie (Speicherform). */
export interface ModelEntry {
  id: string;
  name: string;
  createdAt: string;
  /** Älteste zuerst — die API dreht die Reihenfolge für die Auslieferung. */
  versions: VersionMeta[];
}

/** Ein Projekt mit seinen Modellen (Speicherform). */
export interface ProjectEntry {
  id: string;
  name: string;
  createdAt: string;
  models: ModelEntry[];
}

/** Gesamter Katalog — der Inhalt von `catalog.json`. */
export interface Catalog {
  /** Format-Version der Katalogdatei, für spätere Migrationen. */
  catalogVersion: 1;
  projects: ProjectEntry[];
}

/** Projekt ohne verschachtelte Modelle (Antwortform der API). */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  modelCount: number;
}

/** Modell ohne verschachtelte Stände (Antwortform der API). */
export interface ModelSummary {
  id: string;
  name: string;
  createdAt: string;
  versionCount: number;
}

export function emptyCatalog(): Catalog {
  return { catalogVersion: 1, projects: [] };
}
