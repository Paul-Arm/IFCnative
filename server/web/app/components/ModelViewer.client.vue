<script setup lang="ts">
import { PhCrosshairSimple } from "@phosphor-icons/vue";

// 3D-Vorschau: lädt ThatOpen-Fragments vom Server (der beim ersten Abruf
// konvertiert und cached) und rendert sie mit dem ThatOpen-Viewer.
// Mehrere Quellen landen in EINER Szene (FragmentsManager koordiniert
// georeferenzierte Modelle relativ zum ersten geladenen Modell).
export interface ViewerSource {
  /** stabile Id (Modell- oder Commit-Id) — wird zur Fragments-modelId. */
  key: string;
  src: string;
  label?: string;
}

/** Farbgruppe des 3D-Vergleichs (z. B. "neu" = grün). */
export interface ViewerColorGroup {
  id: string;
  /** 0xRRGGBB */
  color: number;
  guids: string[];
}

const props = defineProps<{ sources: ViewerSource[] }>();
/** Angeklicktes Element (null = ins Leere geklickt). */
export interface ViewerPick {
  globalId: string;
  name: string;
  category: string;
}

const emit = defineEmits<{
  (e: "ready"): void;
  (e: "select", pick: ViewerPick | null): void;
}>();

const container = ref<HTMLDivElement | null>(null);
const status = ref<"laden" | "fertig" | "fehler">("laden");
const statusText = ref("Lade 3D-Vorschau …");
/** Detailzeile unter dem Status (Konvertierungsdauer, Download-Größe). */
const statusDetail = ref<string | null>(null);
/** Download-Fortschritt 0..100, null = unbestimmt. */
const progressPercent = ref<number | null>(null);
/** Einzelne Modelle, die nicht geladen werden konnten (Rest wird gezeigt). */
const skipped = ref<string[]>([]);
/** Status eines nachträglich geladenen Modells (blockiert die Szene nicht). */
const lateStatus = ref<string | null>(null);
let dispose: (() => void) | null = null;
// Bricht Polling/Download ab, wenn die Ansicht verlassen wird.
let abort: AbortController | null = null;

const { token } = useAuth();

// Farbschema der App (nicht nur System): Hintergrund, Raster und Abblend-
// Material folgen einem Umschalten im Benutzermenü ohne Neuladen.
const { resolved: themeResolved } = useTheme();
let applyTheme: ((dark: boolean) => void) | null = null;
watch(themeResolved, (value) => applyTheme?.(value === "dark"));

interface SpatialNode {
  category: string | null;
  localId: number | null;
  children?: SpatialNode[];
}

