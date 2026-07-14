import { createPositionMarkerProfile } from "../ifc/bodyProfiles";

export interface BodyGeometryOptions {
  profile?: string;
  width: string;
  depth: string;
  height: string;
}

/**
 * Builds the immediate Fragments mirror for a body authored in the IFC model.
 * IFC profile X/Y maps to viewer X/-Z; the extrusion axis maps to viewer Y.
 */
export function createBodyGeometry(
  THREE: typeof import("three"),
  options: BodyGeometryOptions,
) {
  const width = readPositiveNumber(options.width, 1);
  const depth = readPositiveNumber(options.depth, width);
  const height = readPositiveNumber(options.height, 1);
  const profile = options.profile?.toLowerCase() ?? "rectangle";

  let geometry: import("three").BufferGeometry;
  if (profile === "cylinder") {
    const radius = Math.max(width, depth) / 2;
    geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
  } else if (profile === "ellipse") {
    geometry = new THREE.CylinderGeometry(0.5, 0.5, height, 48);
    geometry.scale(width, 1, depth);
  } else if (profile === "triangle") {
    geometry = createExtrudedProfileGeometry(
      THREE,
      [
        [-width / 2, -depth / 2],
        [width / 2, -depth / 2],
        [0, depth / 2],
      ],
      height,
    );
  } else if (profile === "marker") {
    // Aufrechter, flacher Karten-Pin: Silhouette in X/Y (Breite × Höhe),
    // dünn extrudiert entlang der Tiefe (Dicke), mittig zentriert.
    const shape = createProfileShape(
      THREE,
      createPositionMarkerProfile(width, height),
    );
    geometry = new THREE.ExtrudeGeometry(shape, {
      bevelEnabled: false,
      curveSegments: 1,
      depth,
      steps: 1,
    });
    // Spitze bleibt nach dem gemeinsamen translate(0, height/2, 0) bei Y=0.
    geometry.translate(0, -height / 2, -depth / 2);
  } else {
    geometry = new THREE.BoxGeometry(width, height, depth);
  }

  // All branches are centered while being built. Move the base to Y=0 so the
  // mirror matches the native IFC extrusion after reconversion.
  geometry.translate(0, height / 2, 0);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createProfileShape(
  THREE: typeof import("three"),
  points: ReadonlyArray<readonly [number, number]>,
) {
  const shape = new THREE.Shape();
  const first = points[0];
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of points.slice(1)) {
    shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function createExtrudedProfileGeometry(
  THREE: typeof import("three"),
  points: ReadonlyArray<readonly [number, number]>,
  height: number,
) {
  const shape = createProfileShape(THREE, points);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: false,
    curveSegments: 1,
    depth: height,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

function readPositiveNumber(
  value: string | number | undefined,
  fallback: number,
) {
  const numeric = Number(
    String(value ?? "")
      .trim()
      .replace(",", "."),
  );
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
