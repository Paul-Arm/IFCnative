export type BodyProfilePoint = readonly [number, number];

/**
 * Aufrechte Karten-Pin-Silhouette (wie ein Google-Maps-Marker): Spitze bei
 * (0,0), runder Kopf oben. Die Kontur wird in normierten Pin-Proportionen
 * erzeugt und exakt auf `width` (X) und `height` (Y) skaliert.
 */
export function createPositionMarkerProfile(
  width: number,
  height: number,
): BodyProfilePoint[] {
  // Design-Raum: Kopfradius 0.5, Kopfmitte (0, 0.9), Gesamthöhe 1.4.
  const designHeight = 1.4;
  const headRadius = 0.5;
  const headCenterY = designHeight - headRadius;
  // Tangentialer Übergang von der Spitze in den Kreiskopf.
  const tangent = Math.acos(headRadius / headCenterY);
  const startAngle = -Math.PI / 2 + tangent;
  const endAngle = (3 * Math.PI) / 2 - tangent;
  const segments = 24;

  const designPoints: BodyProfilePoint[] = [[0, 0]];
  let maxDesignX = 0;
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    const x = Math.cos(angle) * headRadius;
    const y = headCenterY + Math.sin(angle) * headRadius;
    maxDesignX = Math.max(maxDesignX, Math.abs(x));
    designPoints.push([x, y]);
  }

  // Exakt auf die gewünschte Bounding-Box skalieren (Samples treffen das
  // Kreismaximum in X nicht exakt, daher über maxDesignX normieren).
  const scaleX = width / 2 / maxDesignX;
  const scaleY = height / designHeight;
  return designPoints.map(([x, y]) => [x * scaleX, y * scaleY]);
}

export function polygonArea(points: ReadonlyArray<BodyProfilePoint>) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}