interface BoxLike {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

interface LoadedModel {
  modelId: string;
  object: { visible: boolean };
  getLocalIds(): Promise<number[]>;
  getLocalIdsByGuids(guids: string[]): Promise<(number | null)[]>;
  getSpatialStructure(): Promise<SpatialNode>;
  getBoxes(localIds?: number[]): Promise<BoxLike[]>;
  /** Gesamtbox des Modells in Szenenkoordinaten. */
  box: BoxLike;
}

const loaded = new Map<string, LoadedModel>();
let requestUpdate: (() => void) | null = null;
let fitToItems: ((items?: Record<string, Set<number>>) => Promise<void>) | null =
  null;
/** Kamera auf den Hauptbereich (eines Modells oder der ganzen Szene). */
let fitMainImpl: ((key?: string, animate?: boolean) => Promise<void>) | null =
  null;
let renderNow: (() => HTMLCanvasElement | null) | null = null;

// ---- Auswahl + Info-Anzeige (Klick auf ein Element) --------------------

interface SelectionProp {
  key: string;
  value: string;
}

interface SelectionPset {
  name: string;
  props: SelectionProp[];
}

interface SelectionInfo {
  modelLabel: string;
  category: string;
  name: string;
  globalId: string;
  localId: number;
  attributes: SelectionProp[];
  psets: SelectionPset[];
}

const selection = ref<SelectionInfo | null>(null);
const selectionBusy = ref(false);
let clearSelection: (() => Promise<void>) | null = null;

async function closeSelection(): Promise<void> {
  selection.value = null;
  await clearSelection?.();
}

/** {value: …}-Attributobjekt der Fragments-ItemsData in Text umwandeln. */
function attrValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return String(raw);
  const value = (raw as { value?: unknown }).value;
  if (value === null || value === undefined || Array.isArray(value)) {
    return null;
  }
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function setVisible(key: string, visible: boolean): void {
  const model = loaded.get(key);
  if (model) {
    model.object.visible = visible;
    requestUpdate?.();
  }
}

/**
 * Kamera auf den Hauptbereich eines Modells fahren — nicht auf dessen
 * Gesamtbox: ein Nullpunktobjekt oder Vermessungspunkt, der Kilometer neben
 * dem Bauwerk liegt, würde das Bauwerk sonst zu einem Punkt schrumpfen.
 */
async function focusModel(key: string): Promise<void> {
  await fitMainImpl?.(key);
}

/** Kamera auf den Hauptbereich der ganzen Szene ("Zentrieren"). */
async function centerView(): Promise<void> {
  await fitMainImpl?.();
}

/** Aktuelle Szene als PNG-DataURL (rendert explizit einen Frame). */
function captureImage(): string | null {
  const canvas = renderNow?.();
  return canvas ? canvas.toDataURL("image/png") : null;
}

// ---- GUID-Verortung: Elemente per GlobalId markieren + anfahren --------

let highlightGuidsImpl:
  | ((guids: string[], zoom: boolean) => Promise<number>)
  | null = null;
let isolateGuidsImpl: ((guids: string[]) => Promise<number>) | null = null;
let showAllImpl: (() => Promise<void>) | null = null;

/**
 * Markiert die Objekte mit den gegebenen GlobalIds (über alle geladenen
 * Modelle) und fährt die Kamera darauf. Gibt die Zahl der gefundenen
 * Objekte zurück (GUIDs anderer Versionsstände können fehlen).
 */
async function highlightGuids(guids: string[], zoom = true): Promise<number> {
  return (await highlightGuidsImpl?.(guids, zoom)) ?? 0;
}

/**
 * Blendet alles außer den Objekten mit den gegebenen GlobalIds aus
 * (ThatOpen Hider.isolate). Gibt die Zahl der gefundenen Objekte zurück;
 * bei 0 bleibt die Szene unverändert sichtbar.
 */
async function isolateGuids(guids: string[]): Promise<number> {
  return (await isolateGuidsImpl?.(guids)) ?? 0;
}

/** Alle Objekte wieder einblenden (nach isolateGuids). */
async function showAll(): Promise<void> {
  await showAllImpl?.();
}

// ---- 3D-Vergleich: Einfärben nach Änderungsstatus -----------------------

let colorizeImpl:
  | ((groups: ViewerColorGroup[], dim: boolean) => Promise<Record<string, number>>)
  | null = null;
let focusGuidsImpl: ((guids: string[]) => Promise<number>) | null = null;
let fitToColoredImpl: (() => Promise<void>) | null = null;
let addSourceImpl:
  | ((source: ViewerSource, onlyGuids?: string[]) => Promise<boolean>)
  | null = null;

/**
 * Färbt die Objekte je Gruppe ein (ersetzt eine frühere Einfärbung) und
 * blendet auf Wunsch alles Übrige transparent ab. Gibt je Gruppe die Zahl
 * der im 3D gefundenen Objekte zurück — Objekte ohne Geometrie fehlen dort.
 */
async function colorize(
  groups: ViewerColorGroup[],
  dim = true,
): Promise<Record<string, number>> {
  return (await colorizeImpl?.(groups, dim)) ?? {};
}

/** Ein Objekt (oder wenige) blau hervorheben und anfahren. */
async function focusGuids(guids: string[]): Promise<number> {
  return (await focusGuidsImpl?.(guids)) ?? 0;
}

/** Kamera auf alle eingefärbten Objekte. */
async function fitToColored(): Promise<void> {
  await fitToColoredImpl?.();
}

/**
 * Lädt nachträglich ein weiteres Modell in die Szene. Mit `onlyGuids` bleibt
 * davon NUR diese Auswahl sichtbar — so zeigt der Vergleich entfernte Objekte
 * aus dem alten Stand, ohne dass sich beide Stände überlagern.
 */
async function addSource(
  source: ViewerSource,
  onlyGuids?: string[],
): Promise<boolean> {
  return (await addSourceImpl?.(source, onlyGuids)) ?? false;
}

defineExpose({
  setVisible,
  focusModel,
  centerView,
  captureImage,
  highlightGuids,
  isolateGuids,
  showAll,
  colorize,
  focusGuids,
  fitToColored,
  addSource,
});

onMounted(async () => {
  try {
    const THREE = await import("three");
    const OBC = await import("@thatopen/components");

    const element = container.value;
    if (!element) return;

    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<
      InstanceType<typeof OBC.SimpleScene>,
      InstanceType<typeof OBC.SimpleCamera>,
      InstanceType<typeof OBC.SimpleRenderer>
    >();
    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.renderer = new OBC.SimpleRenderer(components, element, {
      antialias: true,
      alpha: true,
    });
    world.renderer.showLogo = false;
    world.camera = new OBC.SimpleCamera(components);
    components.init();

    const dark = themeResolved.value === "dark";
    world.scene.three.background = new THREE.Color(dark ? 0x0d1117 : 0xf6f8fa);
    world.camera.three.near = 0.1;
    world.camera.three.far = 1_000_000;
    world.camera.three.updateProjectionMatrix();
    world.camera.controls.setLookAt(12, 9, 12, 0, 0, 0);

    // ---- Bodenraster --------------------------------------------------------
    // Eigenes Raster statt OBC.Grids. Das OBC-Raster (a) blendet fest 500 m um
    // die KAMERA aus — aus 600 m Entfernung auf eine Brücke geschaut ist es
    // weg —, (b) rechnet fract() auf Weltkoordinaten in float32 (flimmert
    // fernab des Ursprungs) und (c) zeichnet 1-m-Zellen auch aus 1 km
    // Entfernung (Moiré). Dieses hier liegt um das Blickziel, skaliert seine
    // Maschenweite mit dem Abstand (weiche Übergänge zwischen 10er-Stufen)
    // und bekommt seine Weltlage als kleinen, in double vorgerechneten Versatz.
    const gridUniforms = {
      uColor: { value: new THREE.Color(dark ? 0x3d444d : 0xc4ccd4) },
      uCenter: { value: new THREE.Vector2() },
      uOffset: { value: new THREE.Vector2() },
      uHeight: { value: 0 },
      uDistance: { value: 500 },
      uSize: { value: 1 },
      uBlend: { value: 0 },
    };
    const gridMaterial = new THREE.ShaderMaterial({
      uniforms: gridUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform vec2 uCenter;
        uniform vec2 uOffset;
        uniform float uHeight;
        uniform float uDistance;
        varying vec2 vRel;
        varying vec2 vGrid;
        void main() {
          vRel = position.xy * uDistance;
          vGrid = vRel + uOffset;
          vec3 world = vec3(vRel.x + uCenter.x, uHeight, vRel.y + uCenter.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uDistance;
        uniform float uSize;
        uniform float uBlend;
        varying vec2 vRel;
        varying vec2 vGrid;
        float gridLine(float size) {
          vec2 r = vGrid / size;
          vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r);
          return 1.0 - min(min(g.x, g.y), 1.0);
        }
        void main() {
          float fade = pow(1.0 - min(length(vRel) / uDistance, 1.0), 2.2);
          float fine = gridLine(uSize) * 0.45 * (1.0 - uBlend);
          float mid = gridLine(uSize * 10.0) * (1.0 - 0.55 * uBlend);
          float coarse = gridLine(uSize * 100.0) * uBlend;
          float alpha = max(max(fine, mid), coarse) * fade;
          if (alpha <= 0.003) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });
    const gridGeometry = new THREE.PlaneGeometry(2, 2);
    const gridMesh = new THREE.Mesh(gridGeometry, gridMaterial);
    gridMesh.frustumCulled = false;
    gridMesh.renderOrder = -1;
    world.scene.three.add(gridMesh);

    // ---- Kamera ---------------------------------------------------------------
    const controls = world.camera.controls;
    /** Hauptbereich der Szene — Bezug für Zoom-Grenzen und Leer-Klicks. */
    let mainSphere: InstanceType<typeof THREE.Sphere> | null = null;

    /**
     * Zoom-/Schwenkgrenzen an die Bauwerksgröße koppeln. OBC setzt fest
     * minDistance = 6 — bei einer 500-m-Brücke ist das zu nah am Ziel
     * "festgenagelt", bei einem Geländer zu weit weg.
     */
    const tuneControls = (radius: number): void => {
      const size = Math.max(radius, 1);
      controls.minDistance = Math.min(2, Math.max(0.15, size * 0.002));
      controls.maxDistance = size * 40;
    };

    /**
     * Entfernung zu dem, was gerade betrachtet wird (Treffer unter dem Cursor,
     * Rest-Zoomweg, Abstand nach einem Fit). Der Orbit-Radius taugt dafür
     * nicht: beim Zoomen wandert das Blickziel mit der Kamera mit.
     */
    let focusDistance = Number.POSITIVE_INFINITY;

    /** Kugel um ALLE geladenen Modelle (inkl. Ausreißer) — Maß für far. */
    let sceneSphere: InstanceType<typeof THREE.Sphere> | null = null;
    const refreshSceneSphere = (): void => {
      const union = new THREE.Box3();
      for (const model of loaded.values()) {
        const { min, max } = model.box;
        if (Number.isFinite(min.x) && Number.isFinite(max.x) && max.x >= min.x) {
          union.expandByPoint(new THREE.Vector3(min.x, min.y, min.z));
          union.expandByPoint(new THREE.Vector3(max.x, max.y, max.z));
        }
      }
      sceneSphere = union.isEmpty()
        ? null
        : union.getBoundingSphere(new THREE.Sphere());
    };

    /**
     * Clip-Ebenen und Raster der Kamera nachführen. Der Tiefenpuffer hat
     * 24 Bit; mit festem near = 0,05 m und far = 50 km (Verhältnis 1:10^6)
     * bleiben auf 300 m Entfernung nur Dezimeter Auflösung — Fahrbahn und
     * Markierung kämpfen dann um denselben Tiefenwert (Flackern). Gekoppelt
     * an den Abstand zum Blickziel bleibt das Verhältnis bei ~1:10^3..10^4.
     */
    const cameraPos = new THREE.Vector3();
    const cameraTarget = new THREE.Vector3();
    const syncView = (): void => {
      const camera = world.camera.three;
      // Kameraposition direkt von der Kamera: controls.getPosition() kennt den
      // Focal-Offset nicht, den setOrbitPoint() setzt.
      cameraPos.copy(camera.position);
      controls.getTarget(cameraTarget);
      const distance = Math.max(
        Math.min(cameraPos.distanceTo(cameraTarget), focusDistance),
        0.01,
      );

      const near = Math.min(5, Math.max(0.05, distance * 0.01));
      const reach = sceneSphere
        ? cameraPos.distanceTo(sceneSphere.center) + sceneSphere.radius
        : 0;
      const far = Math.max(reach, distance * 12, 200) * 1.1;
      if (
        Math.abs(camera.near - near) > near * 0.02 ||
        Math.abs(camera.far - far) > far * 0.02
      ) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }

      // Raster: Maschenweite in 10er-Stufen, dazwischen weich überblendet.
      const level = Math.log10(distance / 6);
      const step = Math.floor(level);
      const size = 10 ** step;
      const coarse = size * 100;
      const mod = (value: number): number => ((value % coarse) + coarse) % coarse;
      gridUniforms.uSize.value = size;
      gridUniforms.uBlend.value = level - step;
      gridUniforms.uDistance.value = Math.max(distance * 10, 40);
      gridUniforms.uCenter.value.set(cameraTarget.x, cameraTarget.z);
      gridUniforms.uOffset.value.set(mod(cameraTarget.x), mod(cameraTarget.z));
    };
    controls.addEventListener("update", syncView);
    syncView();

    /**
     * fitToItems mit passender Mindestdistanz: Kleine Objekte (Seilkopf,
     * Schraube) dürfen nicht an der Mindestdistanz des Gesamtbauwerks hängen.
     */
    fitToItems = async (items) => {
      if (items) {
        const union = new THREE.Box3();
        for (const [modelId, ids] of Object.entries(items)) {
          const model = fragments.list.get(modelId);
          if (!model || !ids.size) continue;
          const box = await model.getMergedBox([...ids]);
          if (!box.isEmpty()) union.union(box);
        }
        if (union.isEmpty()) return;
        const sphere = union.getBoundingSphere(new THREE.Sphere());
        if (sphere.radius > 0) {
          controls.minDistance = Math.min(
            controls.minDistance,
            Math.max(0.05, sphere.radius * 0.5),
          );
        }
        focusDistance = Number.POSITIVE_INFINITY;
        void controls.setFocalOffset(0, 0, 0, true);
        await controls.fitToSphere(sphere, true);
        return;
      }
      await fitMainImpl?.();
    };

    // Direkte Kind-Elemente eines Strukturknotens. Der Fragments-Baum
    // wechselt zwischen Element- (localId) und Kategorie-Knoten (category).
    const childItems = (node: SpatialNode): number[] => {
      const ids: number[] = [];
      const walk = (current: SpatialNode): void => {
        for (const child of current.children ?? []) {
          if (child.localId !== null) {
            ids.push(child.localId);
          } else {
            walk(child);
          }
        }
      };
      walk(node);
      return ids;
    };

    /** Elemente unter dem Knoten mit den MEISTEN Kind-Elementen. */
    const largestGroup = (root: SpatialNode): number[] => {
      let best: number[] = [];
      const visit = (node: SpatialNode, depth: number): void => {
        if (depth > 64) return;
        if (node.localId !== null) {
          const ids = childItems(node);
          if (ids.length > best.length) best = ids;
        }
        for (const child of node.children ?? []) visit(child, depth + 1);
      };
      visit(root, 0);
      return best;
    };

    const BOX_SAMPLE = 4000;
    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };

    /**
     * Kugel + Längsachse des Hauptbereichs. Hauptbereich = die Elemente der
     * größten Gruppe (über die gegebenen Modelle), ohne Ausreißer: Elemente,
     * die weit außerhalb der Masse liegen, zählen nicht zur Ansicht.
     */
    const mainRegion = async (
      models: LoadedModel[],
    ): Promise<{
      corners: InstanceType<typeof THREE.Vector3>[];
      sphere: InstanceType<typeof THREE.Sphere>;
      bottom: number;
      axis: { x: number; z: number } | null;
    } | null> => {
      let bestModel: LoadedModel | null = null;
      let bestIds: number[] = [];
      for (const model of models) {
        try {
          const ids = largestGroup(await model.getSpatialStructure());
          if (ids.length > bestIds.length) {
            bestModel = model;
            bestIds = ids;
          }
        } catch {
          // Modell ohne Strukturbaum — unten greift der Ersatz.
        }
      }
      if (!bestModel || !bestIds.length) {
        // Ersatz: alle Elemente des ersten Modells.
        bestModel = models[0] ?? null;
        bestIds = bestModel ? await bestModel.getLocalIds() : [];
      }
      if (!bestModel || !bestIds.length) return null;

      const stride = Math.max(1, Math.ceil(bestIds.length / BOX_SAMPLE));
      const sample = bestIds.filter((_id, index) => index % stride === 0);
      const boxes = (await bestModel.getBoxes(sample)).filter(
        (box) =>
          Number.isFinite(box.min.x) &&
          Number.isFinite(box.max.x) &&
          box.max.x >= box.min.x,
      );
      if (!boxes.length) return null;

      const centers = boxes.map((box) => ({
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
      }));
      const mid = {
        x: median(centers.map((c) => c.x)),
        y: median(centers.map((c) => c.y)),
        z: median(centers.map((c) => c.z)),
      };
      const distances = centers.map((c) =>
        Math.hypot(c.x - mid.x, c.y - mid.y, c.z - mid.z),
      );
      // Großzügig: eine lange Brücke streut stark, ein Ausreißer liegt um
      // Größenordnungen daneben.
      const limit = Math.max(median(distances) * 6, 1);
      const union = new THREE.Box3();
      const corners: InstanceType<typeof THREE.Vector3>[] = [];
      let sx = 0;
      let sz = 0;
      let sxx = 0;
      let szz = 0;
      let sxz = 0;
      let count = 0;
      boxes.forEach((box, index) => {
        if (distances[index]! > limit) return;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const corner = new THREE.Vector3(x, y, z);
              corners.push(corner);
              union.expandByPoint(corner);
            }
          }
        }
        const c = centers[index]!;
        sx += c.x;
        sz += c.z;
        sxx += c.x * c.x;
        szz += c.z * c.z;
        sxz += c.x * c.z;
        count += 1;
      });
      if (union.isEmpty()) return null;
      const sphere = union.getBoundingSphere(new THREE.Sphere());

      // Längsachse im Grundriss (Hauptkomponente der Elementmitten).
      let axis: { x: number; z: number } | null = null;
      if (count > 2) {
        const cxx = sxx / count - (sx / count) ** 2;
        const czz = szz / count - (sz / count) ** 2;
        const cxz = sxz / count - (sx / count) * (sz / count);
        const angle = 0.5 * Math.atan2(2 * cxz, cxx - czz);
        const major = (cxx + czz) / 2 + Math.hypot((cxx - czz) / 2, cxz);
        const minor = (cxx + czz) / 2 - Math.hypot((cxx - czz) / 2, cxz);
        if (major > Math.max(minor, 1e-9) * 2) {
          axis = { x: Math.cos(angle), z: Math.sin(angle) };
        }
      }
      return { corners, sphere, axis, bottom: union.min.y };
    };

