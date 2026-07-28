/**
 * Store-Adapter für `@ifc-lite/diff`.
 *
 * `@ifc-lite/diff` ist bewusst store-agnostisch: es vergleicht nur
 * `EntityFingerprint`s und weiß nichts über IFC-Dateien. Diese Datei ist der
 * fehlende Adapter — sie zieht aus dem kolumnaren Parser-Store die Identität
 * (GlobalId) und die Datensignale (Attribute, Psets, Qsets) jeder Entity und
 * hasht sie mit den Kanon-Funktionen des Pakets.
 *
 * Vergleichseinheit ist die GlobalId: `getGlobalIdMap()` liefert genau die
 * Entities mit stabiler Identität (IfcRoot-Abkömmlinge). Geometrie-,
 * Placement- und Profil-Records haben keine GlobalId und fallen heraus — sie
 * sind ohnehin nur Träger der Geometrie, deren Vergleich einen WASM-Mesh-Pass
 * bräuchte, den der Hub nicht fährt.
 */
import {
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  type IfcDataStore,
} from "@ifc-lite/parser";
import {
  buildComponentFingerprints,
  buildDataFingerprint,
  type DataFingerprintInput,
  type EntityFingerprint,
} from "@ifc-lite/diff";

/** Was der Hub zusätzlich zur GlobalId über eine Entity ausliefert. */
export interface EntityRef {
  /** Nur innerhalb des Standes gültig — reine Anzeigeinformation. */
  expressId: number;
  /** Anzeigename, z. B. `IfcWall · Wand A`. */
  label: string;
}

function labelOf(store: IfcDataStore, expressId: number): string {
  const ifcType = store.entities.getTypeName(expressId);
  const name = store.entities.getName(expressId);
  return name ? `${ifcType} · ${name}` : ifcType;
}

function fingerprintInput(
  store: IfcDataStore,
  expressId: number,
): DataFingerprintInput {
  const input: DataFingerprintInput = {
    ifcType: store.entities.getTypeName(expressId),
    name: store.entities.getName(expressId),
    description: store.entities.getDescription(expressId),
    objectType: store.entities.getObjectType(expressId),
    propertySets: extractPropertiesOnDemand(store, expressId).map((pset) => ({
      name: pset.name,
      properties: pset.properties.map((property) => ({
        name: property.name,
        value: property.value,
      })),
    })),
    quantitySets: extractQuantitiesOnDemand(store, expressId).map((qset) => ({
      name: qset.name,
      quantities: qset.quantities.map((quantity) => ({
        name: quantity.name,
        value: quantity.value,
      })),
    })),
  };
  // `getPredefinedType` liefert nur der Server-Parse-Pfad; im lokalen Parse
  // fehlt die Methode, deshalb der Zugriff über die optionale Signatur.
  const predefinedType = store.entities.getPredefinedType?.(expressId);
  if (predefinedType) input.predefinedType = predefinedType;
  return input;
}

/**
 * Baut die Fingerabdrücke aller identitätstragenden Entities eines Standes.
 *
 * Neben dem Gesamt-`dataHash` werden die Teil-Hashes je Komponente
 * (`attr:core`, `pset:<Name>`, `qset:<Name>`, `type-assignment`) mitgegeben.
 * Nur wenn beide Seiten sie führen, meldet der Diff später
 * `changedComponents` — das ist die feinste Detailtiefe, die `@ifc-lite/diff`
 * hergibt.
 */
export function buildFingerprints(
  store: IfcDataStore,
): EntityFingerprint<EntityRef>[] {
  const fingerprints: EntityFingerprint<EntityRef>[] = [];
  for (const [globalId, expressId] of store.entities.getGlobalIdMap()) {
    const input = fingerprintInput(store, expressId);
    fingerprints.push({
      key: globalId,
      ifcType: input.ifcType,
      dataHash: buildDataFingerprint(input),
      components: buildComponentFingerprints(input),
      ref: { expressId, label: labelOf(store, expressId) },
    });
  }
  return fingerprints;
}
