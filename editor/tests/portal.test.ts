import assert from "node:assert/strict";
import test from "node:test";

import {
    createNativeSampleDocument,
    serializeNativeIfcDocument,
    type NativeIfcDocument,
} from "../src/ifc/nativeDocument";
import {
    buildCatalogPsetsForNode,
    deriveUntersuchungsbereichId,
    deriveUntersuchungsstelleId,
    IFC_GUID_ALPHABET,
    ifcGuidForExternalId,
    LINK_PSET_NAME,
    parseKoordinatenText,
    verfahrenSpecForType,
} from "../src/portal/catalogPsets";
import {
    assignPortalLink,
    findEntityIdByExternalId,
    importPortalChildren,
    importPortalStructure,
    type PortalImportContext,
} from "../src/portal/import";
import {
    createProxyPresetMapping,
    mappingForModel,
    normalizePortalMapping,
    parseFreecadMapping,
    serializeFreecadMapping,
} from "../src/portal/mapping";
import {
    createMockHierarchy,
    createMockMonitoringTree,
    createMockVerfahrenRecords,
} from "../src/portal/mock";
import {
    normalizeHierarchyPayload,
    portalExternalId,
    type PortalNode,
} from "../src/portal/types";

function makeNode(
  partial: Partial<PortalNode> & Pick<PortalNode, "nodeType" | "id">,
): PortalNode {
  return {
    children: [],
    name: `${partial.nodeType} ${partial.id}`,
    raw: {},
    ...partial,
  };
}

function createContext(
  overrides: Partial<PortalImportContext> = {},
): PortalImportContext {
  return {
    mapping: createProxyPresetMapping(),
    psetOptions: {
      writeCatalogPsets: true,
      writeLinkPset: true,
      writeRecordPsets: false,
    },
    ...overrides,
  };
}

function storeyIdOf(document: NativeIfcDocument): number {
  const storey = document.entities.find(
    (entity) => entity.type === "IFCBUILDINGSTOREY",
  );
  assert.ok(storey, "sample document should contain an IfcBuildingStorey");
  return storey.id;
}

function psetOf(document: NativeIfcDocument, entityId: number, name: string) {
  return document.propertySetsByEntity
    .get(entityId)
    ?.find((set) => set.name === name);
}

/** Entpackt "IFCLABEL('x')" bzw. "IFCREAL(12.5)" auf den inneren Wert. */
function unwrapValue(value: string): string {
  const match = value.match(/^[A-Z0-9_]+\(([\s\S]*)\)$/);
  const inner = match ? match[1] : value;
  const quoted = inner.match(/^'([\s\S]*)'$/);
  return quoted ? quoted[1] : inner;
}

function propertyValue(
  document: NativeIfcDocument,
  entityId: number,
  psetName: string,
  propertyName: string,
): string | undefined {
  const raw = psetOf(document, entityId, psetName)?.values.find(
    (value) => value.name === propertyName,
  )?.value;
  return raw === undefined ? undefined : unwrapValue(raw);
}

/** Mock-UB 301 ("UB.DB.01") mit 2 US und je einem Verfahren. */
function mockUb301(): PortalNode {
  const ub = createMockHierarchy().children[0]?.children[0]?.children[0];
  assert.ok(ub);
  assert.equal(ub.nodeType, "untersuchungsbereich");
  assert.equal(ub.id, 301);
  return ub;
}

test("normalizeHierarchyPayload builds the tree with fallbacks", () => {
  const root = normalizeHierarchyPayload({
    id: 1,
    name: "Brücke",
    teilbauwerke: [
      {
        bauteile: [
          {
            id: 21,
            name: "Träger",
            type: "bauteil",
            untersuchungsbereiche: [
              {
                id: 31,
                name: "Bereich A",
                sichererName: "UB.BR.01",
                untersuchungsstellen: [
                  {
                    id: 41,
                    name: "Stelle 1",
                    sichererName: "US.BR.01.01",
                    untersuchungsverfahren: {
                      VorOrtUntersuchung: {
                        Kernbohrung: [{ abgeschlossen: false, id: 5 }],
                      },
                    },
                  },
                ],
              },
              // Ohne untersuchungsstellen-Array (defensiv = leer).
              { id: 32, name: "Bereich B" },
            ],
          },
        ],
        id: 11,
        name: "Überbau",
      },
    ],
  });

  assert.equal(root.nodeType, "bauwerk");
  assert.equal(portalExternalId(root), "bauwerk:1");
  const teilbauwerk = root.children[0];
  // type-Feld fehlt -> Ebenen-Fallback.
  assert.equal(teilbauwerk.nodeType, "teilbauwerk");
  const bauteil = teilbauwerk.children[0];
  assert.equal(bauteil.nodeType, "bauteil");

  const ub = bauteil.children[0];
  assert.equal(ub.nodeType, "untersuchungsbereich");
  assert.equal(ub.name, "UB.BR.01");
  assert.equal(ub.rawName, "Bereich A");
  assert.equal(ub.sichererName, "UB.BR.01");

  const us = ub.children[0];
  assert.equal(us.nodeType, "untersuchungsstelle");
  // Verfahren-Dict Kategorie -> Methode -> Einträge wird geflacht;
  // type fehlt -> Methodenname lowercase.
  const verfahren = us.children[0];
  assert.equal(verfahren.nodeType, "kernbohrung");
  assert.equal(verfahren.category, "VorOrtUntersuchung");
  assert.equal(verfahren.abgeschlossen, false);
  assert.equal(portalExternalId(verfahren), "kernbohrung:5");

  assert.deepEqual(bauteil.children[1].children, []);

  const empty = normalizeHierarchyPayload(null);
  assert.equal(empty.nodeType, "bauwerk");
  assert.deepEqual(empty.children, []);
});

