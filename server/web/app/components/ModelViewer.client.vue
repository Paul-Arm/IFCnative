<script setup lang="ts">
// 3D-Vorschau eines Commits: lädt die ThatOpen-Fragments vom Server
// (der beim ersten Abruf konvertiert und cached) und rendert sie mit dem
// ThatOpen-Viewer (@thatopen/components: SimpleScene/-Renderer/-Camera).
const props = defineProps<{ src: string }>();

const container = ref<HTMLDivElement | null>(null);
const status = ref<"laden" | "fertig" | "fehler">("laden");
const statusText = ref("Lade 3D-Vorschau …");
let dispose: (() => void) | null = null;

const { token } = useAuth();

onMounted(async () => {
  try {
    statusText.value =
      "Lade Fragments … (der erste Aufruf konvertiert die IFC auf dem Server)";
    const buffer = await $fetch<ArrayBuffer>(props.src, {
      responseType: "arrayBuffer",
      headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
    });

    statusText.value = "Baue Szene auf …";
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

    const fragments = components.get(OBC.FragmentsManager);
    // Der Worker liegt versionsgleich in public/ (sync-fragments-worker.mjs).
    fragments.init("/fragments/worker.mjs");
    world.camera.controls.addEventListener("update", () => {
      void fragments.core.update().catch(() => undefined);
    });
    fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      void fragments.core.update(true).catch(() => undefined);
    });

    await fragments.core.load(buffer, { modelId: props.src });
    await fragments.core.update(true);
    try {
      await world.camera.fitToItems();
    } catch {
      // Standard-Blickwinkel behalten, wenn das Fitten fehlschlägt.
    }

    dispose = () => components.dispose();
    status.value = "fertig";
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
