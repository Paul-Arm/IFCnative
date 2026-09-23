/**
 * GitHub-artige Identicons: 5×5-Raster, links-rechts gespiegelt, Farbe und
 * Muster deterministisch aus einem Schlüssel (User-Id). Kein Upload, keine
 * externen Dienste — und jeder Benutzer ist auf einen Blick erkennbar.
 */

/** 32-Bit-Hash (xmur3) — reicht für Muster + Farbton. */
export function hashString(value: string): number {
  let h = 1779033703 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export interface Identicon {
  /** Belegte Zellen als [x, y] im 5×5-Raster. */
  cells: [number, number][];
  hue: number;
  saturation: number;
  lightness: number;
}

const cache = new Map<string, Identicon>();

export function identicon(key: string): Identicon {
  const cached = cache.get(key);
  if (cached) return cached;
  const a = hashString(key);
  const b = hashString(`${key}:ifc-hub`);
  const cells: [number, number][] = [];
  // 15 Bit Muster: Spalten 0..2, Spalten 3/4 spiegeln 1/0.
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 5; y += 1) {
      if ((a >>> (x * 5 + y)) & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  // Leeres Muster vermeiden — mindestens die Mittelspalte füllen.
  if (!cells.length) {
    for (let y = 1; y < 4; y += 1) cells.push([2, y]);
  }
  const result: Identicon = {
    cells,
    hue: b % 360,
    saturation: 45 + ((b >>> 9) % 25),
    lightness: 48 + ((b >>> 17) % 12),
  };
  cache.set(key, result);
  return result;
}

/** Initialen („Paul Armerling“ → „PA“) als Fallback-Text. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "?").trim().split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
