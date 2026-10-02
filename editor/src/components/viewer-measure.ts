/**
 * Mess-Werkzeug für den ThatOpen-Viewer.
 *
 * Alle Berechnungen laufen im Szenenraum (Viewer-Achsen, Y-up, Meter). Der
 * Szenenraum ist bei georeferenzierten Modellen zum Ursprung rebased — für
 * Längen, Winkel und Deltas spielt das keine Rolle, nur absolute Koordinaten
 * wären falsch (die werden hier nicht angezeigt).
 *
 * Fangen (Snapping) übernimmt der Fragments-Raycast mit snappingClasses:
 * Punkt (Ecke), Kante (nächster Punkt auf der Kante, Kante selbst wird
 * hervorgehoben) und Fläche. Dazu kommen eigene Fanglinien: Achsen-Hilfslinien
 * ab dem ersten Messpunkt (X/Y/Z) sowie die Verlängerung einer zuletzt
 * gefangenen Kante. Umschalt hält die Messung orthogonal (Achsen-Lock).
 */
import type * as THREEType from "three";
import type { RaycastResult, SnappingClass } from "@thatopen/fragments";

type ThreeModule = typeof import("three");
type Vec3 = THREEType.Vector3;

export type MeasureMode = "distance" | "edge" | "angle" | "perpendicular";

export interface MeasureSnapSettings {
  edges: boolean;
  faces: boolean;
  ortho: boolean;
  points: boolean;
}

export interface MeasureToolState {
  count: number;
  mode: MeasureMode | null;
  /** Schritt innerhalb der laufenden Messung (0 = nichts begonnen). */
  step: number;
  snap: MeasureSnapSettings;
}

export interface MeasureToolCallbacks {
  onLog(line: string): void;
  onStateChange(state: MeasureToolState): void;
  /**
   * Alle Fang-Kandidaten unter dem Zeiger (Punkt-/Kanten-/Flächentreffer
   * aller Modelle). Die Auswahl nach Bildschirm-Toleranz trifft das Werkzeug
   * selbst — Fragments liefert Vertex-/Kantenfänge ohne Abstandsgrenze.
   */
  raycastCandidates(
    mouse: { x: number; y: number },
    snappingClasses: SnappingClass[],
  ): Promise<RaycastResult[]>;
  requestRender(): void;
}

interface SnapHit {
  /** "measure" = vorhandener Messpunkt (eigene Messungen als Fangziel). */
  kind: "point" | "edge" | "face" | "guide" | "measure";
  normal?: Vec3;
  point: Vec3;
  edge?: { p1: Vec3; p2: Vec3 };
}

interface Measurement {
  id: number;
  kind: MeasureMode;
  label: HTMLDivElement;
  labelAnchor: Vec3;
  objects: THREEType.Object3D[];
  /** Messpunkte dieser Messung — dienen späteren Messungen als Fangziel. */
  points: Vec3[];
  summary: string;
}

const AXIS_COLORS = { x: 0xef4444, y: 0x16a34a, z: 0x2563eb } as const;
const MEASURE_COLOR = 0xf97316;
const GUIDE_SNAP_PX = 10;
/** Bildschirm-Toleranz, innerhalb derer Ecken bzw. Kanten gefangen werden. */
const POINT_SNAP_PX = 14;
const EDGE_SNAP_PX = 10;
const RENDER_ORDER = 9_000;

