/**
 * Flächen-Platzierung ("Auf Fläche setzen") für den Körper-Builder.
 *
 * Solange der Modus aktiv ist, wird unter dem Zeiger per Raycast die
 * getroffene Fläche samt Normale ermittelt und ein halbtransparenter Ghost
 * des geplanten Körpers orthogonal auf die Fläche gelegt: Die Höhe (lokale
 * Z-Achse des IFC-Körpers) zeigt entlang der Flächennormale vom Bauteil weg,
 * die Grundfläche sitzt zentriert auf dem Trefferpunkt. Ein Klick bestätigt
 * und meldet Trefferpunkt + Normale (Szenenraum) nach außen; der Workspace
 * legt daraus den echten IFC-Körper an.
 */
import type * as THREEType from "three";
import type { RaycastResult } from "@thatopen/fragments";

import type { NativeBodyProfile } from "@/ifc";

type ThreeModule = typeof import("three");

export interface SurfacePlacementDraft {
  depth: number;
  height: number;
  profile: NativeBodyProfile;
  width: number;
}

export interface SurfacePlacementHit {
  clientX: number;
  clientY: number;
  /** Flächennormale im Szenenraum, zum Betrachter hin orientiert. */
  normal: THREEType.Vector3;
  point: THREEType.Vector3;
  result: RaycastResult;
}