    fitMainImpl = async (key, animate = true) => {
      const models = key
        ? [loaded.get(key)].filter((m): m is LoadedModel => !!m)
        : [...loaded.entries()]
            .filter(([k]) => !partialModels.has(k))
            .map(([, model]) => model);
      if (!models.length) return;
      const region = await mainRegion(models).catch(() => null);
      if (!region) {
        await world.camera.fitToItems().catch(() => undefined);
        return;
      }
      if (!key) {
        mainSphere = region.sphere;
        // Raster auf Höhe der Unterkante des Bauwerks (knapp darunter, damit
        // es nicht mit den Fundamentsohlen um die Tiefe kämpft).
        gridUniforms.uHeight.value =
          region.bottom - Math.max(0.02, region.sphere.radius * 0.0005);
      }
      refreshSceneSphere();
      tuneControls(region.sphere.radius);
      // Blick schräg von der Seite auf die Längsachse (Brücke = Ansicht),
      // leicht erhöht. Ohne klare Achse bleibt die aktuelle Richtung.
      let azimuth = controls.azimuthAngle;
      let polar = controls.polarAngle;
      if (region.axis) {
        const side = { x: -region.axis.z, z: region.axis.x };
        const mix = 0.55; // ~30° aus der reinen Seitenansicht gedreht
        azimuth = Math.atan2(
          side.x + region.axis.x * mix,
          side.z + region.axis.z * mix,
        );
        polar = (64 * Math.PI) / 180;
      }
      // Abstand so, dass alle Eckpunkte des Hauptbereichs in BEIDE Bildwinkel
      // passen. fitToSphere verschenkt bei langen Bauwerken das halbe Bild,
      // fitToBox dreht die Kamera auf die nächste Achse.
      const center = region.sphere.center;
      const offset = new THREE.Vector3(
        Math.sin(azimuth) * Math.sin(polar),
        Math.cos(polar),
        Math.cos(azimuth) * Math.sin(polar),
      );
      const forward = offset.clone().negate();
      const right = new THREE.Vector3()
        .crossVectors(forward, new THREE.Vector3(0, 1, 0))
        .normalize();
      const up = new THREE.Vector3().crossVectors(right, forward);
      const tanV = Math.tan(((world.camera.three.fov ?? 60) * Math.PI) / 360);
      const tanH = tanV * (world.camera.three.aspect || 1);
      let distance = 0;
      const local = new THREE.Vector3();
      for (const corner of region.corners) {
        local.copy(corner).sub(center);
        const needed =
          local.dot(offset) +
          Math.max(
            Math.abs(local.dot(right)) / tanH,
            Math.abs(local.dot(up)) / tanV,
          );
        if (needed > distance) distance = needed;
      }
      distance = Math.max(distance * 1.08, controls.minDistance * 2);
      focusDistance = Number.POSITIVE_INFINITY;
      controls.infinityDolly = true;
      void controls.setFocalOffset(0, 0, 0, animate);
      await controls.setLookAt(
        center.x + offset.x * distance,
        center.y + offset.y * distance,
        center.z + offset.z * distance,
        center.x,
        center.y,
        center.z,
        animate,
      );
    };

