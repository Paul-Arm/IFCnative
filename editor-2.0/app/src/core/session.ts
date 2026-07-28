/**
 * Modell-Sitzung: kapselt Parser, Mutations-Overlay und STEP-Export von ifc-lite.
 * Eine Sitzung pro geöffnetem Dokument (Multi-Tab kommt in M1).
 */
import {
  IfcParser,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  normalizeIfcTypeName,
  type IfcDataStore,
} from "@ifc-lite/parser";
import {
  MutablePropertyView,
  StoreEditor,
  setEntityTypeNormalizer,
  type MutationStoreShape,
} from "@ifc-lite/mutations";
import { StepExporter } from "@ifc-lite/export";
import { buildSpatialTree, type SpatialTreeNode } from "./model/spatial";
import { relationsOf, type RelationRow } from "./model/relations";
import { RelationOverlay } from "./model/relationOverlay";
import {
  entityLabel,
  identityOf,
  quantitiesOf,
  type EntityIdentity,
  type QuantityView,
} from "./model/attributes";

export interface ModelInfo {
  fileName: string;
  schema: string;
  entityCount: number;
  parseTimeMs: number;
  typeCounts: Array<{ type: string; count: number }>;
}

export interface PsetView {
  name: string;
  properties: Array<{ name: string; value: string }>;
}

export interface EntityRow {
  expressId: number;
  type: string;
  name: string;
}

// Der StoreEditor validiert neue Entity-Klassen gegen die Schema-Registry,
// sobald ihm der Normalizer des Parsers bekannt ist (einmal pro Prozess).
setEntityTypeNormalizer(normalizeIfcTypeName);

export class ModelSession {
  /** Sitzungs-Overlay für Beziehungen (der CSR des Parsers ist statisch). */
  readonly relationOverlay = new RelationOverlay();

  private constructor(
    readonly fileName: string,
    readonly store: IfcDataStore,
    readonly view: MutablePropertyView,
  ) {}

  static async open(
    fileName: string,
    buffer: ArrayBuffer,
    onProgress?: (percent: number, phase: string) => void,
  ): Promise<ModelSession> {
    const parser = new IfcParser();
    const store = await parser.parseColumnar(buffer, {
      onProgress: ({ phase, percent }: { phase: string; percent: number }) =>
        onProgress?.(percent, phase),
    });
    const view = new MutablePropertyView(store.properties, fileName);
    // Befund B1 (tests/m2-editierkern.test.ts): parseColumnar füllt die
    // Property-/Quantity-Tabellen absichtlich NICHT — ohne diese Verdrahtung
    // liefert getPropertyValue() für geparste Werte null, Undo löscht statt
    // wiederherzustellen, und der Export verliert beim Ändern einer Property
    // die übrigen Properties desselben Psets.
    view.setOnDemandExtractor((entityId: number) =>
      extractPropertiesOnDemand(store, entityId),
    );
    view.setQuantityExtractor((entityId: number) =>
      extractQuantitiesOnDemand(store, entityId),
    );
    return new ModelSession(fileName, store, view);
  }

  info(): ModelInfo {
    const typeCounts = [...this.store.entityIndex.byType.entries()]
      .map(([type, ids]) => ({ type, count: ids.length }))
      .sort((a, b) => b.count - a.count);
    return {
      fileName: this.fileName,
      schema: this.store.schemaVersion ?? "unbekannt",
      entityCount: this.store.entityCount,
      parseTimeMs: Math.round(this.store.parseTime),
      typeCounts,
    };
  }

  entitiesOfType(type: string, limit = 200): EntityRow[] {
    const ids = this.store.entityIndex.byType.get(type) ?? [];
    return ids.slice(0, limit).map((expressId) => ({
      expressId,
      type,
      name: this.entityName(expressId),
    }));
  }

  private entityName(expressId: number): string {
    return this.store.entities.getName(expressId);
  }