test("mapping: FreeCAD JSON round-trip and Untersuchungsverfahren fallback", () => {
  const freecadJson = JSON.stringify({
    mappings: [
      {
        ifc_class: "IfcZone",
        model: "Untersuchungsbereich",
        object_type: "UB",
      },
      {
        ifc_class: "IfcAnnotation",
        model: "SonderVerfahren",
        object_type: "SV",
        target: "element",
      },
    ],
    version: 1,
  });

  const config = parseFreecadMapping(freecadJson);
  assert.equal(config.version, 1);
  assert.equal(config.mode, "custom");
  // 15 Standardmodelle + 1 Extra-Zeile hinten angehängt.
  assert.equal(config.mappings.length, 16);
  assert.equal(config.mappings[15].model, "SonderVerfahren");

  const ub = mappingForModel(config, "untersuchungsbereich");
  assert.equal(ub.ifcClass, "IFCZONE");
  assert.equal(ub.objectType, "UB");
  // Ohne explizites target gilt der Preset-Default (UB = Pset, Beispiel-IFC).
  assert.equal(ub.target, "pset");

  // Verfahrens-Modell ohne eigene Zeile -> Zeile "Untersuchungsverfahren".
  const fallback = mappingForModel(config, "Rueckprallhammer");
  assert.equal(fallback.model, "Untersuchungsverfahren");
  assert.equal(fallback.ifcClass, "IFCBUILDINGELEMENTPROXY");

  const serialized = serializeFreecadMapping(config);
  const payload = JSON.parse(serialized) as {
    version: number;
    mappings: Array<Record<string, unknown>>;
  };
  assert.equal(payload.version, 1);
  const ubRow = payload.mappings.find(
    (row) => row.model === "Untersuchungsbereich",
  );
  // ifc_class in CamelCase, Keys in snake_case.
  assert.deepEqual(ubRow, {
    ifc_class: "IfcZone",
    model: "Untersuchungsbereich",
    object_type: "UB",
    target: "pset",
    write_properties: true,
  });

  assert.deepEqual(parseFreecadMapping(serialized), config);
  assert.throws(() => parseFreecadMapping("{oops"), /kein gültiges JSON/);
});

test("ifcGuidForExternalId is deterministic and IFC-conformant", () => {
  const guid = ifcGuidForExternalId("untersuchungsbereich:301");
  assert.equal(guid.length, 22);
  assert.equal(guid, ifcGuidForExternalId("untersuchungsbereich:301"));
  assert.notEqual(guid, ifcGuidForExternalId("untersuchungsbereich:302"));
  assert.notEqual(guid, ifcGuidForExternalId("untersuchungsstelle:301"));

  for (const externalId of [
    "untersuchungsbereich:301",
    "untersuchungsstelle:401",
    "kernbohrung:2",
    "messstelle:701",
    "kanal:802",
  ]) {
    const candidate = ifcGuidForExternalId(externalId);
    assert.equal(candidate.length, 22);
    assert.ok(
      [...candidate].every((char) => IFC_GUID_ALPHABET.includes(char)),
      `alphabet violation in ${candidate}`,
    );
    assert.ok(
      "0123".includes(candidate[0]),
      `first char of ${candidate} must be 0-3`,
    );
  }
});

test("assignPortalLink writes the link pset onto an existing element", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const ub = mockUb301();

  assert.equal(
    findEntityIdByExternalId(sample, "untersuchungsbereich:301"),
    null,
  );

  const result = assignPortalLink(sample, storeyId, ub, createContext());
  assert.deepEqual(result.updatedIds, [storeyId]);
  assert.deepEqual(result.createdIds, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    propertyValue(result.document, storeyId, LINK_PSET_NAME, "ExternalId"),
    "untersuchungsbereich:301",
  );
  assert.equal(
    propertyValue(result.document, storeyId, LINK_PSET_NAME, "SourceSystem"),
    "MarxKrontalBWD",
  );
  assert.equal(
    findEntityIdByExternalId(result.document, "untersuchungsbereich:301"),
    storeyId,
  );
  // Katalog-Pset des UB landet ebenfalls am Host (Dot-ID wie im Beispiel-IFC).
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Untersuchungsbereich", "_ID"),
    "UB.DB.01",
  );

  // Wiederholtes Zuordnen dupliziert keine Psets.
  const again = assignPortalLink(result.document, storeyId, ub, createContext());
  assert.equal(again.summary, "0 Elemente erstellt, 1 aktualisiert, 0 Psets");
  assert.equal(again.document.entities.length, result.document.entities.length);
});

test("assignPortalLink replaces the link when re-assigning to another node", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const hierarchy = createMockHierarchy();
  const ub302 = hierarchy.children[0]?.children[1]?.children[0];
  assert.ok(ub302);
  assert.equal(ub302.nodeType, "untersuchungsbereich");
  assert.equal(ub302.id, 302);

  const first = assignPortalLink(sample, storeyId, mockUb301(), createContext());
  const second = assignPortalLink(
    first.document,
    storeyId,
    ub302,
    createContext(),
  );

  // Die Verknüpfung zeigt jetzt auf den NEUEN Knoten, der alte ist gelöst.
  assert.equal(
    findEntityIdByExternalId(second.document, "untersuchungsbereich:302"),
    storeyId,
  );
  assert.equal(
    findEntityIdByExternalId(second.document, "untersuchungsbereich:301"),
    null,
  );
  assert.equal(
    propertyValue(second.document, storeyId, LINK_PSET_NAME, "ExternalId"),
    "untersuchungsbereich:302",
  );
  assert.equal(
    propertyValue(second.document, storeyId, "ePset_Untersuchungsbereich", "_ID"),
    "UB.DB.02",
  );
  // Genau EIN Link-Pset am Element, plus Hinweis-Warnung.
  const linkSets = (
    second.document.propertySetsByEntity.get(storeyId) ?? []
  ).filter((set) => set.name === LINK_PSET_NAME);
  assert.equal(linkSets.length, 1);
  assert.equal(second.warnings.length, 1);
  assert.match(second.warnings[0], /untersuchungsbereich:301/);
});