    // ---- Zoom/Drehen um die Geometrie unter dem Cursor -------------------------
    // Der eingebaute Zoom von camera-controls bewegt je Rad-Tick einen ANTEIL
    // der Distanz zum Orbit-Punkt. Liegt der fest in der Szenenmitte, geht der
    // Fortschritt beim Hineinzoomen gegen null, obwohl das Bauteil noch 200 m
    // weg ist. Den Orbit-Punkt vor jedem Tick umzusetzen, lässt das Bild
    // springen. Deshalb:
    //
    //  - ZOOM (Mausrad) übernimmt der Viewer selbst: Kamera UND Blickziel
    //    wandern gemeinsam entlang des Strahls durch den Cursor. Das ist eine
    //    reine Verschiebung — Blickrichtung und der Punkt unter dem Cursor
    //    bleiben stehen, die Bewegung ist gedämpft. Schrittweite = Anteil der
    //    Entfernung zur getroffenen Geometrie; davor wird angehalten.
    //  - DREHEN/SCHIEBEN: Beim Drücken der Maustaste wird der Orbit-Punkt auf
    //    den Punkt unter dem Cursor gelegt. setOrbitPoint() gleicht das über
    //    den Focal-Offset aus — die Kamera bleibt dabei exakt stehen.
    const GESTURE_PAUSE_MS = 350;
    const GESTURE_MOVE_PX = 14;
    const ZOOM_STEP = 0.14; // Anteil der Restentfernung je Rad-Raste
    const zoom = {
      active: false,
      aiming: false,
      pendingDelta: 0,
      lastAt: 0,
      x: 0,
      y: 0,
      direction: new THREE.Vector3(),
      /** Entfernung bis zur Geometrie unter dem Cursor (bzw. Ersatzmaß). */
      remaining: 0,
      /** false = ins Leere gezeigt: frei fliegen, nicht anhalten. */
      onGeometry: false,
    };
    const raycaster = new THREE.Raycaster();

