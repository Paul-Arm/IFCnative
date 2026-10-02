/**
 * Orthogonale Platzierung eines Körpers auf einer Fläche.
 *
 * Ein per Raycast gefundener Trefferpunkt liefert die Flächennormale. Der
 * neue Körper soll "orthogonal zur Fläche" stehen: seine Extrusionsachse
 * (lokale Z-Achse des IFC-Körpers, Richtung der Höhe) zeigt entlang der
 * Normale von der Fläche weg, die Grundfläche sitzt auf der Fläche.
 *
 * Alle Vektoren hier liegen in IFC-Weltachsen (Z = oben), wie sie
 * `viewerWorldDirectionToIfcPlacementDirection` liefert.
 */

export interface PlacementVector {
  x: number;
  y: number;
  z: number;
}

export interface PlacementAxes {
  /** Lokale Z-Achse (Extrusionsrichtung) = Flächennormale. */
  axis: PlacementVector;
  /** Lokale X-Achse (Profil-Breite): horizontal, bei Böden/Decken Welt-X. */
  refDirection: PlacementVector;
}

const VERTICAL_DOT_THRESHOLD = 0.95;

function length(vector: PlacementVector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: PlacementVector): PlacementVector | undefined {
  const magnitude = length(vector);
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) {
    return undefined;
  }
  // "|| 0" tilgt -0, damit Vergleiche und STEP-Ausgabe stabil bleiben.
  return {
    x: vector.x / magnitude || 0,
    y: vector.y / magnitude || 0,
    z: vector.z / magnitude || 0,
  };
}

function cross(a: PlacementVector, b: PlacementVector): PlacementVector {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Leitet Axis/RefDirection einer IFCAXIS2PLACEMENT3D aus einer
 * Flächennormale (IFC-Weltachsen) ab. Bei (nahezu) horizontalen Flächen
 * (Normale ±Z) bleibt die Profil-X-Achse auf Welt-X, damit "Breite" wie
 * gewohnt entlang X liegt. Bei Wänden liegt die Profil-X-Achse horizontal in
 * der Wandebene, die Profil-Y-Achse zeigt dann (bis auf das Vorzeichen) nach
 * oben. Undefined bei degenerierter Normale.
 */
export function surfaceNormalToPlacementAxes(
  normal: PlacementVector,
): PlacementAxes | undefined {
  const axis = normalize(normal);
  if (!axis) {
    return undefined;
  }
  const up: PlacementVector = { x: 0, y: 0, z: 1 };
  if (Math.abs(axis.z) > VERTICAL_DOT_THRESHOLD) {
    // Boden/Decke: Profil-X auf Welt-X projizieren (orthogonal zur Achse).
    const projected = normalize({
      x: 1 - axis.x * axis.x,
      y: -axis.x * axis.y,
      z: -axis.x * axis.z,
    }) ?? { x: 1, y: 0, z: 0 };
    return { axis, refDirection: projected };
  }
  const refDirection = normalize(cross(up, axis));
  if (!refDirection) {
    return undefined;
  }
  return { axis, refDirection };
}
