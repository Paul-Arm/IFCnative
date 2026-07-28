/**
 * Katalog-Zustand der Objektkatalog-Pane.
 *
 * Der Katalog gilt pro App (nicht pro Dokument): einmal importiert, steht er
 * für jedes geöffnete Modell zur Verfügung. Die Rohbytes der Arbeitsmappe
 * bleiben erhalten, damit die Variante (Diagnostik/Monitoring) ohne erneutes
 * Öffnen der Datei umgeschaltet werden kann.
 */
import { create } from "zustand";

import { parseCatalogWorkbook } from "../../domain/catalog/excel";
import type { CatalogKind, IfcObjectCatalog } from "../../domain/catalog/model";

interface CatalogState {
  catalog: IfcObjectCatalog | null;
  /** Rohbytes der zuletzt importierten Mappe (für den Varianten-Umschalter). */
  workbook: ArrayBuffer | null;
  /** Vom Benutzer erzwungene Variante; null = Auto-Erkennung. */
  kindOverride: CatalogKind | null;
  selectedId: string | null;
  search: string;
  busy: boolean;
  error: string | null;

  importWorkbook(file: File): Promise<void>;
  setKind(kind: CatalogKind): void;
  select(id: string | null): void;
  setSearch(search: string): void;
  clear(): void;
}

export const useCatalog = create<CatalogState>((set, get) => ({
  catalog: null,
  workbook: null,
  kindOverride: null,
  selectedId: null,
  search: "",
  busy: false,
  error: null,

  async importWorkbook(file) {
    set({ busy: true, error: null });
    try {
      const buffer = await file.arrayBuffer();
      const catalog = parseCatalogWorkbook(buffer, file.name);
      set({
        busy: false,
        catalog,
        kindOverride: null,
        search: "",
        selectedId: catalog.objectTypes[0]?.id ?? null,
        workbook: buffer,
      });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setKind(kind) {
    const { workbook, catalog } = get();
    if (!workbook || !catalog || catalog.kind === kind) return;
    try {
      const next = parseCatalogWorkbook(workbook, catalog.fileName, kind);
      set({
        catalog: next,
        error: null,
        kindOverride: kind,
        selectedId: next.objectTypes[0]?.id ?? null,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  select(id) {
    set({ selectedId: id });
  },

  setSearch(search) {
    set({ search });
  },

  clear() {
    set({
      catalog: null,
      error: null,
      kindOverride: null,
      search: "",
      selectedId: null,
      workbook: null,
    });
  },
}));