    const castAt = (clientX: number, clientY: number) => {
      const canvas = world.renderer?.three.domElement;
      if (!canvas) return Promise.resolve(undefined);
      return fragments
        .raycast({
          camera: world.camera.three,
          dom: canvas,
          mouse: new THREE.Vector2(clientX, clientY),
        })
        .catch(() => undefined);
    };

    const applyZoom = (deltaY: number): void => {
      if (!deltaY) return;
      const notches = Math.max(-4, Math.min(4, deltaY / 100));
      const stop = controls.minDistance * 1.2;
      let step: number;
      if (notches < 0) {
        // hinein
        step = zoom.remaining * (1 - (1 - ZOOM_STEP) ** -notches);
        if (zoom.onGeometry) {
          step = Math.min(step, Math.max(0, zoom.remaining - stop));
        }
      } else {
        // heraus — nicht weiter als die Maximaldistanz vom Hauptbereich
        step = -zoom.remaining * ((1 + ZOOM_STEP) ** notches - 1);
        if (
          mainSphere &&
          world.camera.three.position.distanceTo(mainSphere.center) >
            controls.maxDistance
        ) {
          step = 0;
        }
      }
      if (!step) return;
      zoom.remaining -= step;
      if (!zoom.onGeometry) {
        // Im freien Flug darf die Schrittweite nicht gegen null schrumpfen.
        zoom.remaining = Math.max(zoom.remaining, controls.minDistance * 6);
      }
      focusDistance = zoom.remaining;
      const position = controls.getPosition(new THREE.Vector3());
      const target = controls.getTarget(new THREE.Vector3());
      position.addScaledVector(zoom.direction, step);
      target.addScaledVector(zoom.direction, step);
      void controls.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        true,
      );
    };

    const beginZoom = async (clientX: number, clientY: number): Promise<void> => {
      zoom.aiming = true;
      zoom.active = false;
      zoom.x = clientX;
      zoom.y = clientY;
      try {
        const camera = world.camera.three;
        const canvas = world.renderer?.three.domElement;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        raycaster.setFromCamera(
          new THREE.Vector2(
            ((clientX - rect.left) / rect.width) * 2 - 1,
            -((clientY - rect.top) / rect.height) * 2 + 1,
          ),
          camera,
        );
        zoom.direction.copy(raycaster.ray.direction);
        const hit = await castAt(clientX, clientY);
        if (hit?.point) {
          zoom.onGeometry = true;
          zoom.remaining = hit.point.distanceTo(camera.position);
          // Exakt auf den Treffer zu — nur dann bleibt er unter dem Cursor.
          if (zoom.remaining > 0) {
            zoom.direction
              .copy(hit.point)
              .sub(camera.position)
              .divideScalar(zoom.remaining);
          }
        } else {
          zoom.onGeometry = false;
          const toCenter = mainSphere
            ? mainSphere.center.clone().sub(camera.position)
            : null;
          const along = toCenter ? toCenter.dot(zoom.direction) : 0;
          zoom.remaining = Math.max(
            along > 0 ? along : (toCenter?.length() ?? controls.distance),
            controls.minDistance * 6,
          );
        }
        focusDistance = zoom.remaining;
        zoom.active = true;
      } finally {
        zoom.aiming = false;
        const pending = zoom.pendingDelta;
        zoom.pendingDelta = 0;
        if (zoom.active) applyZoom(pending);
      }
    };

    element.addEventListener(
      "wheel",
      (event) => {
        // Der Viewer zoomt selbst — camera-controls bekommt das Rad nicht.
        event.preventDefault();
        event.stopImmediatePropagation();
        const delta =
          event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
        const now = performance.now();
        const moved =
          Math.hypot(event.clientX - zoom.x, event.clientY - zoom.y) >
          GESTURE_MOVE_PX;
        const fresh = now - zoom.lastAt > GESTURE_PAUSE_MS || moved;
        zoom.lastAt = now;
        if (zoom.aiming) {
          zoom.pendingDelta += delta;
          return;
        }
        if (fresh || !zoom.active) {
          zoom.pendingDelta = delta;
          void beginZoom(event.clientX, event.clientY);
          return;
        }
        applyZoom(delta);
      },
      { capture: true, passive: false },
    );

    let orbitAiming = false;
    element.addEventListener(
      "pointerdown",
      (event) => {
        // Touch: Pinch-Zoom von camera-controls verträgt den Focal-Offset
        // nicht — dort bleibt der Orbit-Punkt, wie er ist.
        if (event.pointerType === "touch" || orbitAiming) return;
        orbitAiming = true;
        zoom.active = false;
        void castAt(event.clientX, event.clientY)
          .then((hit) => {
            if (!hit?.point) return;
            const distance = hit.point.distanceTo(world.camera.three.position);
            if (
              distance < controls.minDistance ||
              distance > controls.maxDistance
            ) {
              return;
            }
            controls.setOrbitPoint(hit.point.x, hit.point.y, hit.point.z);
            focusDistance = distance;
            syncView();
          })
          .finally(() => {
            orbitAiming = false;
          });
      },
      { capture: true },
    );
    renderNow = () => {
      const renderer = world.renderer;
      if (!renderer) return null;
      renderer.three.render(world.scene.three, world.camera.three);
      return renderer.three.domElement;
    };

    const fragments = components.get(OBC.FragmentsManager);
    // Der Worker liegt versionsgleich in public/ (sync-fragments-worker.mjs).
    fragments.init("/fragments/worker.mjs");
    fragments.core.settings.autoCoordinate = true;
    requestUpdate = () => void fragments.core.update(true).catch(() => undefined);
    world.camera.controls.addEventListener("update", () => {
      void fragments.core.update().catch(() => undefined);
    });
    fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      void fragments.core.update(true).catch(() => undefined);
    });

    // ---- Klick-Selektion: raycast -> highlight -> getItemsData ---------
    const FRAGS = await import("@thatopen/fragments");
    const selectionMaterial = {
      color: new THREE.Color(0xffb703),
      customId: "ifc-hub-selection",
      opacity: 0.95,
      renderedFaces: FRAGS.RenderedFaces.TWO,
      transparent: false,
    };
    // Klick-Selektion (gelb) und Issue-Markierung (rot) sind getrennte
    // Highlights: jedes setzt nur seine eigenen Elemente zurück, damit ein
    // Klick ins Leere die Verortung nicht löscht.
    let selectionItems: Record<string, Set<number>> | null = null;
    let markItems: Record<string, Set<number>> | null = null;
    clearSelection = async () => {
      if (selectionItems) {
        await fragments.resetHighlight(selectionItems).catch(() => undefined);
        selectionItems = null;
        await reapplyColors();
      }
      await fragments.core.update(true).catch(() => undefined);
    };

    // ---- 3D-Vergleich ------------------------------------------------------
    // resetHighlight löscht JEDE Hervorhebung eines Elements. Nach dem
    // Zurücksetzen von Klick-/Fokus-Markierungen wird die Vergleichsfärbung
    // deshalb neu aufgetragen.
    type ItemMap = Record<string, Set<number>>;
    const colorState: { material: Record<string, unknown>; items: ItemMap }[] = [];
    let dimItems: ItemMap | null = null;
    let focusItems: ItemMap | null = null;
    /** Modelle, von denen nur eine Auswahl sichtbar ist (alter Stand). */
    const partialModels = new Map<string, number[]>();
    /**
     * Im nachgeladenen alten Stand zählt nur, was davon sichtbar ist —
     * geänderte Objekte gäbe es sonst doppelt (alter + neuer Stand).
     * Gibt die Zahl der verbleibenden Elemente zurück.
     */
    const dropHidden = (items: ItemMap): number => {
      let found = 0;
      for (const [modelId, ids] of Object.entries(items)) {
        const visible = partialModels.get(modelId);
        if (visible) {
          const keep = new Set(visible);
          for (const id of [...ids]) {
            if (!keep.has(id)) ids.delete(id);
          }
        }
        if (ids.size) {
          found += ids.size;
        } else {
          delete items[modelId];
        }
      }
      return found;
    };
    const dimMaterial = {
      color: new THREE.Color(dark ? 0x8b949e : 0x9aa4af),
      customId: "ifc-hub-diff-dim",
      opacity: 0.12,
      renderedFaces: FRAGS.RenderedFaces.TWO,
      transparent: true,
    };
    const focusMaterial = {
      color: new THREE.Color(0x2f81f7),
      customId: "ifc-hub-diff-focus",
      opacity: 1,
      renderedFaces: FRAGS.RenderedFaces.TWO,
      transparent: false,
    };
    const reapplyColors = async (): Promise<void> => {
      if (dimItems) {
        await fragments
          .highlight(dimMaterial as never, dimItems)
          .catch(() => undefined);
      }
      for (const group of colorState) {
        await fragments
          .highlight(group.material as never, group.items)
          .catch(() => undefined);
      }
      if (focusItems) {
        await fragments
          .highlight(focusMaterial as never, focusItems)
          .catch(() => undefined);
      }
    };

    applyTheme = (isDark: boolean) => {
      world.scene.three.background = new THREE.Color(isDark ? 0x0d1117 : 0xf6f8fa);
      gridUniforms.uColor.value.set(isDark ? 0x3d444d : 0xc4ccd4);
      dimMaterial.color.set(isDark ? 0x8b949e : 0x9aa4af);
      if (dimItems) void reapplyColors();
      requestUpdate?.();
    };

    // GUID-Markierung (Issue-Verortung): rote Hervorhebung + Kamerafahrt.
    // GlobalIds -> ModelIdMap übernimmt der FragmentsManager (ThatOpen
    // guidsToModelIdMap, dieselbe Auflösung wie BCF-Viewpoints); leere
    // Modelle werden entfernt, damit fitToItems nicht ins Leere zoomt.
    const markMaterial = {
      color: new THREE.Color(0xf85149),
      customId: "ifc-hub-issue-mark",
      opacity: 0.95,
      renderedFaces: FRAGS.RenderedFaces.TWO,
      transparent: false,
    };
    const hider = components.get(OBC.Hider);
    const resolveGuids = async (
      guids: string[],
    ): Promise<{ items: Record<string, Set<number>>; found: number }> => {
      const items: Record<string, Set<number>> = {};
      let found = 0;
      if (!guids.length) return { items, found };
      try {
        const map = await fragments.guidsToModelIdMap(guids);
        for (const [modelId, set] of Object.entries(map)) {
          if (set.size) {
            items[modelId] = set;
            found += set.size;
          }
        }
      } catch {
        // Modelle ohne GUID-Index — nichts gefunden.
      }
      return { items, found };
    };
    highlightGuidsImpl = async (guids, zoom) => {
      const { items, found } = await resolveGuids(guids);
      if (markItems) {
        await fragments.resetHighlight(markItems).catch(() => undefined);
      }
      markItems = found ? items : null;
      if (found) {
        await fragments.highlight(markMaterial, items).catch(() => undefined);
      }
      await fragments.core.update(true).catch(() => undefined);
      if (found && zoom) {
        await fitToItems?.(items).catch(() => undefined);
      }
      return found;
    };
    isolateGuidsImpl = async (guids) => {
      const { items, found } = await resolveGuids(guids);
      if (found) {
        await hider.isolate(items).catch(() => undefined);
        await fragments.core.update(true).catch(() => undefined);
      }
      return found;
    };
    showAllImpl = async () => {
      await hider.set(true).catch(() => undefined);
      await fragments.core.update(true).catch(() => undefined);
    };

    colorizeImpl = async (groups, dim) => {
      for (const group of colorState) {
        await fragments.resetHighlight(group.items).catch(() => undefined);
      }
      if (dimItems) {
        await fragments.resetHighlight(dimItems).catch(() => undefined);
      }
      colorState.length = 0;
      dimItems = null;
      const counts: Record<string, number> = {};
      const colored = new Map<string, Set<number>>();
      for (const group of groups) {
        const { items } = await resolveGuids(group.guids);
        const found = dropHidden(items);
        counts[group.id] = found;
        if (!found) continue;
        for (const [modelId, ids] of Object.entries(items)) {
          let set = colored.get(modelId);
          if (!set) {
            set = new Set();
            colored.set(modelId, set);
          }
          for (const id of ids) set.add(id);
        }
        colorState.push({
          material: {
            color: new THREE.Color(group.color),
            customId: `ifc-hub-diff-${group.id}`,
            opacity: 1,
            renderedFaces: FRAGS.RenderedFaces.TWO,
            transparent: false,
          },
          items,
        });
      }
      if (dim && colorState.length) {
        const rest: ItemMap = {};
        for (const [key, model] of loaded) {
          const taken = colored.get(model.modelId);
          const candidates = partialModels.get(key) ?? (await model.getLocalIds());
          const ids = candidates.filter((id) => !taken?.has(id));
          if (ids.length) rest[model.modelId] = new Set(ids);
        }
        dimItems = Object.keys(rest).length ? rest : null;
      }
      await reapplyColors();
      await fragments.core.update(true).catch(() => undefined);
      return counts;
    };

    focusGuidsImpl = async (guids) => {
      if (focusItems) {
        await fragments.resetHighlight(focusItems).catch(() => undefined);
        focusItems = null;
        await reapplyColors();
      }
      const { items } = await resolveGuids(guids);
      const found = dropHidden(items);
      if (found) {
        focusItems = items;
        await fragments
          .highlight(focusMaterial as never, items)
          .catch(() => undefined);
        await fitToItems?.(items).catch(() => undefined);
      }
      await fragments.core.update(true).catch(() => undefined);
      return found;
    };

    fitToColoredImpl = async () => {
      const all: ItemMap = {};
      for (const group of colorState) {
        for (const [modelId, ids] of Object.entries(group.items)) {
          const set = (all[modelId] ??= new Set());
          for (const id of ids) set.add(id);
        }
      }
      if (Object.keys(all).length) {
        await fitToItems?.(all).catch(() => undefined);
      }
    };
    const labelByKey = new Map(
      props.sources.map((source) => [source.key, source.label ?? source.key]),
    );

    let pointerDownAt: { x: number; y: number } | null = null;
    element.addEventListener("pointerdown", (event) => {
      pointerDownAt = { x: event.clientX, y: event.clientY };
    });
    element.addEventListener("click", (event) => {
      // Orbit-Drags nicht als Klick werten.
      if (
        pointerDownAt &&
        Math.hypot(
          event.clientX - pointerDownAt.x,
          event.clientY - pointerDownAt.y,
        ) > 4
      ) {
        return;
      }
      void (async () => {
        selectionBusy.value = true;
        try {
          const canvas = world.renderer?.three.domElement;
          if (!canvas) return;
          const result = await fragments.raycast({
            camera: world.camera.three,
            dom: canvas,
            mouse: new THREE.Vector2(event.clientX, event.clientY),
          });
          const localId = result?.localId;
          if (!localId || !Number.isFinite(localId)) {
            await closeSelection();
            emit("select", null);
            return;
          }
          const modelId = result.fragments.modelId;
          if (selectionItems) {
            await fragments.resetHighlight(selectionItems).catch(() => undefined);
            await reapplyColors();
          }
          selectionItems = { [modelId]: new Set([localId]) };
          await fragments
            .highlight(selectionMaterial, selectionItems)
            .catch(() => undefined);
          await fragments.core.update(true).catch(() => undefined);

          const model = fragments.list.get(modelId);
          if (!model) return;
          const [data] = await model.getItemsData([localId], {
            attributesDefault: true,
            relations: {
              IsDefinedBy: { attributes: true, relations: true },
            },
          });
          const record = (data ?? {}) as Record<string, unknown>;

          const attributes: SelectionProp[] = [];
          for (const [key, raw] of Object.entries(record)) {
            if (key.startsWith("_") || key === "GlobalId") continue;
            const value = attrValue(raw);
            if (value !== null) {
              attributes.push({ key, value });
            }
          }

          const psets: SelectionPset[] = [];
          const isDefinedBy = record.IsDefinedBy;
          if (Array.isArray(isDefinedBy)) {
            for (const rawPset of isDefinedBy) {
              const pset = rawPset as Record<string, unknown>;
              const props: SelectionProp[] = [];
              const hasProperties = pset.HasProperties;
              if (Array.isArray(hasProperties)) {
                for (const rawProp of hasProperties) {
                  const prop = rawProp as Record<string, unknown>;
                  const key = attrValue(prop.Name);
                  const value = attrValue(prop.NominalValue);
                  if (key && value !== null) {
                    props.push({ key, value });
                  }
                }
              }
              const name = attrValue(pset.Name);
              if (name && props.length) {
                psets.push({ name, props });
              }
            }
          }

          selection.value = {
            modelLabel: labelByKey.get(modelId) ?? modelId,
            category: attrValue(record._category) ?? "Element",
            name: attrValue(record.Name) ?? "(ohne Name)",
            globalId:
              attrValue(record._guid) ?? attrValue(record.GlobalId) ?? "",
            localId,
            attributes,
            psets,
          };
          emit("select", {
            globalId: selection.value.globalId,
            name: selection.value.name,
            category: selection.value.category,
          });
        } catch {
          // Auswahl darf den Viewer nie zum Absturz bringen.
        } finally {
          selectionBusy.value = false;
        }
      })();
    });

    const errors: string[] = [];
    let index = 0;
    abort = new AbortController();
    for (const source of props.sources) {
      index += 1;
      const prefix =
        props.sources.length === 1
          ? ""
          : `${source.label ?? "Modell"} (${index}/${props.sources.length}): `;
      statusText.value = `${prefix}Lade 3D-Vorschau …`;
      statusDetail.value = null;
      progressPercent.value = null;
      try {
        const buffer = await fetchFragments(source.src, {
          token: token.value,
          signal: abort.signal,
          onProgress: (progress) => {
            if (progress.phase === "converting") {
              statusText.value = `${prefix}Server konvertiert die IFC in Fragments …`;
              statusDetail.value =
                progress.elapsedMs !== undefined
                  ? `läuft seit ${formatElapsed(progress.elapsedMs)} — passiert nur beim ersten Aufruf eines Stands`
                  : "passiert nur beim ersten Aufruf eines Stands";
              progressPercent.value = null;
            } else {
              const received = progress.received ?? 0;
              statusText.value = `${prefix}Lade Fragments …`;
              statusDetail.value = progress.total
                ? `${formatBytes(received)} von ${formatBytes(progress.total)}`
                : formatBytes(received);
              progressPercent.value = progress.total
                ? Math.min(100, Math.round((received / progress.total) * 100))
                : null;
            }
          },
        });
        statusText.value = `${prefix}Baue Szene auf …`;
        statusDetail.value = null;
        progressPercent.value = null;
        const model = await fragments.core.load(buffer, { modelId: source.key });
        loaded.set(source.key, model as unknown as LoadedModel);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        errors.push(`${source.label ?? source.key}: ${apiErrorMessage(error)}`);
      }
    }

    await fragments.core.update(true);
    try {
      await fitMainImpl(undefined, false);
    } catch {
      // Standard-Blickwinkel behalten, wenn das Fitten fehlschlägt.
    }

    addSourceImpl = async (source, onlyGuids) => {
      if (loaded.has(source.key)) return true;
      const label = source.label ?? "Vergleichsstand";
      try {
        const buffer = await fetchFragments(source.src, {
          token: token.value,
          signal: abort?.signal,
          onProgress: (progress) => {
            lateStatus.value =
              progress.phase === "converting"
                ? `${label}: Server konvertiert …`
                : `${label}: lade ${formatBytes(progress.received ?? 0)}`;
          },
        });
        lateStatus.value = `${label}: baue Szene auf …`;
        if (onlyGuids) partialModels.set(source.key, []);
        const model = (await fragments.core.load(buffer, {
          modelId: source.key,
        })) as unknown as LoadedModel;
        loaded.set(source.key, model);
        labelByKey.set(source.key, label);
        refreshSceneSphere();
        syncView();
        if (onlyGuids) {
          const ids = await model.getLocalIds();
          await hider
            .set(false, { [model.modelId]: new Set(ids) })
            .catch(() => undefined);
          const keep = (await model.getLocalIdsByGuids(onlyGuids)).filter(
            (id): id is number => id !== null,
          );
          partialModels.set(source.key, keep);
          if (keep.length) {
            await hider
              .set(true, { [model.modelId]: new Set(keep) })
              .catch(() => undefined);
          }
        }
        await fragments.core.update(true).catch(() => undefined);
        return true;
      } catch (error) {
        if (!isAbortError(error)) {
          skipped.value = [...skipped.value, `${label}: ${apiErrorMessage(error)}`];
        }
        return false;
      } finally {
        lateStatus.value = null;
      }
    };

    dispose = () => {
      gridGeometry.dispose();
      gridMaterial.dispose();
      components.dispose();
    };
    // Diagnose-Zugriff (nur mit localStorage "ifc-hub:debug" = "1").
    try {
      if (localStorage.getItem("ifc-hub:debug") === "1") {
        (window as unknown as Record<string, unknown>).__ifcHubViewer = {
          THREE,
          world,
          fragments,
          controls,
          loaded,
        };
      }
    } catch {
      // ohne localStorage kein Diagnose-Zugriff
    }
    if (loaded.size === 0 && errors.length) {
      status.value = "fehler";
      statusText.value = errors.join(" · ");
      statusDetail.value = null;
    } else {
      if (errors.length) {
        console.warn("3D-Vorschau: Modelle übersprungen:", errors);
        skipped.value = errors;
      }
      status.value = "fertig";
      emit("ready");
    }
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    status.value = "fehler";
    statusText.value = apiErrorMessage(error);
    statusDetail.value = null;
  }
});