/** Prüft, ob am Element eine Klassifikationsreferenz mit dem Code hängt. */
function hasClassification(
  document: NativeIfcDocument,
  entityId: number,
  identification: string,
): boolean {
  for (const relationship of document.relationshipsByEntity.get(entityId) ?? []) {
    if (relationship.type !== "IFCRELASSOCIATESCLASSIFICATION") {
      continue;
    }
    for (const otherId of [...relationship.sourceIds, ...relationship.targetIds]) {
      const entity = document.entityById.get(otherId);
      if (
        entity?.type === "IFCCLASSIFICATIONREFERENCE" &&
        entity.args[1] === `'${identification}'`
      ) {
        return true;
      }
    }
  }
  return false;
}

test("importPortalChildren creates US elements; Verfahren become psets + classification", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const ub = mockUb301();
  const context = createContext({
    verfahrenRecords: createMockVerfahrenRecords(),
  });

  const linked = assignPortalLink(sample, storeyId, ub, context);
  const result = importPortalChildren(linked.document, storeyId, ub, context);

  // Nur die 2 US werden Elemente — Verfahren sind Psets (Beispiel-IFC).
  assert.equal(result.createdIds.length, 2);
  assert.deepEqual(result.updatedIds, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    result.summary,
    "2 Elemente erstellt, 0 aktualisiert, 8 Psets, 2 Klassifikationen",
  );

  const usId = findEntityIdByExternalId(
    result.document,
    "untersuchungsstelle:401",
  );
  assert.ok(usId);
  const usEntity = result.document.entityById.get(usId);
  assert.equal(usEntity?.type, "IFCBUILDINGELEMENTPROXY");
  assert.equal(usEntity?.args[4], "'Untersuchungsstelle'");
  assert.equal(
    usEntity?.args[0],
    `'${ifcGuidForExternalId("untersuchungsstelle:401")}'`,
  );
  // Verlinkung per Dot-ID-Psets (Beispiel-IFC): kein BuildingElementPart,
  // der UB-Bezug steht in ePset_Objektinformationen._UntersuchungsbereichID.
  assert.equal(
    propertyValue(result.document, usId, "ePset_Objektinformationen", "_ID"),
    "US.DB.01.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_Bezeichnung",
    ),
    "US.DB.01.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_UntersuchungsbereichID",
    ),
    "UB.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Untersuchungsstelle",
      "_Untersuchungsverfahren",
    ),
    "Kernbohrung",
  );

  // Kein eigenes Kernbohrungs-Element mehr …
  assert.equal(findEntityIdByExternalId(result.document, "kernbohrung:2"), null);
  // … stattdessen Verfahrens-Pset auf der US (Marker = verboser Name).
  assert.equal(
    propertyValue(result.document, usId, "ePset_Kernbohrung", "_Kernbohrung_KB"),
    "Kernbohrung",
  );
  assert.equal(
    propertyValue(result.document, usId, "ePset_Kernbohrung", "_Datum_KB"),
    "2026-05-12",
  );
  assert.equal(
    propertyValue(result.document, usId, "ePset_Kernbohrung", "_ExternalId"),
    "kernbohrung:2",
  );
  // Klassifikationsreferenz am US-Element (Beispiel-IFC).
  assert.ok(hasClassification(result.document, usId, "BWD - KB"));
  const serialized = serializeNativeIfcDocument(result.document);
  assert.ok(
    serialized.includes(
      "IFCCLASSIFICATIONREFERENCE('openSIM BIM Objektkatalog','BWD - KB','BWD - KB Kernbohrung'",
    ),
  );

  // Zweite US bekommt das Feuchte-Pset.
  const us402 = findEntityIdByExternalId(
    result.document,
    "untersuchungsstelle:402",
  );
  assert.ok(us402);
  assert.equal(
    propertyValue(result.document, us402, "ePset_Feuchtegehalt", "_Feuchte_FEU"),
    "Feuchte",
  );
  assert.ok(hasClassification(result.document, us402, "BWD - FEU"));

  // Deterministische GlobalId auch im serialisierten STEP-Text.
  assert.ok(
    serialized.includes(
      `IFCBUILDINGELEMENTPROXY('${ifcGuidForExternalId("untersuchungsstelle:401")}',$,'US.DB.01.01',$,'Untersuchungsstelle',`,
    ),
  );

  // Re-Import ist idempotent (keine neuen Psets/Klassifikationen/Elemente).
  const again = importPortalChildren(result.document, storeyId, ub, context);
  assert.deepEqual(again.createdIds, []);
  assert.equal(again.updatedIds.length, 2);
  assert.equal(again.summary, "0 Elemente erstellt, 2 aktualisiert, 0 Psets");
  assert.equal(again.document.entities.length, result.document.entities.length);
});