  psetsOf(expressId: number): PsetView[] {
    return extractPropertiesOnDemand(this.store, expressId).map((pset) => ({
      name: pset.name,
      properties: pset.properties.map((p) => ({
        name: p.name,
        value: this.currentValue(expressId, pset.name, p.name, p.value),
      })),
    }));
  }

  private currentValue(
    expressId: number,
    pset: string,
    prop: string,
    parsed: unknown,
  ): string {
    const overlay = this.view.getPropertyValue(expressId, pset, prop);
    const value = overlay ?? parsed;
    return value === null || value === undefined ? "" : String(value);
  }

  // Review-Befund 13: `setProperty` ist ersatzlos entfallen — es umging die
  // Command-Pipeline (kein Undo, kein Audit-Eintrag) und hatte keinen
  // Aufrufer mehr. Der einzige Schreibweg ist `cmdSetProperty`.

  get changeCount(): number {
    return this.view.getMutations().length;
  }

  // — Lese-APIs für Panes (M1). Teure Ergebnisse werden pro Sitzung gecacht. —

  private spatialTreeCache: SpatialTreeNode | null | undefined;
  private spatialTreeKey = "";
  /** Wird von strukturellen Commands hochgezählt (siehe invalidateSpatialTree). */
  private structureRev = 0;

  /**
   * Räumlicher Baum inklusive Overlay-Beziehungen und Tombstones
   * (Review-Befund 2). Der Cache hängt an einem Schlüssel aus
   * Beziehungs-Revision, Tombstone-Zahl und dem expliziten Struktur-Zähler —
   * ohne den zeigte der Strukturbaum strukturelle Edits nie.
   */
  spatialTree(): SpatialTreeNode | null {
    const key = `${this.relationOverlay.revision}:${this.view.getTombstones().size}:${this.structureRev}`;
    if (this.spatialTreeCache === undefined || this.spatialTreeKey !== key) {
      this.spatialTreeCache = buildSpatialTree(this.store, {
        overlay: this.relationOverlay,
        isDeleted: (id) => this.view.isDeleted(id),
      });
      this.spatialTreeKey = key;
    }
    return this.spatialTreeCache;
  }

  /** Cache des Strukturbaums verwerfen (Commands rufen das in run/undo/redo). */
  invalidateSpatialTree(): void {
    this.structureRev++;
    this.spatialTreeCache = undefined;
  }

  identityOf(expressId: number): EntityIdentity {
    return identityOf(this.store, expressId);
  }

  quantitiesOf(expressId: number): QuantityView[] {
    return quantitiesOf(this.store, expressId);
  }

  relationsOf(expressId: number): RelationRow[] {
    // Befund 4b: Zeilen zu tombstoneten Gegenstellen fallen zentral hier heraus.
    return relationsOf(this.store, expressId, this.relationOverlay, (id) =>
      this.view.isDeleted(id),
    );
  }

  labelOf(expressId: number): string {
    return entityLabel(this.store, expressId);
  }

  // — Schreib-APIs (M2) —

  private editorCache: StoreEditor | null = null;

  /**
   * Gecachter StoreEditor für strukturelle Änderungen (neue Entities,
   * Beziehungen, Löschungen). Der Konstruktor setzt die expressId-Wasserlinie
   * im Overlay — deshalb genau eine Instanz pro Sitzung.
   */
  editor(): StoreEditor {
    if (!this.editorCache) {
      this.editorCache = new StoreEditor(
        this.store as unknown as MutationStoreShape,
        this.view,
      );
    }
    return this.editorCache;
  }

  /** Sichtbar gelöscht (Tombstone im Mutations-Overlay)? */
  isDeleted(expressId: number): boolean {
    return this.view.isDeleted(expressId);
  }

  /** Zähler für Cache-Invalidierung in den Panes. */
  get relationRevision(): number {
    return this.relationOverlay.revision;
  }

  exportStep(): Uint8Array {
    const exporter = new StepExporter(this.store, this.view);
    const schema = (this.store.schemaVersion ?? "IFC4") as
      | "IFC2X3"
      | "IFC4"
      | "IFC4X3";
    return exporter.export({ schema, applyMutations: true }).content;
  }
}