onBeforeUnmount(() => {
  applyTheme = null;
  abort?.abort();
  dispose?.();
});
</script>

<template>
  <div class="viewer-wrap">
    <div ref="container" class="viewer-canvas"></div>
    <div
      v-if="status !== 'fertig'"
      class="viewer-overlay"
      :class="{ error: status === 'fehler' }"
    >
      <div class="loading-state center">
        <span
          v-if="status === 'laden'"
          class="spinner large"
          aria-hidden="true"
        />
        <span>{{ statusText }}</span>
        <span v-if="statusDetail" class="muted">{{ statusDetail }}</span>
        <span
          v-if="status === 'laden'"
          class="progress"
          :class="{ indeterminate: progressPercent === null }"
          role="progressbar"
          :aria-valuenow="progressPercent ?? undefined"
        >
          <span :style="{ width: progressPercent === null ? undefined : `${progressPercent}%` }" />
        </span>
      </div>
    </div>
    <div
      v-if="status === 'fertig' && skipped.length"
      class="alert error viewer-skipped"
      role="alert"
    >
      Nicht geladen: {{ skipped.join(" · ") }}
    </div>

    <button
      v-if="status === 'fertig'"
      class="viewer-home"
      type="button"
      title="Zentrieren: Kamera auf den Hauptbereich des Modells"
      @click="centerView"
    >
      <PhCrosshairSimple :size="16" aria-hidden="true" />
    </button>

    <div v-if="lateStatus" class="viewer-late muted small">
      <span class="spinner" aria-hidden="true" />
      {{ lateStatus }}
    </div>

    <!-- Info-Panel zum angeklickten Element -->
    <aside v-if="selection" class="viewer-info">
      <header class="viewer-info-head">
        <span class="badge accent">{{ selection.category }}</span>
        <span class="topbar-spacer" />
        <button class="link" title="Schließen" @click="closeSelection">✕</button>
      </header>
      <div class="viewer-info-body">
        <div class="viewer-info-name">{{ selection.name }}</div>
        <div class="muted small mono">{{ selection.globalId }}</div>
        <div class="muted small">{{ selection.modelLabel }}</div>

        <table v-if="selection.attributes.length" class="viewer-info-table">
          <tbody>
            <tr v-for="attr in selection.attributes" :key="attr.key">
              <td class="muted">{{ attr.key }}</td>
              <td>{{ attr.value }}</td>
            </tr>
          </tbody>
        </table>

        <details
          v-for="pset in selection.psets"
          :key="pset.name"
          class="viewer-info-pset"
          open
        >
          <summary>{{ pset.name }}</summary>
          <table class="viewer-info-table">
            <tbody>
              <tr v-for="prop in pset.props" :key="prop.key">
                <td class="muted">{{ prop.key }}</td>
                <td>{{ prop.value }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>
    </aside>
    <div v-else-if="selectionBusy" class="viewer-info viewer-info-loading muted small">
      Lade Element-Infos …
    </div>
  </div>
</template>