test("importPortalStructure links the host and imports the whole subtree", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);

  const result = importPortalStructure(
    sample,
    mockUb301(),
    storeyId,
    createContext(),
  );

  assert.ok(result.updatedIds.includes(storeyId));
  assert.equal(result.createdIds.length, 2);
  assert.equal(
    findEntityIdByExternalId(result.document, "untersuchungsbereich:301"),
    storeyId,
  );
  // Verfahren wird als Pset auf der US abgebildet, nicht als Element.
  assert.equal(findEntityIdByExternalId(result.document, "feuchte:7"), null);
  const us402 = findEntityIdByExternalId(
    result.document,
    "untersuchungsstelle:402",
  );
  assert.ok(us402);
  assert.ok(psetOf(result.document, us402, "ePset_Feuchtegehalt"));
});

test("target pset writes ePset_Maßnahme1/ePset_Kanal1 on the host, no new entities", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const tree = createMockMonitoringTree();
  const massnahme = tree[0]?.children[0];
  assert.ok(massnahme);
  assert.equal(massnahme.nodeType, "massnahme");
  const kanal = massnahme.children[0]?.children[0];
  assert.ok(kanal);
  assert.equal(kanal.nodeType, "kanal");

  const parent = makeNode({
    children: [{ ...massnahme, children: [] }, kanal],
    id: 999,
    nodeType: "messkonzept",
  });

  const result = importPortalChildren(sample, storeyId, parent, createContext());
  assert.deepEqual(result.createdIds, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Maßnahme1", "_ID"),
    "601",
  );
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Maßnahme1", "_Bezeichnung"),
    "Temperatur Überbau",
  );
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Kanal1", "_ID"),
    "K.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Kanal1",
      "_PhysikalischeGroeße",
    ),
    "°C",
  );
  // Keine neuen Elemente entstanden.
  assert.equal(
    result.document.entitiesByType.get("IFCBUILDINGELEMENTPROXY")?.length ?? 0,
    sample.entitiesByType.get("IFCBUILDINGELEMENTPROXY")?.length ?? 0,
  );
});

test("target skip drops Messkonzept but still creates Messstellen at the host", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const wrapper = makeNode({
    children: createMockMonitoringTree(),
    id: 36,
    nodeType: "bauwerk",
  });

  const result = importPortalChildren(
    sample,
    storeyId,
    wrapper,
    createContext(),
  );

  // Messkonzept (skip) und Massnahme (pset) erzeugen keine Elemente …
  assert.equal(findEntityIdByExternalId(result.document, "messkonzept:501"), null);
  assert.equal(findEntityIdByExternalId(result.document, "massnahme:601"), null);
  assert.ok(psetOf(result.document, storeyId, "ePset_Maßnahme1"));
  // … die Messstellen werden trotzdem am Host erzeugt.
  assert.equal(result.createdIds.length, 2);
  const messstelleId = findEntityIdByExternalId(
    result.document,
    "messstelle:701",
  );
  assert.ok(messstelleId);
  const entity = result.document.entityById.get(messstelleId);
  assert.equal(entity?.type, "IFCBUILDINGELEMENTPROXY");
  assert.equal(entity?.args[4], "'Sensor'");
  assert.equal(entity?.name, "MS.DB.01");
  // Kanal-Pset landet am Messstellen-Element, Position/Sensor-Psets ebenfalls.
  assert.equal(
    propertyValue(result.document, messstelleId, "ePset_Kanal1", "_ID"),
    "K.DB.01",
  );
  assert.equal(
    propertyValue(result.document, messstelleId, "ePset_Position", "_KoordinatenX"),
    "12.5",
  );
  assert.equal(
    propertyValue(
      result.document,
      messstelleId,
      "ePset_Sensor",
      "_SensorSeriennummerLtHersteller",
    ),
    "SN-2044-118",
  );
});

test("re-import stays idempotent without the link pset (GUID fallback)", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const ub = mockUb301();
  const context = createContext({
    psetOptions: {
      writeCatalogPsets: true,
      writeLinkPset: false,
      writeRecordPsets: false,
    },
  });

  const first = importPortalChildren(sample, storeyId, ub, context);
  assert.equal(first.createdIds.length, 2);
  const usId = findEntityIdByExternalId(
    first.document,
    "untersuchungsstelle:401",
  );
  assert.ok(usId);
  // Kein Link-Pset geschrieben — der Fund läuft über die deterministische GlobalId.
  assert.equal(psetOf(first.document, usId, LINK_PSET_NAME), undefined);

  const again = importPortalChildren(first.document, storeyId, ub, context);
  assert.deepEqual(again.createdIds, []);
  assert.equal(again.updatedIds.length, 2);
  assert.equal(again.document.entities.length, first.document.entities.length);
});

function makeKanal(id: number, sichererName: string, einheit: string): PortalNode {
  return makeNode({
    id,
    nodeType: "kanal",
    raw: {
      datentyp: "Float",
      einheit,
      id,
      name: `Kanal ${id}`,
      sicherer_name: sichererName,
    },
  });
}

function makeMassnahme(id: number, bezeichnung: string): PortalNode {
  return makeNode({
    id,
    nodeType: "massnahme",
    raw: { bezeichnung, id },
  });
}

