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

const container = ref<HTMLDivElement | null>(null);
const status = ref<"laden" | "fertig" | "fehler">("laden");
const statusText = ref("Lade 3D-Vorschau …");
let dispose: (() => void) | null = null;

const { token } = useAuth();

interface LoadedModel {
  modelId: string;
  object: { visible: boolean };
  getLocalIds(): Promise<number[]>;
}

const loaded = new Map<string, LoadedModel>();
let requestUpdate: (() => void) | null = null;
let fitToItems: ((items?: Record<string, Set<number>>) => Promise<void>) | null =
  null;
let renderNow: (() => HTMLCanvasElement | null) | null = null;

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

defineExpose({ setVisible, focusModel, captureImage });

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
  </div>
</template>
