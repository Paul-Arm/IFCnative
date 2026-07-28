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
    const source = this.entitySourceLine(expressId);
    // IfcRoot: GlobalId, OwnerHistory, Name, ... → drittes Argument ist der Name
    const m = source?.match(/^[^(]*\((?:'[^']*'|[^,])*,(?:[^,]*),\s*'([^']*)'/);
    return m?.[1] ?? "";
  }

  private entitySourceLine(expressId: number): string | null {
    const idx = this.store.entityIndex.byId;
    const range = (idx as { get?: (id: number) => unknown }).get?.(expressId);
    if (!range || typeof range !== "object") return null;
    const r = range as { start?: number; end?: number };
    if (r.start === undefined || r.end === undefined) return null;
    return new TextDecoder().decode(this.store.source.slice(r.start, r.end));
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

  exportStep(): Uint8Array {
    const exporter = new StepExporter(this.store, this.view);
    const schema = (this.store.schemaVersion ?? "IFC4") as
      | "IFC2X3"
      | "IFC4"
      | "IFC4X3";
    return exporter.export({ schema, applyMutations: true }).content;
  }
}