test("kanal psets keep their index by identity when the portal order changes", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const kanalA = makeKanal(801, "K.DB.01", "°C");
  const kanalB = makeKanal(802, "K.DB.09", "µm/m");

  const first = importPortalChildren(
    sample,
    storeyId,
    makeNode({ children: [kanalA], id: 999, nodeType: "messkonzept" }),
    createContext(),
  );
  assert.equal(
    propertyValue(first.document, storeyId, "ePset_Kanal1", "_ID"),
    "K.DB.01",
  );

  // Backend liefert neueste zuerst: [B, A]. B darf Kanal1 (A) nicht verdrängen.
  const second = importPortalChildren(
    first.document,
    storeyId,
    makeNode({ children: [kanalB, kanalA], id: 999, nodeType: "messkonzept" }),
    createContext(),
  );
  assert.equal(
    propertyValue(second.document, storeyId, "ePset_Kanal1", "_ID"),
    "K.DB.01",
  );
  assert.equal(
    propertyValue(second.document, storeyId, "ePset_Kanal2", "_ID"),
    "K.DB.09",
  );
  assert.equal(psetOf(second.document, storeyId, "ePset_Kanal3"), undefined);

  // Idempotenz: dritter Lauf schreibt nichts Neues.
  const third = importPortalChildren(
    second.document,
    storeyId,
    makeNode({ children: [kanalB, kanalA], id: 999, nodeType: "messkonzept" }),
    createContext(),
  );
  assert.equal(third.document.entities.length, second.document.entities.length);
  assert.equal(psetOf(third.document, storeyId, "ePset_Kanal3"), undefined);
});

test("record psets of pset-target siblings get the host index", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const parent = makeNode({
    children: [makeKanal(801, "K.DB.01", "°C"), makeKanal(802, "K.DB.02", "µm/m")],
    id: 999,
    nodeType: "messkonzept",
  });
  const context = createContext({
    psetOptions: {
      writeCatalogPsets: true,
      writeLinkPset: true,
      writeRecordPsets: true,
    },
  });

  const result = importPortalChildren(sample, storeyId, parent, context);
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "Pset_MarxKrontalBWD_Kanal1",
      "sicherer_name",
    ),
    "K.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "Pset_MarxKrontalBWD_Kanal2",
      "sicherer_name",
    ),
    "K.DB.02",
  );
});

test("multiple structure-import roots on one host append psets and warn about the link", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const rootA = makeNode({
    children: [makeMassnahme(601, "Temperatur")],
    id: 501,
    nodeType: "messkonzept",
  });
  const rootB = makeNode({
    children: [makeMassnahme(602, "Dehnung")],
    id: 502,
    nodeType: "messkonzept",
  });

  const first = importPortalStructure(sample, rootA, storeyId, createContext());
  assert.deepEqual(first.warnings, []);
  const second = importPortalStructure(
    first.document,
    rootB,
    storeyId,
    createContext(),
  );

  // Beide Maßnahmen landen unter eigenen Indizes statt per Namenskollision zu verschwinden.
  assert.equal(
    propertyValue(second.document, storeyId, "ePset_Maßnahme1", "_ID"),
    "601",
  );
  assert.equal(
    propertyValue(second.document, storeyId, "ePset_Maßnahme2", "_ID"),
    "602",
  );
  // Der Host bleibt mit der ersten Wurzel verknüpft — mit Warnung statt still.
  assert.equal(
    propertyValue(second.document, storeyId, LINK_PSET_NAME, "ExternalId"),
    "messkonzept:501",
  );
  assert.equal(
    second.warnings.filter((warning) => warning.includes("messkonzept:501"))
      .length,
    1,
  );

  // Waisen-Kanäle als Wurzeln bekommen ebenfalls fortlaufende Indizes.
  const third = importPortalStructure(
    second.document,
    makeKanal(801, "K.DB.01", "°C"),
    storeyId,
    createContext(),
  );
  const fourth = importPortalStructure(
    third.document,
    makeKanal(802, "K.DB.02", "µm/m"),
    storeyId,
    createContext(),
  );
  assert.equal(
    propertyValue(fourth.document, storeyId, "ePset_Kanal1", "_ID"),
    "K.DB.01",
  );
  assert.equal(
    propertyValue(fourth.document, storeyId, "ePset_Kanal2", "_ID"),
    "K.DB.02",
  );
});

function makeKernbohrung(id: number, datum: string): PortalNode {
  return makeNode({
    id,
    nodeType: "kernbohrung",
    raw: { abgeschlossen: false, datum, id, type: "kernbohrung" },
  });
}

test("verfahren psets number the 2nd instance and keep identity across re-imports", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const kbA = makeKernbohrung(21, "2026-05-01");
  const kbB = makeKernbohrung(22, "2026-06-15");
  const us = makeNode({
    children: [kbA],
    id: 401,
    nodeType: "untersuchungsstelle",
    sichererName: "US.DB.01.01",
  });
  const ub = makeNode({
    children: [us],
    id: 301,
    nodeType: "untersuchungsbereich",
    sichererName: "UB.DB.01",
  });

  const first = importPortalChildren(sample, storeyId, ub, createContext());
  const usId = findEntityIdByExternalId(first.document, "untersuchungsstelle:401");
  assert.ok(usId);
  // Erste Instanz ohne Suffix (Beispiel-IFC), Marker = verboser Name.
  assert.equal(
    propertyValue(first.document, usId, "ePset_Kernbohrung", "_ExternalId"),
    "kernbohrung:21",
  );
  assert.equal(psetOf(first.document, usId, "ePset_Kernbohrung2"), undefined);
  assert.ok(hasClassification(first.document, usId, "BWD - KB"));

  // Portal liefert neu sortiert [B, A]: B darf A nicht verdrängen.
  const second = importPortalChildren(
    first.document,
    storeyId,
    { ...ub, children: [{ ...us, children: [kbB, kbA] }] },
    createContext(),
  );
  assert.equal(
    propertyValue(second.document, usId, "ePset_Kernbohrung", "_ExternalId"),
    "kernbohrung:21",
  );
  assert.equal(
    propertyValue(second.document, usId, "ePset_Kernbohrung2", "_ExternalId"),
    "kernbohrung:22",
  );
  assert.equal(
    propertyValue(second.document, usId, "ePset_Kernbohrung2", "_Datum_KB"),
    "2026-06-15",
  );
  // Klassifikation bleibt einfach (idempotent pro Code).
  const classificationRefs = second.document.entities.filter(
    (entity) =>
      entity.type === "IFCCLASSIFICATIONREFERENCE" &&
      entity.args[1] === "'BWD - KB'",
  );
  assert.equal(classificationRefs.length, 1);

  // Dritter Lauf: komplett idempotent.
  const third = importPortalChildren(
    second.document,
    storeyId,
    { ...ub, children: [{ ...us, children: [kbB, kbA] }] },
    createContext(),
  );
  assert.equal(third.document.entities.length, second.document.entities.length);
  assert.equal(psetOf(third.document, usId, "ePset_Kernbohrung3"), undefined);
});