export function createMeasureTool(
  THREE: ThreeModule,
  options: {
    camera: THREEType.Camera;
    canvas: HTMLCanvasElement;
    container: HTMLElement;
    scene: THREEType.Scene;
    snappingClasses: { FACE: SnappingClass; LINE: SnappingClass; POINT: SnappingClass };
  },
  callbacks: MeasureToolCallbacks,
) {
  const { camera, canvas, container, scene } = options;
  const SNAP = options.snappingClasses;

  const overlay = document.createElement("div");
  overlay.className = "ifcnative-measure-overlay";
  container.appendChild(overlay);

  const cursorLabel = document.createElement("div");
  cursorLabel.className = "ifcnative-measure-cursor-label";
  cursorLabel.hidden = true;
  overlay.appendChild(cursorLabel);

  const group = new THREE.Group();
  group.name = "IFCnativeMeasurements";
  scene.add(group);

  const previewGroup = new THREE.Group();
  previewGroup.name = "IFCnativeMeasurePreview";
  scene.add(previewGroup);

  const state: MeasureToolState = {
    count: 0,
    mode: null,
    snap: { edges: true, faces: true, ortho: false, points: true },
    step: 0,
  };
  const measurements: Measurement[] = [];
  let nextId = 1;
  /** Punkte der laufenden Messung (Szenenraum). */
  let pending: SnapHit[] = [];
  let hoverHit: SnapHit | null = null;
  let lastEdge: { p1: Vec3; p2: Vec3 } | null = null;
  let shiftHeld = false;
  let pointerDown: { x: number; y: number } | null = null;
  let hoverBusy = false;
  let hoverQueued: { x: number; y: number } | null = null;
  let disposed = false;

  // --- Materialien (geteilt) -------------------------------------------------
  const lineMaterial = new THREE.LineBasicMaterial({
    color: MEASURE_COLOR,
    depthTest: false,
    transparent: true,
  });
  const previewLineMaterial = new THREE.LineBasicMaterial({
    color: MEASURE_COLOR,
    depthTest: false,
    opacity: 0.8,
    transparent: true,
  });
  const guideMaterials = {
    edge: new THREE.LineDashedMaterial({
      color: 0xa855f7,
      dashSize: 0.15,
      depthTest: false,
      gapSize: 0.1,
      transparent: true,
    }),
    x: new THREE.LineDashedMaterial({
      color: AXIS_COLORS.x,
      dashSize: 0.15,
      depthTest: false,
      gapSize: 0.1,
      transparent: true,
    }),
    y: new THREE.LineDashedMaterial({
      color: AXIS_COLORS.y,
      dashSize: 0.15,
      depthTest: false,
      gapSize: 0.1,
      transparent: true,
    }),
    z: new THREE.LineDashedMaterial({
      color: AXIS_COLORS.z,
      dashSize: 0.15,
      depthTest: false,
      gapSize: 0.1,
      transparent: true,
    }),
  };
  const pointMaterial = new THREE.MeshBasicMaterial({
    color: MEASURE_COLOR,
    depthTest: false,
  });
  const snapMaterials = {
    edge: new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      depthTest: false,
      linewidth: 2,
    }),
    face: new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      depthTest: false,
      opacity: 0.9,
      side: THREE.DoubleSide,
      transparent: true,
    }),
    point: new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      depthTest: false,
    }),
    measure: new THREE.MeshBasicMaterial({
      color: MEASURE_COLOR,
      depthTest: false,
    }),
  };
  const sphereGeometry = new THREE.SphereGeometry(1, 16, 12);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const ringGeometry = new THREE.RingGeometry(0.6, 1, 24);

  // --- Hilfsfunktionen --------------------------------------------------------
  const emit = () => {
    state.count = measurements.length;
    state.step = pending.length;
    callbacks.onStateChange({ ...state, snap: { ...state.snap } });
  };

  const markerScale = (point: Vec3) => {
    const distance = camera.position.distanceTo(point);
    return Math.min(Math.max(distance * 0.008, 0.02), 0.6);
  };

  const makeLine = (
    points: Vec3[],
    material: THREEType.LineBasicMaterial | THREEType.LineDashedMaterial,
  ) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, material);
    if (material instanceof THREE.LineDashedMaterial) {
      line.computeLineDistances();
    }
    line.renderOrder = RENDER_ORDER;
    line.frustumCulled = false;
    return line;
  };

  const makePointMarker = (point: Vec3, material = pointMaterial) => {
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.position.copy(point);
    mesh.scale.setScalar(markerScale(point));
    mesh.renderOrder = RENDER_ORDER + 1;
    mesh.userData.measureMarker = true;
    return mesh;
  };

  const makeSnapMarker = (hit: SnapHit) => {
    const scale = markerScale(hit.point) * 1.4;
    if (hit.kind === "measure") {
      // Messpunkt: Würfel auf der Spitze (Raute) in Messfarbe.
      const mesh = new THREE.Mesh(boxGeometry, snapMaterials.measure);
      mesh.position.copy(hit.point);
      mesh.scale.setScalar(scale * 1.5);
      mesh.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      mesh.renderOrder = RENDER_ORDER + 2;
      mesh.userData.measureMarker = true;
      return mesh;
    }
    if (hit.kind === "point") {
      const mesh = new THREE.Mesh(boxGeometry, snapMaterials.point);
      mesh.position.copy(hit.point);
      mesh.scale.setScalar(scale * 1.6);
      mesh.renderOrder = RENDER_ORDER + 2;
      mesh.userData.measureMarker = true;
      return mesh;
    }
    if (hit.kind === "face" && hit.normal) {
      const mesh = new THREE.Mesh(ringGeometry, snapMaterials.face);
      mesh.position.copy(hit.point);
      mesh.scale.setScalar(scale * 1.6);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        hit.normal.clone().normalize(),
      );
      mesh.renderOrder = RENDER_ORDER + 2;
      mesh.userData.measureMarker = true;
      return mesh;
    }
    const mesh = new THREE.Mesh(sphereGeometry, snapMaterials.point);
    mesh.position.copy(hit.point);
    mesh.scale.setScalar(scale);
    mesh.renderOrder = RENDER_ORDER + 2;
    mesh.userData.measureMarker = true;
    return mesh;
  };

  // Canvas-Maße werden pro Frame nur einmal gelesen (getBoundingClientRect
  // erzwingt sonst pro Label ein Layout) und per ResizeObserver erneuert.
  let canvasSize = { height: canvas.clientHeight, width: canvas.clientWidth };
  const sizeObserver = new ResizeObserver(() => {
    canvasSize = { height: canvas.clientHeight, width: canvas.clientWidth };
  });
  sizeObserver.observe(canvas);
  const projectedScratch = new THREE.Vector3();

  const projectToScreen = (point: Vec3) => {
    // Nach einem Kamera-Update sind die Matrizen erst beim Rendern frisch —
    // ohne diesen Aufruf hinkt die Projektion einen Frame hinterher.
    camera.updateMatrixWorld();
    const projected = projectedScratch.copy(point).project(camera);
    return {
      behind: projected.z > 1,
      x: ((projected.x + 1) / 2) * canvasSize.width,
      y: ((1 - projected.y) / 2) * canvasSize.height,
    };
  };

  const clientToLocal = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const formatLength = (meters: number) => `${meters.toFixed(3)} m`;
  /** Kompakte Achsen-Deltas: farbiger Achsbuchstabe + Betrag, eine Zeile. */
  const formatDelta = (delta: Vec3) =>
    `<small class="deltas">` +
    `<span><i class="ax">X</i>${Math.abs(delta.x).toFixed(3)}</span>` +
    `<span><i class="ay">Y</i>${Math.abs(delta.y).toFixed(3)}</span>` +
    `<span><i class="az">Z</i>${Math.abs(delta.z).toFixed(3)}</span>` +
    `</small>`;
  const isExactPoint = (hit: SnapHit) =>
    hit.kind === "point" || hit.kind === "measure";

  const clearPreview = () => {
    for (const child of [...previewGroup.children]) {
      previewGroup.remove(child);
      disposeObject(child);
    }
  };

  const disposeObject = (object: THREEType.Object3D) => {
    const mesh = object as THREEType.Mesh;
    // Geteilte Geometrien/Materialien (Kugel, Box, Ring, Materialien) bleiben
    // erhalten — nur Linien-Geometrien sind pro Objekt erzeugt.
    if (object instanceof THREE.Line) {
      mesh.geometry?.dispose();
    }
  };

  // --- Fanglinien -------------------------------------------------------------
  /**
   * Liefert den (ggf. auf eine Hilfslinie projizierten) Zielpunkt samt der
   * aktiven Hilfslinie. Achsen-Hilfslinien gehen vom ersten Messpunkt aus;
   * die Kantenverlängerung von der zuletzt gefangenen Kante.
   */
  const applyGuides = (
    anchor: Vec3,
    cursor: Vec3,
    clientPoint: { x: number; y: number },
  ): { point: Vec3; guide?: { axis: "x" | "y" | "z" | "edge"; from: Vec3; to: Vec3 } } => {
    const candidates: {
      axis: "x" | "y" | "z" | "edge";
      direction: Vec3;
      origin: Vec3;
    }[] = [
      { axis: "x", direction: new THREE.Vector3(1, 0, 0), origin: anchor },
      { axis: "y", direction: new THREE.Vector3(0, 1, 0), origin: anchor },
      { axis: "z", direction: new THREE.Vector3(0, 0, 1), origin: anchor },
    ];
    if (lastEdge) {
      const direction = lastEdge.p2.clone().sub(lastEdge.p1);
      if (direction.lengthSq() > 1e-10) {
        candidates.push({
          axis: "edge",
          direction: direction.normalize(),
          origin: lastEdge.p1.clone(),
        });
      }
    }
    const delta = cursor.clone().sub(anchor);
    const ortho = state.snap.ortho || shiftHeld;
    let best:
      | { axis: "x" | "y" | "z" | "edge"; point: Vec3; score: number; origin: Vec3 }
      | undefined;
    for (const candidate of candidates) {
      if (candidate.axis === "edge" && ortho) {
        continue;
      }
      const projectedLength = cursor
        .clone()
        .sub(candidate.origin)
        .dot(candidate.direction);
      const projected = candidate.origin
        .clone()
        .addScaledVector(candidate.direction, projectedLength);
      let score: number;
      if (ortho && candidate.axis !== "edge") {
        // Achsen-Lock: dominante Achse der Bewegung gewinnt.
        const component = Math.abs(delta[candidate.axis]);
        score = -component;
      } else {
        const screen = projectToScreen(projected);
        const local = clientToLocal(clientPoint.x, clientPoint.y);
        score = Math.hypot(screen.x - local.x, screen.y - local.y);
        if (score > GUIDE_SNAP_PX) {
          continue;
        }
      }
      if (!best || score < best.score) {
        best = {
          axis: candidate.axis,
          origin: candidate.origin,
          point: projected,
          score,
        };
      }
    }
    if (!best) {
      return { point: cursor };
    }
    return {
      guide: { axis: best.axis, from: best.origin, to: best.point },
      point: best.point,
    };
  };

  // --- Raycast → Snap-Treffer -------------------------------------------------
  const snapClassesForMode = (): SnappingClass[] => {
    const classes: SnappingClass[] = [];
    if (state.mode === "edge") {
      return [SNAP.LINE];
    }
    if (state.mode === "perpendicular" && pending.length === 0) {
      return [SNAP.FACE];
    }
    if (state.snap.points) classes.push(SNAP.POINT);
    if (state.snap.edges) classes.push(SNAP.LINE);
    if (state.snap.faces || classes.length === 0) classes.push(SNAP.FACE);
    return classes;
  };

  const resolveHit = async (
    clientX: number,
    clientY: number,
  ): Promise<SnapHit | null> => {
    const classes = snapClassesForMode();
    const local = clientToLocal(clientX, clientY);
    const screenDistance = (point: Vec3) => {
      const screen = projectToScreen(point);
      return screen.behind
        ? Number.POSITIVE_INFINITY
        : Math.hypot(screen.x - local.x, screen.y - local.y);
    };
    // Vorhandene Messpunkte (fertige Messungen + bereits gesetzte Punkte der
    // laufenden Messung außer dem letzten) haben Vorrang — sie liegen exakt
    // und funktionieren auch über leerem Hintergrund.
    if (state.mode !== "edge" && !(state.mode === "perpendicular" && pending.length === 0)) {
      let best: { distance: number; point: Vec3 } | undefined;
      const candidates = [
        ...measurements.flatMap((entry) => entry.points),
        ...pending.slice(0, -1).map((hit) => hit.point),
      ];
      for (const point of candidates) {
        const distance = screenDistance(point);
        if (distance <= POINT_SNAP_PX && (!best || distance < best.distance)) {
          best = { distance, point };
        }
      }
      if (best) {
        return { kind: "measure", point: best.point.clone() };
      }
    }
    const results = await callbacks.raycastCandidates(
      { x: clientX, y: clientY },
      classes,
    );
    if (!results.length) {
      return null;
    }
    const nearest = (
      candidates: RaycastResult[],
      tolerance: number,
    ): RaycastResult | undefined => {
      let best: { distance: number; result: RaycastResult } | undefined;
      for (const candidate of candidates) {
        if (!candidate.point) continue;
        const distance = screenDistance(candidate.point);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { distance, result: candidate };
        }
      }
      return best?.result;
    };
    const isEdge = (result: RaycastResult) =>
      result.snappingClass === SNAP.LINE &&
      Boolean(result.snappedEdgeP1 && result.snappedEdgeP2);
    const isPoint = (result: RaycastResult) =>
      result.snappingClass === SNAP.POINT;
    // Priorität: Ecke vor Kante vor Fläche — jeweils nur innerhalb der
    // Bildschirm-Toleranz, sonst der nächste Flächentreffer entlang des Strahls.
    if (classes.includes(SNAP.POINT)) {
      const point = nearest(results.filter(isPoint), POINT_SNAP_PX);
      if (point?.point) {
        return { kind: "point", point: point.point.clone() };
      }
    }
    if (classes.includes(SNAP.LINE)) {
      const edge = nearest(results.filter(isEdge), EDGE_SNAP_PX);
      if (edge?.point && edge.snappedEdgeP1 && edge.snappedEdgeP2) {
        return {
          edge: { p1: edge.snappedEdgeP1.clone(), p2: edge.snappedEdgeP2.clone() },
          kind: "edge",
          point: edge.point.clone(),
        };
      }
    }
    const faces = results
      .filter((result) => !isEdge(result) && !isPoint(result) && result.point)
      .sort((a, b) => a.distance - b.distance);
    const face = faces[0];
    if (!face?.point) {
      return null;
    }
    return {
      kind: "face",
      normal: face.normal?.clone(),
      point: face.point.clone(),
    };
  };

  // --- Vorschau ---------------------------------------------------------------
  const renderPreview = (clientX: number, clientY: number) => {
    clearPreview();
    cursorLabel.hidden = true;
    if (!hoverHit || !state.mode) {
      callbacks.requestRender();
      return;
    }
    let target = hoverHit.point.clone();
    let guide: ReturnType<typeof applyGuides>["guide"];
    const anchor =
      state.mode === "distance" && pending.length === 1
        ? pending[0].point
        : state.mode === "angle" && pending.length >= 1
          ? pending[pending.length - 1].point
          : null;
    if (anchor && !isExactPoint(hoverHit)) {
      const guided = applyGuides(anchor, target, { x: clientX, y: clientY });
      target = guided.point;
      guide = guided.guide;
    }
    if (guide) {
      const material = guideMaterials[guide.axis];
      const direction = guide.to.clone().sub(guide.from);
      const length = Math.max(direction.length(), 0.5);
      direction.normalize();
      const extension = length * 0.35 + 0.5;
      previewGroup.add(
        makeLine(
          [
            guide.from.clone().addScaledVector(direction, -extension),
            guide.to.clone().addScaledVector(direction, extension),
          ],
          material,
        ),
      );
      previewGroup.add(makePointMarker(target));
    } else {
      if (hoverHit.kind === "edge" && hoverHit.edge) {
        previewGroup.add(
          makeLine([hoverHit.edge.p1, hoverHit.edge.p2], snapMaterials.edge),
        );
      }
      previewGroup.add(makeSnapMarker(hoverHit));
    }

    let text = "";
    const snapLabel = guide
      ? guide.axis === "edge"
        ? "Kantenverlängerung"
        : `Achse ${guide.axis.toUpperCase()}`
      : hoverHit.kind === "point"
        ? "Ecke"
        : hoverHit.kind === "measure"
          ? "Messpunkt"
          : hoverHit.kind === "edge"
            ? "Kante"
            : "Fläche";
    if (state.mode === "distance" && pending.length === 1) {
      previewGroup.add(makeLine([pending[0].point, target], previewLineMaterial));
      const delta = target.clone().sub(pending[0].point);
      text = `${formatLength(delta.length())}${formatDelta(delta)}`;
    } else if (state.mode === "edge" && hoverHit.edge) {
      text = formatLength(hoverHit.edge.p1.distanceTo(hoverHit.edge.p2));
    } else if (state.mode === "angle" && pending.length >= 1) {
      previewGroup.add(
        makeLine([pending[pending.length - 1].point, target], previewLineMaterial),
      );
      if (pending.length === 2) {
        const angle = angleBetween(pending[0].point, pending[1].point, target);
        text = `${angle.toFixed(2)}°`;
      } else {
        text = "Scheitelpunkt wählen";
      }
    } else if (state.mode === "perpendicular") {
      if (pending.length === 1 && pending[0].normal) {
        const foot = projectOntoPlane(target, pending[0].point, pending[0].normal);
        previewGroup.add(makeLine([target, foot], previewLineMaterial));
        text = `Lot ${formatLength(target.distanceTo(foot))}`;
      } else {
        text = "Bezugsfläche wählen";
      }
    } else {
      text =
        state.mode === "angle"
          ? "Ersten Schenkelpunkt wählen"
          : state.mode === "edge"
            ? "Kante anklicken"
            : "Startpunkt wählen";
    }
    cursorLabel.innerHTML = `<span class="snap">${snapLabel}</span>${text}`;
    const local = clientToLocal(clientX, clientY);
    cursorLabel.style.transform = `translate3d(${(local.x + 16).toFixed(2)}px, ${(local.y + 16).toFixed(2)}px, 0)`;
    cursorLabel.hidden = false;
    callbacks.requestRender();
  };

  // --- Messungen --------------------------------------------------------------
  const addMeasurement = (
    kind: MeasureMode,
    objects: THREEType.Object3D[],
    anchor: Vec3,
    html: string,
    summary: string,
    points: Vec3[],
  ) => {
    const label = document.createElement("div");
    label.className = `ifcnative-measure-label is-${kind}`;
    const id = nextId++;
    label.innerHTML = `<span>${html}</span>`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Messung entfernen";
    remove.setAttribute("aria-label", "Messung entfernen");
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeMeasurement(id);
    });
    label.appendChild(remove);
    overlay.appendChild(label);
    for (const object of objects) {
      group.add(object);
    }
    measurements.push({
      id,
      kind,
      label,
      labelAnchor: anchor,
      objects,
      points: points.map((point) => point.clone()),
      summary,
    });
    callbacks.onLog(
      `viewer.measure.add({ kind: '${kind}', value: ${JSON.stringify(summary)} });`,
    );
    updateLabels();
    emit();
  };

  const removeMeasurement = (id: number) => {
    const index = measurements.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const [entry] = measurements.splice(index, 1);
    entry.label.remove();
    for (const object of entry.objects) {
      group.remove(object);
      disposeObject(object);
    }
    callbacks.onLog(`viewer.measure.remove({ kind: '${entry.kind}' });`);
    callbacks.requestRender();
    emit();
  };

  const finishDistance = (a: Vec3, b: Vec3) => {
    const delta = b.clone().sub(a);
    const length = delta.length();
    addMeasurement(
      "distance",
      [makeLine([a, b], lineMaterial), makePointMarker(a), makePointMarker(b)],
      a.clone().lerp(b, 0.5),
      `${formatLength(length)}${formatDelta(delta)}`,
      `${length.toFixed(3)} m (dx ${delta.x.toFixed(3)}, dy ${delta.y.toFixed(3)}, dz ${delta.z.toFixed(3)})`,
      [a, b],
    );
  };

  const finishEdge = (edge: { p1: Vec3; p2: Vec3 }) => {
    const length = edge.p1.distanceTo(edge.p2);
    addMeasurement(
      "edge",
      [
        makeLine([edge.p1, edge.p2], lineMaterial),
        makePointMarker(edge.p1),
        makePointMarker(edge.p2),
      ],
      edge.p1.clone().lerp(edge.p2, 0.5),
      `Kante ${formatLength(length)}`,
      `${length.toFixed(3)} m`,
      [edge.p1, edge.p2],
    );
  };

  const finishAngle = (a: Vec3, vertex: Vec3, c: Vec3) => {
    const angle = angleBetween(a, vertex, c);
    const legA = a.clone().sub(vertex);
    const legC = c.clone().sub(vertex);
    const radius = Math.min(legA.length(), legC.length()) * 0.35;
    const arcPoints: Vec3[] = [];
    const dirA = legA.clone().normalize();
    const dirC = legC.clone().normalize();
    const segments = 24;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const direction = dirA
        .clone()
        .multiplyScalar(1 - t)
        .add(dirC.clone().multiplyScalar(t));
      if (direction.lengthSq() < 1e-10) {
        direction.copy(dirA);
      }
      arcPoints.push(vertex.clone().addScaledVector(direction.normalize(), radius));
    }
    const bisector = dirA.clone().add(dirC).normalize();
    addMeasurement(
      "angle",
      [
        makeLine([a, vertex, c], lineMaterial),
        makeLine(arcPoints, previewLineMaterial),
        makePointMarker(a),
        makePointMarker(vertex),
        makePointMarker(c),
      ],
      vertex.clone().addScaledVector(bisector, radius * 1.2),
      `${angle.toFixed(2)}°`,
      `${angle.toFixed(2)}°`,
      [a, vertex, c],
    );
  };

  const finishPerpendicular = (
    plane: { normal: Vec3; point: Vec3 },
    point: Vec3,
  ) => {
    const foot = projectOntoPlane(point, plane.point, plane.normal);
    const length = point.distanceTo(foot);
    const footMarker = new THREE.Mesh(ringGeometry, snapMaterials.face);
    footMarker.position.copy(foot);
    footMarker.scale.setScalar(markerScale(foot) * 1.8);
    footMarker.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      plane.normal.clone().normalize(),
    );
    footMarker.renderOrder = RENDER_ORDER + 1;
    footMarker.userData.measureMarker = true;
    addMeasurement(
      "perpendicular",
      [makeLine([point, foot], lineMaterial), makePointMarker(point), footMarker],
      point.clone().lerp(foot, 0.5),
      `Lot ${formatLength(length)}`,
      `${length.toFixed(3)} m`,
      [point, foot],
    );
  };

  const commitPoint = (hit: SnapHit, clientX: number, clientY: number) => {
    if (!state.mode) {
      return;
    }
    if (hit.edge) {
      lastEdge = { p1: hit.edge.p1.clone(), p2: hit.edge.p2.clone() };
    }
    if (state.mode === "edge") {
      if (hit.edge) {
        finishEdge(hit.edge);
      }
      return;
    }
    let target = hit.point.clone();
    const anchor =
      state.mode === "distance" && pending.length === 1
        ? pending[0].point
        : state.mode === "angle" && pending.length >= 1
          ? pending[pending.length - 1].point
          : null;
    if (anchor && !isExactPoint(hit)) {
      target = applyGuides(anchor, target, { x: clientX, y: clientY }).point;
    }
    const committed: SnapHit = { ...hit, point: target };
    if (state.mode === "distance") {
      pending.push(committed);
      if (pending.length === 2) {
        finishDistance(pending[0].point, pending[1].point);
        pending = [];
      }
    } else if (state.mode === "angle") {
      pending.push(committed);
      if (pending.length === 3) {
        finishAngle(pending[0].point, pending[1].point, pending[2].point);
        pending = [];
      }
    } else if (state.mode === "perpendicular") {
      if (pending.length === 0) {
        if (!hit.normal) {
          return;
        }
        pending.push(committed);
      } else {
        const plane = pending[0];
        finishPerpendicular(
          { normal: plane.normal!, point: plane.point },
          committed.point,
        );
        pending = [];
      }
    }
    emit();
  };

  // --- Labels ------------------------------------------------------------------
  const updateLabels = () => {
    if (disposed) {
      return;
    }
    for (const entry of measurements) {
      const screen = projectToScreen(entry.labelAnchor);
      if (entry.label.hidden !== screen.behind) {
        entry.label.hidden = screen.behind;
      }
      // translate3d hält das Label auf einer eigenen Compositor-Ebene; keine
      // Rundung, damit es bei langsamen Kamerafahrten nicht pixelweise springt.
      entry.label.style.transform = `translate(-50%, -50%) translate3d(${screen.x.toFixed(2)}px, ${screen.y.toFixed(2)}px, 0)`;
      for (const object of entry.objects) {
        if (object.userData.measureMarker) {
          const base = markerScale(object.position);
          const isRing = (object as THREEType.Mesh).geometry === ringGeometry;
          object.scale.setScalar(isRing ? base * 1.8 : base);
        }
      }
    }
    for (const child of previewGroup.children) {
      if (child.userData.measureMarker) {
        child.scale.setScalar(markerScale(child.position) * 1.4);
      }
    }
  };

  // --- Eingaben -----------------------------------------------------------------
  const handlePointerMove = (event: PointerEvent) => {
    if (!state.mode) {
      return;
    }
    hoverQueued = { x: event.clientX, y: event.clientY };
    if (hoverBusy) {
      return;
    }
    void runHover();
  };

  const runHover = async () => {
    hoverBusy = true;
    try {
      while (hoverQueued && !disposed && state.mode) {
        const point = hoverQueued;
        hoverQueued = null;
        hoverHit = await resolveHit(point.x, point.y).catch(() => null);
        if (disposed || !state.mode) {
          break;
        }
        renderPreview(point.x, point.y);
      }
    } finally {
      hoverBusy = false;
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  };

  const handleClick = (event: MouseEvent) => {
    if (!state.mode) {
      return;
    }
    // Messklicks dürfen nicht die Auswahl ändern: Capture-Phase + stop.
    event.stopImmediatePropagation();
    event.preventDefault();
    if (pointerDown) {
      const moved = Math.hypot(
        event.clientX - pointerDown.x,
        event.clientY - pointerDown.y,
      );
      pointerDown = null;
      if (moved > 4) {
        return;
      }
    }
    const { clientX, clientY } = event;
    void resolveHit(clientX, clientY)
      .then((hit) => {
        if (disposed) {
          return;
        }
        if (!hit) {
          callbacks.onLog("viewer.measure.clickMiss();");
          return;
        }
        callbacks.onLog(
          `viewer.measure.click({ mode: '${state.mode}', snap: '${hit.kind}', step: ${pending.length} });`,
        );
        commitPoint(hit, clientX, clientY);
        hoverHit = hit;
        renderPreview(clientX, clientY);
      })
      .catch((reason) => {
        callbacks.onLog(`viewer.measure.error(${JSON.stringify(String(reason))});`);
      });
  };

  const handlePointerLeave = () => {
    hoverHit = null;
    hoverQueued = null;
    clearPreview();
    cursorLabel.hidden = true;
    callbacks.requestRender();
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "Shift") {
      shiftHeld = event.type === "keydown";
    }
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown, { capture: true });
  canvas.addEventListener("click", handleClick, { capture: true });
  canvas.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("keydown", handleKey);
  window.addEventListener("keyup", handleKey);

  // --- Öffentliche API ------------------------------------------------------------
  const setMode = (mode: MeasureMode | null) => {
    if (state.mode === mode) {
      return;
    }
    state.mode = mode;
    pending = [];
    hoverHit = null;
    clearPreview();
    cursorLabel.hidden = true;
    container.classList.toggle("is-measuring", Boolean(mode));
    callbacks.onLog(`viewer.measure.mode(${mode ? `'${mode}'` : "null"});`);
    callbacks.requestRender();
    emit();
  };

  /** Esc: laufende Messung verwerfen; ohne laufende Messung Modus beenden. */
  const cancel = () => {
    if (pending.length > 0) {
      pending = [];
      clearPreview();
      cursorLabel.hidden = true;
      callbacks.requestRender();
      emit();
      return true;
    }
    if (state.mode) {
      setMode(null);
      return true;
    }
    return false;
  };

  const removeLast = () => {
    const last = measurements[measurements.length - 1];
    if (last) {
      removeMeasurement(last.id);
    }
  };

  const clearAll = () => {
    for (const entry of [...measurements]) {
      removeMeasurement(entry.id);
    }
    pending = [];
    clearPreview();
    emit();
  };

  const setSnap = (snap: Partial<MeasureSnapSettings>) => {
    state.snap = { ...state.snap, ...snap };
    emit();
  };

  const dispose = () => {
    disposed = true;
    sizeObserver.disconnect();
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    canvas.removeEventListener("click", handleClick, { capture: true });
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("keydown", handleKey);
    window.removeEventListener("keyup", handleKey);
    for (const entry of measurements) {
      entry.label.remove();
      for (const object of entry.objects) {
        disposeObject(object);
      }
    }
    measurements.length = 0;
    clearPreview();
    scene.remove(group, previewGroup);
    overlay.remove();
    container.classList.remove("is-measuring");
    sphereGeometry.dispose();
    boxGeometry.dispose();
    ringGeometry.dispose();
    lineMaterial.dispose();
    previewLineMaterial.dispose();
    pointMaterial.dispose();
    for (const material of Object.values(guideMaterials)) material.dispose();
    for (const material of Object.values(snapMaterials)) material.dispose();
  };

  emit();

  return {
    cancel,
    clearAll,
    dispose,
    getState: () => ({ ...state, snap: { ...state.snap } }),
    isActive: () => state.mode !== null,
    removeLast,
    setMode,
    setSnap,
    updateLabels,
  };

  function angleBetween(a: Vec3, vertex: Vec3, c: Vec3) {
    const legA = a.clone().sub(vertex);
    const legC = c.clone().sub(vertex);
    if (legA.lengthSq() < 1e-12 || legC.lengthSq() < 1e-12) {
      return 0;
    }
    const cos = Math.min(1, Math.max(-1, legA.normalize().dot(legC.normalize())));
    return (Math.acos(cos) * 180) / Math.PI;
  }

  function projectOntoPlane(point: Vec3, planePoint: Vec3, normal: Vec3) {
    const unit = normal.clone().normalize();
    const distance = point.clone().sub(planePoint).dot(unit);
    return point.clone().addScaledVector(unit, -distance);
  }
}

export type MeasureTool = ReturnType<typeof createMeasureTool>;
