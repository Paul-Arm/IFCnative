/**
 * Großkoordinaten-Vorbehandlung für den Tessellierungslauf.
 *
 * WARUM DAS NÖTIG IST
 * -------------------
 * Die WASM-Geometrie von @ifc-lite setzt die Platzierungskette in f32
 * zusammen, BEVOR sie ihren RTC-Offset abzieht. Sitzt die `IfcSite` auf einer
 * echten Georeferenz — bei der Nibelungenbrücke
 * `IFCCARTESIANPOINT((32555405.36, 5792521.49, 0.))` — dann rechnet dieser
 * Zwischenschritt bei einer Größenordnung von 3,3e7. Die f32-Auflösung liegt
 * dort bei rund 4 m (und bei 5,8e6 immer noch bei 0,5 m).
 *
 * Die Folge ist nicht bloß Rauschen, sondern Geometrieverlust: alles, was
 * kleiner als das Raster ist, fällt in sich zusammen. Gemessen an dieser
 * Datei — dieselben Bytes, nur die Georeferenz auf null gesetzt:
 *
 *     Dreiecke gezeichnet   87.689  ->  190.039   (Datei: 192.326)
 *     leere Meshes               3  ->        0
 *     Lager 0,37 x 0,37 x 0,22 m   auf eine LINIE kollabiert  ->  korrekt
 *     Pfeilerkopf              1.512 ->    2.268   (Datei: 2.276)
 *
 * Der `sharedRtcOffset`-Parameter von `processAdaptive` hilft hier nicht: er
 * ist auf dem Streaming-Pfad laut Quelltext-TODO gar nicht durchgereicht
 * ("accepted but not yet threaded through to the WASM streaming collector").
 *
 * WAS WIR TUN
 * -----------
 * Wir ziehen die Georeferenz aus dem Byte-Puffer heraus, den NUR der
 * Geometrielauf zu sehen bekommt, und merken uns den entfernten Betrag. Das
 * Dokument selbst (Parser-Session, Export, Mutationen) arbeitet unverändert
 * auf den Originalbytes — hier wird nichts am Modell geändert, nur an der
 * Kopie für die Tessellierung. Der entfernte Betrag fließt in den
 * `originShift` des Viewers zurück, damit Pick-Anzeige, Gizmo-Pivots,
 * Schnittebene und Clip-Box weiter echte IFC-Koordinaten zeigen.
 *
 * Wird die Ursache in @ifc-lite behoben, kann diese Datei ersatzlos
 * entfallen — `rebaseGeoreference` ist dann schlicht ein No-op, weil der
 * Schwellwert nie erreicht wird.
 */

/** Ab dieser Entfernung der Site vom Nullpunkt greifen wir ein (Meter). */
const GEOREF_THRESHOLD_M = 10_000;

export interface GeoreferenceRebase {
  /** Bytes für den Geometrielauf (identisch mit der Eingabe, wenn nichts zu tun war). */
  bytes: Uint8Array;
  /** Entfernter Site-Ursprung in IFC-Koordinaten (Z-up, Dateieinheiten); null = unverändert. */
  removed: { x: number; y: number; z: number } | null;
}

/**
 * RTC-Verschiebung, die die Overlays sehen: der Shift des Geometrie-Laufs,
 * die vor der Tessellierung entfernte Georeferenz und die nachgelagerte
 * Modellverschiebung zusammengefasst — alles im IFC-Rahmen (Z-up), in dem
 * `originShift` laut Vertrag (panes/viewer/worldCoords) angegeben ist.
 *
 * `base` und `removedGeoref` liegen bereits im IFC-Rahmen und werden schlicht
 * addiert. `extraShift` dagegen ist eine Verschiebung im RENDERER-Rahmen
 * (Y-up) und muss umgerechnet werden. Herleitung aus
 * `rendererToIfcPoint(p, s) = (p.x + s.x, −p.z + s.y, p.y + s.z)`:
 * Der Renderer bekommt p' = p − S, der IFC-Punkt soll gleich bleiben, also
 *
 *     s'.x = s.x + S.x      s'.y = s.y − S.z      s'.z = s.z + S.y
 *
 * Damit bleiben Pick-Anzeige, Gizmo-Pivots, Schnittebene und Clip-Box in
 * echten IFC-Koordinaten — die Verschiebungen sind reine Darstellungssache.
 */