test("UB with target pset becomes numbered ePset_Untersuchungsbereich<NN> on the host", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const mapping = createProxyPresetMapping();
  const ubRow = mapping.mappings.find(
    (row) => row.model === "Untersuchungsbereich",
  );
  assert.ok(ubRow);
  ubRow.target = "pset";
  const context = createContext({ mapping });

  const makeUs = (id: number, sichererName: string, kbId: number) =>
    makeNode({
      children: [makeKernbohrung(kbId, "2026-05-01")],
      id,
      nodeType: "untersuchungsstelle",
      sichererName,
    });
  const bauteil = makeNode({
    children: [
      makeNode({
        bemerkung: "Kappe Ost",
        children: [makeUs(401, "US.DB.01.01", 21)],
        id: 301,
        nodeType: "untersuchungsbereich",
        rawName: "UB Kappe Ost",
        sichererName: "UB.DB.01",
      }),
      makeNode({
        children: [makeUs(402, "US.DB.02.01", 22)],
        id: 302,
        nodeType: "untersuchungsbereich",
        sichererName: "UB.DB.02",
      }),
    ],
    id: 200,
    nodeType: "bauteil",
  });

  const result = importPortalChildren(sample, storeyId, bauteil, context);
  // UBs sind Psets am Host (Beispiel-IFC-Form, zweistellig nummeriert) …
  assert.equal(
    findEntityIdByExternalId(result.document, "untersuchungsbereich:301"),
    null,
  );
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Untersuchungsbereich01", "_ID"),
    "UB.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Untersuchungsbereich01",
      "_Bezeichnung",
    ),
    "UB Kappe Ost",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Untersuchungsbereich01",
      "_Untersuchungsverfahren1_UB",
    ),
    "Kernbohrung",
  );
  assert.equal(
    propertyValue(result.document, storeyId, "ePset_Untersuchungsbereich02", "_ID"),
    "UB.DB.02",
  );
  // … die US werden trotzdem als Elemente am Host erzeugt (flach, wie im Beispiel).
  assert.equal(result.createdIds.length, 2);
  const usId = findEntityIdByExternalId(result.document, "untersuchungsstelle:401");
  assert.ok(usId);
  assert.ok(psetOf(result.document, usId, "ePset_Kernbohrung"));

  // Re-Import bleibt idempotent (Identität über _ExternalId im UB-Pset).
  const again = importPortalChildren(result.document, storeyId, bauteil, context);
  assert.deepEqual(again.createdIds, []);
  assert.equal(again.document.entities.length, result.document.entities.length);
  assert.equal(
    psetOf(again.document, storeyId, "ePset_Untersuchungsbereich03"),
    undefined,
  );
});

test("full structure import matches the Beispiel-IFC shape (no parts, dot-id psets)", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const result = importPortalStructure(
    sample,
    createMockHierarchy(),
    storeyId,
    createContext(),
  );

  // Kein IfcBuildingElementPart, keine Elemente für Teilbauwerk/Bauteil/UB —
  // nur die 3 US werden Proxies (flach am Host, wie im Beispiel-IFC).
  assert.equal(
    result.document.entitiesByType.get("IFCBUILDINGELEMENTPART")?.length ?? 0,
    0,
  );
  assert.equal(result.createdIds.length, 3);
  for (const createdId of result.createdIds) {
    assert.equal(
      result.document.entityById.get(createdId)?.type,
      "IFCBUILDINGELEMENTPROXY",
    );
  }
  assert.equal(findEntityIdByExternalId(result.document, "bauteil:201"), null);
  assert.equal(findEntityIdByExternalId(result.document, "teilbauwerk:101"), null);
  assert.equal(
    findEntityIdByExternalId(result.document, "untersuchungsbereich:301"),
    null,
  );

  // UBs als nummerierte Psets am Host. Dot-ID-Konvention wie im Beispiel-IFC:
  // Bauwerk(snummer).Teilbauwerksnummer.Projekt_Bezeichnung.<Name> — die
  // Teilbauwerksnummer kommt aus raw.number, die Projekt-Bezeichnung wird wie
  // im Server-IFC-Export mit "_" statt Punkt/Leerzeichen geschrieben.
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Untersuchungsbereich01",
      "_ID",
    ),
    "Demobrücke.2.Demo_Diagnostik.UB.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Untersuchungsbereich02",
      "_ID",
    ),
    "Demobrücke.2.Demo_Diagnostik.UB.DB.02",
  );

  // US-Verlinkung über ePset_Objektinformationen (_BauteilID/_UntersuchungsbereichID).
  const usId = findEntityIdByExternalId(result.document, "untersuchungsstelle:401");
  assert.ok(usId);
  assert.equal(
    propertyValue(result.document, usId, "ePset_Objektinformationen", "_ID"),
    "Demobrücke.2.Demo_Diagnostik.US.DB.01.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_BauteilID",
    ),
    "Demobrücke.2.Hauptträger Nord",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_UntersuchungsbereichID",
    ),
    "Demobrücke.2.Demo_Diagnostik.UB.DB.01",
  );
  // Verfahren als Pset + Klassifikation an der US.
  assert.ok(psetOf(result.document, usId, "ePset_Kernbohrung"));
  assert.ok(hasClassification(result.document, usId, "BWD - KB"));

  // Re-Import bleibt idempotent.
  const again = importPortalStructure(
    result.document,
    createMockHierarchy(),
    storeyId,
    createContext(),
  );
  assert.deepEqual(again.createdIds, []);
  assert.equal(again.document.entities.length, result.document.entities.length);
});

