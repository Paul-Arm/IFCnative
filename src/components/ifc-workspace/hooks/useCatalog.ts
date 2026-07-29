import { useMemo, useState } from "react";

import {
  findCatalogObject,
  suggestCatalogObjectForEntity,
  validateEntityAgainstCatalogObject,
  type CatalogKind,
  type IfcObjectCatalog,
  type NativeIfcDocument,
} from "@/ifc";

import { pickCatalogFile } from "../lib/filePickers";

/**
 * Objektkatalog-Zustand: importierte Excel-Kataloge, das aktive
 * Katalog-Objekt (explizite Auswahl oder Vorschlag zur Selektion) und die
 * Validierungs-Findings für das aktuell gewählte Element.
 */
export function useCatalog(options: {
  document: NativeIfcDocument;
  selectedId: number;
  logAction: (code: string) => void;
  /** Öffnet nach erfolgreichem Import die Katalog-Fenster im Layout. */
  onCatalogImported: () => void;
}) {
  const { document, selectedId, logAction, onCatalogImported } = options;
  const [catalog, setCatalog] = useState<IfcObjectCatalog | null>(null);
  const [catalogKind, setCatalogKind] = useState<CatalogKind>("diagnostik");
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [selectedCatalogObjectId, setSelectedCatalogObjectId] = useState("");

  const suggestedCatalogObject = useMemo(
    () =>
      catalog
        ? suggestCatalogObjectForEntity(document, selectedId, catalog.objectTypes)
        : undefined,
    [catalog, selectedId, document],
  );
  const activeCatalogObjectId =
    selectedCatalogObjectId ||
    suggestedCatalogObject?.id ||
    catalog?.objectTypes[0]?.id ||
    "";
  const activeCatalogObject =
    findCatalogObject(catalog, activeCatalogObjectId) ?? suggestedCatalogObject;
  const catalogFindings = useMemo(
    () =>
      activeCatalogObject
        ? validateEntityAgainstCatalogObject(
            document,
            selectedId,
            activeCatalogObject,
          )
        : [],
    [activeCatalogObject, selectedId, document],
  );

  const importCatalog = async () => {
    try {
      const asset = await pickCatalogFile();
      if (!asset) {
        return;
      }
      setCatalogImporting(true);
      logAction(
        `ui.importCatalog.start({ file: '${asset.name}', kind: '${catalogKind}' });`,
      );
      const { parseCatalogWorkbook } = await import("@/ifc/catalogExcel");
      const parsed = parseCatalogWorkbook(
        await asset.file.arrayBuffer(),
        asset.name,
        catalogKind,
      );
      setCatalogKind(parsed.kind);
      const suggested = suggestCatalogObjectForEntity(
        document,
        selectedId,
        parsed.objectTypes,
      );
      setCatalog(parsed);
      setSelectedCatalogObjectId(
        suggested?.id ?? parsed.objectTypes[0]?.id ?? "",
      );
      onCatalogImported();
      logAction(
        `ui.importCatalog({ file: '${asset.name}', kind: '${parsed.kind}', classes: ${parsed.objectTypes.length} });`,
      );
    } catch (error) {
      logAction(`ui.error(${JSON.stringify(String(error))});`);
    } finally {
      setCatalogImporting(false);
    }
  };

  return {
    activeCatalogObject,
    activeCatalogObjectId,
    catalog,
    catalogFindings,
    catalogImporting,
    catalogKind,
    importCatalog,
    setCatalogKind,
    setSelectedCatalogObjectId,
  };
}