export function composeOriginShift(
  base: { x: number; y: number; z: number },
  removedGeoref: { x: number; y: number; z: number } | null,
  extraShift: { x: number; y: number; z: number } | null,
): { x: number; y: number; z: number } {
  const geo = removedGeoref ?? { x: 0, y: 0, z: 0 };
  const s = extraShift ?? { x: 0, y: 0, z: 0 };
  return {
    x: base.x + geo.x + s.x,
    y: base.y + geo.y - s.z,
    z: base.z + geo.z + s.y,
  };
}

/** STEP ist ISO-8859-1 — ein Byte pro Zeichen, Stringindex = Byteoffset. */
const decodeLatin1 = (bytes: Uint8Array): string => {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return out;
};

/** Rohtext einer Entity (`#42=IFCFOO(...)`) inklusive Byteoffsets im Puffer. */
function findEntity(
  step: string,
  id: number,
): { body: string; start: number; end: number } | null {
  const match = new RegExp(`#${id}\\s*=\\s*IFC\\w+\\(([\\s\\S]*?)\\);`).exec(step);
  if (!match) return null;
  const bodyStart = match.index + match[0].indexOf("(") + 1;
  return { body: match[1], start: bodyStart, end: bodyStart + match[1].length };
}

/** Alle `#n`-Verweise eines Entity-Rumpfs in Reihenfolge. */
const refsOf = (body: string): number[] =>
  [...body.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

/** Erster Verweis, dessen Ziel dem Typ entspricht. */
function firstOfType(
  step: string,
  body: string,
  type: string,
): { id: number; entity: { body: string; start: number; end: number } } | null {
  for (const id of refsOf(body)) {
    const entity = findEntity(step, id);
    if (!entity) continue;
    if (new RegExp(`#${id}\\s*=\\s*${type}\\(`).test(step))
      return { id, entity };
  }
  return null;
}

/**
 * Georeferenz der `IfcSite` aus dem Puffer nehmen.
 *
 * Konservativ: Greift nur, wenn die gesamte Kette
 * `IfcSite → IfcLocalPlacement → IfcAxis2Placement3D → IfcCartesianPoint`
 * eindeutig auflösbar ist UND der Ursprung weiter als
 * {@link GEOREF_THRESHOLD_M} vom Nullpunkt liegt. In jedem anderen Fall
 * kommen die Originalbytes unverändert zurück — ein Modell mit gesunden
 * Koordinaten fassen wir nicht an.
 */
export function rebaseGeoreference(bytes: Uint8Array): GeoreferenceRebase {
  const unchanged: GeoreferenceRebase = { bytes, removed: null };
  const step = decodeLatin1(bytes);

  const site = /#(\d+)\s*=\s*IFCSITE\(([\s\S]*?)\);/.exec(step);
  if (!site) return unchanged;

  const placement = firstOfType(step, site[2], "IFCLOCALPLACEMENT");
  if (!placement) return unchanged;
  const axis = firstOfType(step, placement.entity.body, "IFCAXIS2PLACEMENT3D");
  if (!axis) return unchanged;
  const point = firstOfType(step, axis.entity.body, "IFCCARTESIANPOINT");
  if (!point) return unchanged;

  const coords = /^\s*\(\s*([^)]*?)\s*\)\s*$/.exec(point.entity.body);
  if (!coords) return unchanged;
  const values = coords[1].split(",").map((v) => Number(v.trim()));
  if (values.length < 2 || values.some((v) => !Number.isFinite(v)))
    return unchanged;

  const [x, y, z = 0] = values;
  if (Math.hypot(x, y, z) <= GEOREF_THRESHOLD_M) return unchanged;

  // Nur die Zahlen im Rumpf des IfcCartesianPoint ersetzen. Die Ersetzung ist
  // reines ASCII, also ist die Byte-Arithmetik identisch mit der Zeichen-
  // Arithmetik (STEP ist ISO-8859-1).
  const replacement = `(${values.map(() => "0.").join(",")})`;
  const head = bytes.subarray(0, point.entity.start);
  const tail = bytes.subarray(point.entity.end);
  const middle = new Uint8Array(replacement.length);
  for (let i = 0; i < replacement.length; i++) middle[i] = replacement.charCodeAt(i);

  const out = new Uint8Array(head.length + middle.length + tail.length);
  out.set(head, 0);
  out.set(middle, head.length);
  out.set(tail, head.length + middle.length);

  return { bytes: out, removed: { x, y, z } };
}
