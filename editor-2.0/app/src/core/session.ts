/**
 * Modell-Sitzung: kapselt Parser, Mutations-Overlay und STEP-Export von ifc-lite.
 * Eine Sitzung pro geöffnetem Dokument (Multi-Tab kommt in M1).
 */
import {
  IfcParser,
  extractPropertiesOnDemand,
  type IfcDataStore,
} from "@ifc-lite/parser";
import { MutablePropertyView } from "@ifc-lite/mutations";
import { StepExporter } from "@ifc-lite/export";
import { PropertyValueType } from "@ifc-lite/data";
import { buildSpatialTree, type SpatialTreeNode } from "./model/spatial";
import { relationsOf, type RelationRow } from "./model/relations";
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

export class ModelSession {
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

  setProperty(
    expressId: number,
    pset: string,
    prop: string,
    value: string,
  ): void {
    this.view.setProperty(expressId, pset, prop, value, PropertyValueType.Label);
  }

  get changeCount(): number {
    return this.view.getMutations().length;
  }

  // — Lese-APIs für Panes (M1). Teure Ergebnisse werden pro Sitzung gecacht. —

  private spatialTreeCache: SpatialTreeNode | null | undefined;

  spatialTree(): SpatialTreeNode | null {
    if (this.spatialTreeCache === undefined) {
      this.spatialTreeCache = buildSpatialTree(this.store);
    }
    return this.spatialTreeCache;
  }

  identityOf(expressId: number): EntityIdentity {
    return identityOf(this.store, expressId);
  }

  quantitiesOf(expressId: number): QuantityView[] {
    return quantitiesOf(this.store, expressId);
  }

  relationsOf(expressId: number): RelationRow[] {
    return relationsOf(this.store, expressId);
  }

  labelOf(expressId: number): string {
    return entityLabel(this.store, expressId);
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
