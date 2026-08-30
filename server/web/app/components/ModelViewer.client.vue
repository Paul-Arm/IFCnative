<script setup lang="ts">
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

const props = defineProps<{ sources: ViewerSource[] }>();
const emit = defineEmits<{ (e: "ready"): void }>();

const container = ref<HTMLDivElement | null>(null);
const status = ref<"laden" | "fertig" | "fehler">("laden");
const statusText = ref("Lade 3D-Vorschau …");
let dispose: (() => void) | null = null;

const { token } = useAuth();

interface LoadedModel {
  modelId: string;
  object: { visible: boolean };
  getLocalIds(): Promise<number[]>;
  getLocalIdsByGuids(guids: string[]): Promise<(number | null)[]>;
}

const loaded = new Map<string, LoadedModel>();
let requestUpdate: (() => void) | null = null;
let fitToItems: ((items?: Record<string, Set<number>>) => Promise<void>) | null =
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

/** Kamera auf ein einzelnes Modell fahren. */
async function focusModel(key: string): Promise<void> {
  const model = loaded.get(key);
  if (!model || !fitToItems) return;
  try {
    const ids = await model.getLocalIds();
    await fitToItems({ [model.modelId]: new Set(ids) });
  } catch {
    await fitToItems().catch(() => undefined);
  }
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

/**
 * Markiert die Objekte mit den gegebenen GlobalIds (über alle geladenen
 * Modelle) und fährt die Kamera darauf. Gibt die Zahl der gefundenen
 * Objekte zurück (GUIDs anderer Versionsstände können fehlen).
 */
async function highlightGuids(guids: string[], zoom = true): Promise<number> {
  return (await highlightGuidsImpl?.(guids, zoom)) ?? 0;
}

defineExpose({ setVisible, focusModel, captureImage, highlightGuids });

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

    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    world.scene.three.background = new THREE.Color(dark ? 0x0d1117 : 0xf6f8fa);
    world.camera.three.near = 0.1;
    world.camera.three.far = 1_000_000;
    world.camera.three.updateProjectionMatrix();
    world.camera.controls.setLookAt(12, 9, 12, 0, 0, 0);

    const grids = components.get(OBC.Grids);
    const grid = grids.create(world);
    grid.setup({
      color: new THREE.Color(dark ? 0x30363d : 0xd0d7de),
      distance: 500,
      primarySize: 1,
      secondarySize: 10,
    });

    fitToItems = (items) => world.camera.fitToItems(items);
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
    clearSelection = async () => {
      await fragments.resetHighlight().catch(() => undefined);
      await fragments.core.update(true).catch(() => undefined);
    };

    // GUID-Markierung (Issue-Verortung): rote Hervorhebung + Kamerafahrt.
    const markMaterial = {
      color: new THREE.Color(0xf85149),
      customId: "ifc-hub-issue-mark",
      opacity: 0.95,
      renderedFaces: FRAGS.RenderedFaces.TWO,
      transparent: false,
    };
    highlightGuidsImpl = async (guids, zoom) => {
      const items: Record<string, Set<number>> = {};
      let found = 0;
      for (const model of loaded.values()) {
        try {
          const localIds = await model.getLocalIdsByGuids(guids);
          const set = new Set<number>();
          for (const id of localIds ?? []) {
            if (typeof id === "number") {
              set.add(id);
            }
          }
          if (set.size) {
            items[model.modelId] = set;
            found += set.size;
          }
        } catch {
          // Modell ohne GUID-Index überspringen.
        }
      }
      await fragments.resetHighlight().catch(() => undefined);
      if (found) {
        await fragments.highlight(markMaterial, items).catch(() => undefined);
      }
      await fragments.core.update(true).catch(() => undefined);
      if (found && zoom) {
        await world.camera.fitToItems(items).catch(() => undefined);
      }
      return found;
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
            return;
          }
          const modelId = result.fragments.modelId;
          await fragments.resetHighlight().catch(() => undefined);
          await fragments
            .highlight(selectionMaterial, { [modelId]: new Set([localId]) })
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
        } catch {
          // Auswahl darf den Viewer nie zum Absturz bringen.
        } finally {
          selectionBusy.value = false;
        }
      })();
    });

    const errors: string[] = [];
    let index = 0;
    for (const source of props.sources) {
      index += 1;
      statusText.value =
        props.sources.length === 1
          ? "Lade Fragments … (der erste Aufruf konvertiert die IFC auf dem Server)"
          : `Lade ${source.label ?? "Modell"} (${index}/${props.sources.length}) …`;
      try {
        const buffer = await $fetch<ArrayBuffer>(source.src, {
          responseType: "arrayBuffer",
          headers: token.value
            ? { authorization: `Bearer ${token.value}` }
            : {},
        });
        const model = await fragments.core.load(buffer, { modelId: source.key });
        loaded.set(source.key, model as unknown as LoadedModel);
      } catch (error) {
        errors.push(`${source.label ?? source.key}: ${apiErrorMessage(error)}`);
      }
    }

    await fragments.core.update(true);
    try {
      await world.camera.fitToItems();
    } catch {
      // Standard-Blickwinkel behalten, wenn das Fitten fehlschlägt.
    }

    dispose = () => components.dispose();
    if (loaded.size === 0 && errors.length) {
      status.value = "fehler";
      statusText.value = errors.join(" · ");
    } else {
      if (errors.length) {
        console.warn("3D-Vorschau: Modelle übersprungen:", errors);
      }
      status.value = "fertig";
      emit("ready");
    }
  } catch (error) {
    status.value = "fehler";
    statusText.value = apiErrorMessage(error);
  }
});

onBeforeUnmount(() => {
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
      {{ statusText }}
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