test("idPrefix from settings yields the exact Bauwerksnummer dot-id convention", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  // Panel-Einstellungen liefern die Bauwerksnummer (aus dem Bauwerk-Datensatz);
  // Teilbauwerksnummer + Projekt kommen aus dem Baum-Durchlauf.
  const context = createContext({
    idPrefix: { bauwerk: "5692001", projekt: "Demo Diagnostik" },
  });
  const result = importPortalStructure(
    sample,
    createMockHierarchy(),
    storeyId,
    context,
  );
  const usId = findEntityIdByExternalId(result.document, "untersuchungsstelle:401");
  assert.ok(usId);
  // Exakt die Beispiel-IFC-Konvention: Bauwerksnr.Teilbauwerksnr.Projekt.Name
  assert.equal(
    propertyValue(result.document, usId, "ePset_Objektinformationen", "_ID"),
    "5692001.2.Demo_Diagnostik.US.DB.01.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_UntersuchungsbereichID",
    ),
    "5692001.2.Demo_Diagnostik.UB.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      storeyId,
      "ePset_Untersuchungsbereich01",
      "_ID",
    ),
    "5692001.2.Demo_Diagnostik.UB.DB.01",
  );
  assert.equal(
    propertyValue(
      result.document,
      usId,
      "ePset_Objektinformationen",
      "_BauteilID",
    ),
    "5692001.2.Hauptträger Nord",
  );
});

test("target ignore drops the node including its subtree (stop before Verfahren)", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const mapping = createProxyPresetMapping();
  for (const row of mapping.mappings) {
    if (
      ["Untersuchungsverfahren", "Kernbohrung", "Oeffnung"].includes(row.model)
    ) {
      row.target = "ignore";
    }
  }
  const context = createContext({
    mapping,
    verfahrenRecords: createMockVerfahrenRecords(),
  });

  const result = importPortalChildren(sample, storeyId, mockUb301(), context);
  // US entstehen weiterhin …
  assert.equal(result.createdIds.length, 2);
  const usId = findEntityIdByExternalId(result.document, "untersuchungsstelle:401");
  assert.ok(usId);
  // … aber ohne Verfahrens-Psets und ohne Klassifikation.
  assert.equal(psetOf(result.document, usId, "ePset_Kernbohrung"), undefined);
  assert.equal(hasClassification(result.document, usId, "BWD - KB"), false);
  // Feuchte hat keine eigene Zeile -> Fallback "Untersuchungsverfahren" (ignore).
  const us402 = findEntityIdByExternalId(result.document, "untersuchungsstelle:402");
  assert.ok(us402);
  assert.equal(psetOf(result.document, us402, "ePset_Feuchtegehalt"), undefined);

  // FreeCAD-Roundtrip erhält das Ziel "ignore".
  const roundtrip = parseFreecadMapping(serializeFreecadMapping(mapping));
  assert.equal(mappingForModel(roundtrip, "Kernbohrung").target, "ignore");
});

test("writeProperties=false creates empty pset shells only", () => {
  const sample = createNativeSampleDocument();
  const storeyId = storeyIdOf(sample);
  const mapping = createProxyPresetMapping();
  for (const row of mapping.mappings) {
    if (row.model === "Kernbohrung" || row.model === "Untersuchungsstelle") {
      row.writeProperties = false;
    }
  }
  const context = createContext({
    mapping,
    verfahrenRecords: createMockVerfahrenRecords(),
  });

  const result = importPortalChildren(sample, storeyId, mockUb301(), context);
  const usId = findEntityIdByExternalId(result.document, "untersuchungsstelle:401");
  assert.ok(usId);

  // US-Element entsteht mit Link-Pset (Identität), Katalog-Psets sind leere Hüllen.
  assert.equal(
    propertyValue(result.document, usId, LINK_PSET_NAME, "ExternalId"),
    "untersuchungsstelle:401",
  );
  const objektinfo = psetOf(result.document, usId, "ePset_Objektinformationen");
  assert.ok(objektinfo);
  assert.equal(objektinfo.values.length, 0);
  // Verfahrens-Pset als leere Hülle, Klassifikation bleibt erhalten.
  const kbShell = psetOf(result.document, usId, "ePset_Kernbohrung");
  assert.ok(kbShell);
  assert.equal(kbShell.values.length, 0);
  assert.ok(hasClassification(result.document, usId, "BWD - KB"));

  // writeProperties=false am Roundtrip erhalten; Re-Import idempotent.
  const roundtrip = parseFreecadMapping(serializeFreecadMapping(mapping));
  assert.equal(mappingForModel(roundtrip, "Kernbohrung").writeProperties, false);
  assert.equal(mappingForModel(roundtrip, "Probe").writeProperties, true);
  const again = importPortalChildren(result.document, storeyId, mockUb301(), context);
  assert.deepEqual(again.createdIds, []);
  assert.equal(again.document.entities.length, result.document.entities.length);
  assert.equal(psetOf(again.document, usId, "ePset_Kernbohrung2"), undefined);
});