export function createSurfacePlacementTool(
  THREE: ThreeModule,
  options: {
    camera: THREEType.Camera;
    canvas: HTMLCanvasElement;
    container: HTMLElement;
    scene: THREEType.Scene;
  },
  callbacks: {
    onLog(line: string): void;
    onPlace(hit: SurfacePlacementHit): void;
    /** Flächentreffer (mit Normale) unter dem Zeiger, nächster zuerst. */
    raycastFace(
      mouse: { x: number; y: number },
    ): Promise<RaycastResult | null | undefined>;
    requestRender(): void;
  },
) {
  const { camera, canvas, container, scene } = options;
  let draft: SurfacePlacementDraft | null = null;
  let hoverBusy = false;
  let hoverQueued: { x: number; y: number } | null = null;
  let pointerDown: { x: number; y: number } | null = null;
  let disposed = false;
  let lastHit: SurfacePlacementHit | null = null;

  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    depthTest: true,
    opacity: 0.45,
    transparent: true,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0x0ea5e9,
    depthTest: false,
  });
  const normalMaterial = new THREE.LineBasicMaterial({
    color: 0xf97316,
    depthTest: false,
  });
  const ghost = new THREE.Group();
  ghost.name = "IFCnativeSurfacePlacementGhost";
  ghost.visible = false;
  scene.add(ghost);

  const hint = document.createElement("div");
  hint.className = "ifcnative-surface-placement-hint";
  hint.hidden = true;
  container.appendChild(hint);

  const rebuildGhost = () => {
    for (const child of [...ghost.children]) {
      ghost.remove(child);
      (child as THREEType.Mesh).geometry?.dispose();
    }
    if (!draft) {
      return;
    }
    const width = Math.max(draft.width, 0.01);
    const depth = Math.max(draft.depth, 0.01);
    const height = Math.max(draft.height, 0.01);
    // Ghost-Lokalsystem = IFC-Körpersystem: X Breite, Y Tiefe, Z Höhe.
    let geometry: THREEType.BufferGeometry;
    if (draft.profile === "cylinder" || draft.profile === "ellipse") {
      geometry = new THREE.CylinderGeometry(0.5, 0.5, height, 32);
      geometry.rotateX(Math.PI / 2);
      geometry.scale(width, depth, 1);
    } else if (draft.profile === "marker") {
      geometry = new THREE.BoxGeometry(width, depth, height);
    } else {
      geometry = new THREE.BoxGeometry(width, depth, height);
    }
    geometry.translate(0, 0, height / 2);
    const mesh = new THREE.Mesh(geometry, ghostMaterial);
    mesh.renderOrder = 8_000;
    ghost.add(mesh);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      edgeMaterial,
    );
    edges.renderOrder = 8_001;
    ghost.add(edges);
    const normalLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, height * 1.5),
      ]),
      normalMaterial,
    );
    normalLine.renderOrder = 8_002;
    ghost.add(normalLine);
  };

  /**
   * Orientierung aus der Normale: Z = Normale; die Profil-X-Achse bleibt
   * horizontal (Welt-Y ist im Viewer "oben"), bei Decken/Böden Welt-X.
   */
  const orientGhost = (point: THREEType.Vector3, normal: THREEType.Vector3) => {
    const zAxis = normal.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let xAxis: THREEType.Vector3;
    if (Math.abs(zAxis.dot(up)) > 0.95) {
      xAxis = new THREE.Vector3(1, 0, 0);
    } else {
      xAxis = up.clone().cross(zAxis).normalize();
    }
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    ghost.quaternion.setFromRotationMatrix(basis);
    ghost.position.copy(point);
  };

  const positionHint = (clientX: number, clientY: number, text: string) => {
    const rect = canvas.getBoundingClientRect();
    hint.textContent = text;
    hint.style.transform = `translate(${Math.round(clientX - rect.left + 16)}px, ${Math.round(clientY - rect.top + 16)}px)`;
    hint.hidden = false;
  };

  const resolveHit = async (
    clientX: number,
    clientY: number,
  ): Promise<SurfacePlacementHit | null> => {
    const result = await callbacks.raycastFace({ x: clientX, y: clientY });
    if (!result?.point) {
      return null;
    }
    const normal = (result.normal ?? new THREE.Vector3(0, 1, 0)).clone();
    if (normal.lengthSq() < 1e-10) {
      normal.set(0, 1, 0);
    }
    normal.normalize();
    // Zum Betrachter hin orientieren: der Körper soll aus der Fläche heraus
    // wachsen, nicht in das Bauteil hinein.
    const rayDirection = result.ray?.direction
      ? result.ray.direction.clone()
      : result.point.clone().sub(camera.position);
    if (normal.dot(rayDirection) > 0) {
      normal.negate();
    }
    return {
      clientX,
      clientY,
      normal,
      point: result.point.clone(),
      result,
    };
  };

  const runHover = async () => {
    hoverBusy = true;
    try {
      while (hoverQueued && !disposed && draft) {
        const point = hoverQueued;
        hoverQueued = null;
        const hit = await resolveHit(point.x, point.y).catch(() => null);
        if (disposed || !draft) {
          break;
        }
        lastHit = hit;
        if (hit) {
          orientGhost(hit.point, hit.normal);
          ghost.visible = true;
          positionHint(
            point.x,
            point.y,
            `Klick: Körper orthogonal auf Fläche setzen · Normale ${formatVector(hit.normal)}`,
          );
        } else {
          ghost.visible = false;
          positionHint(point.x, point.y, "Fläche im Modell anvisieren");
        }
        callbacks.requestRender();
      }
    } finally {
      hoverBusy = false;
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!draft) {
      return;
    }
    hoverQueued = { x: event.clientX, y: event.clientY };
    if (!hoverBusy) {
      void runHover();
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  };

  const handleClick = (event: MouseEvent) => {
    if (!draft) {
      return;
    }
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
        if (!hit || disposed || !draft) {
          return;
        }
        lastHit = hit;
        callbacks.onPlace(hit);
      })
      .catch((reason) => {
        callbacks.onLog(
          `viewer.surfacePlacement.error(${JSON.stringify(String(reason))});`,
        );
      });
  };

  const handlePointerLeave = () => {
    hoverQueued = null;
    ghost.visible = false;
    hint.hidden = true;
    callbacks.requestRender();
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown, { capture: true });
  canvas.addEventListener("click", handleClick, { capture: true });
  canvas.addEventListener("pointerleave", handlePointerLeave);

  const setDraft = (next: SurfacePlacementDraft | null) => {
    const wasActive = Boolean(draft);
    draft = next;
    rebuildGhost();
    if (!next) {
      ghost.visible = false;
      hint.hidden = true;
      lastHit = null;
    } else if (lastHit) {
      orientGhost(lastHit.point, lastHit.normal);
      ghost.visible = true;
    }
    container.classList.toggle("is-surface-placing", Boolean(next));
    if (wasActive !== Boolean(next)) {
      callbacks.onLog(
        `viewer.surfacePlacement.${next ? "start" : "stop"}(${next ? JSON.stringify(next) : ""});`,
      );
    }
    callbacks.requestRender();
  };

  const dispose = () => {
    disposed = true;
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    canvas.removeEventListener("click", handleClick, { capture: true });
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    draft = null;
    rebuildGhost();
    scene.remove(ghost);
    hint.remove();
    container.classList.remove("is-surface-placing");
    ghostMaterial.dispose();
    edgeMaterial.dispose();
    normalMaterial.dispose();
  };

  return {
    dispose,
    isActive: () => draft !== null,
    setDraft,
  };
}

function formatVector(vector: THREEType.Vector3) {
  return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`;
}

export type SurfacePlacementTool = ReturnType<typeof createSurfacePlacementTool>;
