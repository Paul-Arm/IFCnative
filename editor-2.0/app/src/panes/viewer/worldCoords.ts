/**
 * Koordinatenrahmen-Umrechnung zwischen Renderer-Welt und IFC-Modellwelt.
 *
 * Der Renderer zeichnet in WebGL-Y-up-Weltkoordinaten in METERN — die
 * Tessellation wendet `unit_scale` (store.lengthUnitScale) bereits an und
 * zieht bei Großkoordinaten den RTC-`originShift` ab. Der konstante Swap ist
 * in @ifc-lite dokumentiert (SWAP_ZUP_TO_YUP, instanced-render):
 *
 *     IFC (x, y, z)  →  Renderer (x, z, -y)
 *
 * Umkehrung: IFC.x = r.x, IFC.y = -r.z, IFC.z = r.y. Ein Raycast-Weltpunkt
 * ist deshalb NICHT erneut mit lengthUnitScale zu multiplizieren — der Wert
 * ist schon in Metern; lengthUnitScale greift erst beim Zurückschreiben in
 * Modelleinheiten (toNative in domain/geometry).
 */

export interface WorldVec3 {
  x: number;
  y: number;
  z: number;
}

/** Renderer-Weltpunkt (Y-up, Meter, RTC-verschoben) → IFC-Punkt (Z-up, Meter). */
export function rendererToIfcPoint(p: WorldVec3, shift: WorldVec3): WorldVec3 {
  return { x: p.x + shift.x, y: -p.z + shift.y, z: p.y + shift.z };
}

/** IFC-Punkt (Z-up, Meter) → Renderer-Weltpunkt (Y-up, Meter, RTC-verschoben). */
export function ifcToRendererPoint(p: WorldVec3, shift: WorldVec3): WorldVec3 {
  return { x: p.x - shift.x, y: p.z - shift.z, z: -(p.y - shift.y) };
}

/** Richtungs-/Delta-Variante ohne RTC-Verschiebung (linear, translationsfrei). */
export function rendererToIfcDelta(d: WorldVec3): WorldVec3 {
  return { x: d.x, y: -d.z, z: d.y };
}

/** Richtungs-/Delta-Variante ohne RTC-Verschiebung (linear, translationsfrei). */
export function ifcToRendererDelta(d: WorldVec3): WorldVec3 {
  return { x: d.x, y: d.z, z: -d.y };
}

/** Meterwert deutsch formatiert mit 3 Nachkommastellen („1,235"). */
export function formatMeter(value: number): string {
  // -0,000 vermeiden (entsteht z. B. aus -0.0001 nach dem Runden).
  const rounded = Math.round(value * 1000) / 1000;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(3).replace(".", ",");
}

/** Kompakte Punktanzeige für die Statuszeile: „x / y / z m". */
export function formatPointStatus(p: WorldVec3): string {
  return `${formatMeter(p.x)} / ${formatMeter(p.y)} / ${formatMeter(p.z)} m`;
}

/** Zwischenablage-Format „x; y; z" (Semikolon-getrennt, deutsches Komma). */
export function formatPointClipboard(p: WorldVec3): string {
  return `${formatMeter(p.x)}; ${formatMeter(p.y)}; ${formatMeter(p.z)}`;
}

/** Auf Millimeter runden — verhindert Fließkomma-Müll in STEP-Records. */
export function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}
