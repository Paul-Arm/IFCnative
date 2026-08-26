export type ViewerWorldDelta = {
  x?: number;
  y?: number;
  z?: number;
};

/**
 * Der Fragments-Viewer arbeitet IMMER in Metern (der Importer skaliert
 * Millimeter-/Fuß-Modelle über den LENGTHUNIT-Faktor). IFC-Placements stehen
 * dagegen in Modelleinheiten. `metersPerUnit` (= getNativeLengthUnitScale)
 * rechnet zwischen beiden Welten um; 1 = Meter-Modell (Standard).
 */
function safeScale(metersPerUnit: number) {
  return Number.isFinite(metersPerUnit) && metersPerUnit > 0
    ? metersPerUnit
    : 1;
}

export function viewerWorldDeltaToIfcPlacementDelta(
  delta: ViewerWorldDelta,
  metersPerUnit = 1,
) {
  const scale = safeScale(metersPerUnit);
  return {
    x: (delta.x ?? 0) / scale,
    y: -(delta.z ?? 0) / scale,
    z: (delta.y ?? 0) / scale,
  };
}

export function viewerWorldPointToIfcPlacementPoint(
  point: ViewerWorldDelta,
  metersPerUnit = 1,
) {
  return viewerWorldDeltaToIfcPlacementDelta(point, metersPerUnit);
}

export function ifcPlacementPointToViewerWorldPoint(
  point: ViewerWorldDelta,
  metersPerUnit = 1,
) {
  const scale = safeScale(metersPerUnit);
  return {
    x: (point.x ?? 0) * scale,
    y: (point.z ?? 0) * scale,
    z: -(point.y ?? 0) * scale,
  };
}

/** Richtungen sind einheitenlos — reiner Achsentausch, keine Skalierung. */
export function viewerWorldDirectionToIfcPlacementDirection(
  direction: ViewerWorldDelta,
) {
  return viewerWorldDeltaToIfcPlacementDelta(direction);
}
