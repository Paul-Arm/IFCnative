import {
  normalizeHierarchyPayload,
  normalizeMonitoringPayload,
  type PortalBauwerk,
  type PortalNode,
  type PortalProjekt,
} from "./types";

export const MOCK_BAUWERKE: PortalBauwerk[] = [
  { bauwerksnummer: "5692001", bezeichnung: "Demobrücke", id: 36 },
];

export const MOCK_PROJEKTE: PortalProjekt[] = [
  { bezeichnung: "Demo Diagnostik", id: 15, typ: "dia" },
];

/** Roh-Payload im HierarchicalUBStructure-Format (wird normalisiert geliefert). */
export const MOCK_HIERARCHY_PAYLOAD: Record<string, unknown> = {
  id: 36,
  name: "Demobrücke",
  projekt: { id: 15, name: "Demo Diagnostik" },
  teilbauwerke: [
    {
      bauteile: [
        {
          id: 201,
          name: "Hauptträger Nord",
          type: "bauteil",
          untersuchungsbereiche: [
            {
              bemerkung: "Sichtbeton, Zugang über Hubsteiger",
              id: 301,
              name: "Stütze Achse 10",
              sichererName: "UB.DB.01",
              type: "untersuchungsbereich",
              untersuchungsstellen: [
                {
                  id: 401,
                  name: "Kernbohrung Steg",
                  sichererName: "US.DB.01.01",
                  type: "untersuchungsstelle",
                  // Der echte Hierarchie-Payload liefert für Verfahren NUR
                  // {id, abgeschlossen, type, titelBild, titelBild_name};
                  // datum/bemerkung stehen in den Verfahrens-Records.
                  untersuchungsverfahren: {
                    VorOrtUntersuchung: {
                      kernbohrung: [
                        {
                          abgeschlossen: false,
                          id: 2,
                          titelBild: null,
                          titelBild_name: null,
                          type: "kernbohrung",
                        },
                      ],
                    },
                  },
                },
                {
                  bemerkung: "Probe aus Hohlkasten",
                  id: 402,
                  name: "Feuchteprobe Kammer",
                  sichererName: "US.DB.01.02",
                  type: "untersuchungsstelle",
                  untersuchungsverfahren: {
                    Laboruntersuchung: {
                      feuchte: [
                        {
                          abgeschlossen: true,
                          id: 7,
                          titelBild: null,
                          titelBild_name: null,
                          type: "feuchte",
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          id: 202,
          name: "Widerlager West",
          type: "bauteil",
          untersuchungsbereiche: [
            {
              id: 302,
              name: "Widerlagerwand",
              sichererName: "UB.DB.02",
              type: "untersuchungsbereich",
              untersuchungsstellen: [
                {
                  id: 403,
                  name: "Rückprallhammer Wand",
                  sichererName: "US.DB.02.01",
                  type: "untersuchungsstelle",
                  untersuchungsverfahren: {},
                },
              ],
            },
          ],
        },
      ],
      id: 101,
      name: "Überbau",
      // Teilbauwerksnummer wie vom Teilbauwerk-Endpoint geliefert (Dot-IDs).
      number: 2,
      type: "teilbauwerk",
    },
  ],
  type: "bauwerk",
};

export const MOCK_MESSKONZEPTE: Array<Record<string, unknown>> = [
  { bauwerk: 36, bezeichnung: "Messkonzept Demobrücke 2026", id: 501 },
];

export const MOCK_MASSNAHMEN: Array<Record<string, unknown>> = [
  {
    bezeichnung: "Temperatur Überbau",
    id: 601,
    kurzbezeichnung: "TU",
    messkonzept: 501,
  },
];

export const MOCK_MESSSTELLEN: Array<Record<string, unknown>> = [
  {
    bezeichnung: "Temperatur Hauptträger Nord",
    id: 701,
    kabel: { code: "K-118", laenge: 25, typ: "LiYCY" },
    massnahme: 601,
    messstellenbezeichnung: "MS.DB.01",
    position: {
      ausrichtung: "Nord",
      bauteilbereich: "Auflager",
      // Position.koordinaten ist im Backend ein freies CharField (String).
      koordinaten: "12.5; 3.2; 41.8",
      messachse: "Achse 10",
    },
    sensor: {
      hersteller: "Testo",
      inventarnummer: "SN-2044-118",
      modellbezeichnung: "PT100-Class-A",
    },
    status: { betriebszustand: "IN_BETRIEB" },
  },
  {
    bezeichnung: "Dehnung Steg Süd",
    id: 702,
    kabel: null,
    massnahme: 601,
    messstellenbezeichnung: "MS.DB.02",
    position: {
      ausrichtung: "Süd",
      bauteilbereich: "Feldmitte",
      // Dezimalkomma-Variante wie im Portal üblich.
      koordinaten: "48,1; -2,7; 39,9",
      messachse: "Achse 20",
    },
    sensor: {
      inventarnummer: "SN-2044-231",
      modellbezeichnung: "DMS-K-120",
    },
    status: { betriebszustand: "IN_PLANUNG" },
  },
];

export const MOCK_KANAELE: Array<Record<string, unknown>> = [
  {
    datentyp: "Float",
    einheit: "°C",
    id: 801,
    messstelle: 701,
    name: "T_HT_Nord",
    sicherer_name: "K.DB.01",
  },
  {
    datentyp: "Float",
    einheit: "µm/m",
    id: 802,
    messstelle: 702,
    name: "EPS_Steg_Sued",
    sicherer_name: "K.DB.02",
  },
];

export function createMockHierarchy(): PortalNode {
  return normalizeHierarchyPayload(MOCK_HIERARCHY_PAYLOAD);
}

export function createMockMonitoringTree(): PortalNode[] {
  return normalizeMonitoringPayload(
    MOCK_MESSKONZEPTE,
    MOCK_MASSNAHMEN,
    MOCK_MESSSTELLEN,
    MOCK_KANAELE,
  );
}

/** Verfahrens-Records passend zu den IDs im Mock-Baum (Key = ExternalId). */
export function createMockVerfahrenRecords(): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  records.set("kernbohrung:2", {
    abgeschlossen: false,
    bauwerk: 36,
    bemerkung: "Bohrkern für Laboranalyse entnommen",
    bohrtiefe: 35,
    datum: "2026-05-12",
    durchmesser: 100,
    id: 2,
    projekt: 15,
    type: "Kernbohrung",
    untersuchungsstelle: 401,
  });
  records.set("feuchte:7", {
    abgeschlossen: true,
    bauwerk: 36,
    datum: "2026-05-20",
    id: 7,
    probennummer: 12,
    projekt: 15,
    type: "Feuchte",
    untersuchungsstelle: 402,
  });
  return records;
}