test("proxy mode always resolves to the current preset (stored snapshots do not stick)", () => {
  // Alter localStorage-Stand: Preset-Snapshot mit Kernbohrung als Element.
  const stored = normalizePortalMapping({
    mappings: [
      {
        ifc_class: "IfcBuildingElementProxy",
        model: "Kernbohrung",
        object_type: "Kernbohrung",
        target: "element",
      },
    ],
    mode: "proxy",
    version: 1,
  });
  assert.equal(mappingForModel(stored, "Kernbohrung").target, "pset");
  assert.deepEqual(stored, createProxyPresetMapping());

  // Custom-Modus behält die Nutzer-Zeilen.
  const custom = normalizePortalMapping({
    mappings: [
      {
        ifc_class: "IfcBuildingElementProxy",
        model: "Kernbohrung",
        object_type: "Kernbohrung",
        target: "element",
      },
    ],
    mode: "custom",
    version: 1,
  });
  assert.equal(mappingForModel(custom, "Kernbohrung").target, "element");
});

test("verfahren registry maps georadar/betondeckungsscan and further backend models", () => {
  const georadar = verfahrenSpecForType("bewehrungserkundunggeoradar");
  assert.equal(georadar?.pset, "ePset_Georadar");
  assert.equal(georadar?.abbr, "GR");
  assert.equal(georadar?.marker, "_Georadar");

  const ebd = verfahrenSpecForType("bewehrungserkundungbetondeckungsscan");
  assert.equal(ebd?.pset, "ePset_Betondeckung elektromagnetisch");
  assert.equal(ebd?.abbr, "EBD");

  // Präfix-Fallback bleibt für die übrigen Bewehrungserkundungen erhalten.
  assert.equal(
    verfahrenSpecForType("bewehrungserkundungelektromagnetisch")?.abbr,
    "EBS",
  );
  assert.equal(verfahrenSpecForType("bewehrungserkundung")?.abbr, "EBS");

  const skb = verfahrenSpecForType("zerstoerungsarmesondierungskernbohrung");
  assert.equal(skb?.pset, "ePset_Sondierungskernbohrung");
  assert.equal(skb?.marker, "_Kernbohrung");
  assert.equal(verfahrenSpecForType("gefuegenaturstein")?.abbr, "GNS");
  assert.equal(verfahrenSpecForType("gefuegeabdichtung")?.abbr, "GA");
  assert.equal(verfahrenSpecForType("aeusseresmauerwerksgefuege")?.abbr, "MWA");
  assert.equal(verfahrenSpecForType("inneresmauerwerksgefuege")?.abbr, "MWI");
  assert.equal(verfahrenSpecForType("gefuegemoertel")?.abbr, "MOE");
  assert.equal(verfahrenSpecForType("mechanischestaleigenschaften")?.abbr, "MSE");
  assert.equal(verfahrenSpecForType("rueckdehnungsmessung")?.abbr, "RDM");
});

test("parseKoordinatenText handles backend coordinate strings", () => {
  assert.deepEqual(parseKoordinatenText("12.5; 3.2; 41.8"), [12.5, 3.2, 41.8]);
  assert.deepEqual(parseKoordinatenText("12,5; 3,2; 41,8"), [12.5, 3.2, 41.8]);
  assert.deepEqual(parseKoordinatenText("12.5, 3.2, 41.8"), [12.5, 3.2, 41.8]);
  assert.deepEqual(parseKoordinatenText("48,1; -2,7; 39,9"), [48.1, -2.7, 39.9]);
  // Doppeldeutige bzw. unvollständige Angaben werden NICHT geraten.
  assert.equal(parseKoordinatenText("12,5,3"), null);
  assert.equal(parseKoordinatenText("Achse 10, Feld 3"), null);
  assert.equal(parseKoordinatenText(""), null);

  // Unparsbare Koordinaten landen als Text-Property statt zu verschwinden.
  const psets = buildCatalogPsetsForNode(
    makeNode({
      id: 7,
      nodeType: "messstelle",
      raw: {
        bezeichnung: "MS 7",
        position: { koordinaten: "Achse 10 überm Lager" },
      },
    }),
  );
  const position = psets.find((pset) => pset.psetName === "ePset_Position");
  assert.ok(position);
  assert.deepEqual(position.properties, [
    { name: "_Koordinaten", value: "Achse 10 überm Lager" },
  ]);
});

test("catalog id derivation with fallbacks", () => {
  assert.equal(
    deriveUntersuchungsbereichId(
      makeNode({ id: 9, nodeType: "untersuchungsbereich", sichererName: "UB.DB.01" }),
    ),
    "UB_1",
  );
  assert.equal(
    deriveUntersuchungsbereichId(
      makeNode({ id: 9, nodeType: "untersuchungsbereich" }),
      4,
    ),
    "UB_4",
  );
  assert.equal(
    deriveUntersuchungsbereichId(
      makeNode({ id: 9, nodeType: "untersuchungsbereich" }),
    ),
    "UB_9",
  );
  assert.equal(
    deriveUntersuchungsstelleId(
      makeNode({ id: 5, nodeType: "untersuchungsstelle", sichererName: "US.DB.01.02" }),
    ),
    "US_1_2",
  );
  assert.equal(
    deriveUntersuchungsstelleId(makeNode({ id: 5, nodeType: "untersuchungsstelle" }), {
      ubNumber: 2,
      usNumber: 3,
    }),
    "US_2_3",
  );
  assert.equal(
    deriveUntersuchungsstelleId(makeNode({ id: 5, nodeType: "untersuchungsstelle" })),
    "US_5",
  );
});
