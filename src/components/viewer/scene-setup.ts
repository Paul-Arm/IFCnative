import type { ThreeModule } from "./runtime-shared";

export type ViewerScene = Awaited<ReturnType<typeof createViewerScene>>;

export async function createViewerScene(
  container: HTMLDivElement,
  deps: {
    OBC: typeof import("@thatopen/components");
    THREE: ThreeModule;
  },
) {
  const { OBC, THREE } = deps;
  const components = new OBC.Components();
  const worlds = components.get(OBC.Worlds);
  const world = worlds.create<
    import("@thatopen/components").SimpleScene,
    import("@thatopen/components").SimpleCamera,
    import("@thatopen/components").SimpleRenderer
  >();
  world.scene = new OBC.SimpleScene(components);
  world.scene.setup();
  world.renderer = new OBC.SimpleRenderer(components, container, {
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  world.renderer.showLogo = false;
  world.camera = new OBC.SimpleCamera(components);

  components.init();
  const readViewerBackdrop = () => {
    const value = getComputedStyle(container)
      .getPropertyValue("--viewer-backdrop")
      .trim();
    return value || "#f8fafc";
  };
  world.scene.three.background = new THREE.Color(readViewerBackdrop());
  world.camera.three.near = 0.1;
  world.camera.three.far = 1_000_000;
  world.camera.three.updateProjectionMatrix();
  world.camera.controls.setLookAt(8, 6, 8, 0, 0, 0);

  const grids = components.get(OBC.Grids);
  const grid = grids.create(world);
  const readGridColor = () =>
    new THREE.Color(
      globalThis.document.documentElement.classList.contains("dark")
        ? 0x64748b
        : 0x94a3b8,
    );
  grid.setup({
    color: readGridColor(),
    distance: 1_000,
    primarySize: 1,
    secondarySize: 10,
  });
  // SimpleGrid.setup currently forces visibility to true internally; keep the
  // runtime setting explicit after setup as recommended by the component API.
  grid.config.visible = true;
  grid.fade = world.camera.three instanceof THREE.PerspectiveCamera;
  const themeObserver = new MutationObserver(() => {
    world.scene.three.background = new THREE.Color(readViewerBackdrop());
    grid.config.color = readGridColor();
  });
  const fragments = components.get(OBC.FragmentsManager);
  // Official Fragments workflow: let the installed package resolve its
  // matching worker. Our postinstall patch keeps that worker available
  // locally for the desktop/offline build.
  const fragmentsWorkerUrl = await OBC.FragmentsManager.getWorker();
  fragments.init(fragmentsWorkerUrl);
  // Keep COORDINATE_TO_ORIGIN for float32 precision, but let Fragments place
  // every independently rebased IFC relative to the first loaded model. Picks
  // and native writes still use each model's own coordination matrix below.
  fragments.core.settings.autoCoordinate = true;
  const updateFragmentsOnCamera = () =>
    void fragments.core.update().catch(() => undefined);
  world.camera.controls.addEventListener("update", updateFragmentsOnCamera);
  const handleFragmentModelSet = ({
    value: model,
  }: {
    value: import("@thatopen/fragments").FragmentsModel;
  }) => {
    model.useCamera(world.camera.three);
    world.scene.three.add(model.object);
    void fragments.core.update(true).catch(() => undefined);
  };
  const handleFragmentMaterialSet = ({
    value: material,
  }: {
    value: import("@thatopen/fragments").BIMMaterial;
  }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
      material.needsUpdate = true;
    }
  };
  fragments.list.onItemSet.add(handleFragmentModelSet);
  fragments.core.models.materials.list.onItemSet.add(
    handleFragmentMaterialSet,
  );

  const canvas = world.renderer.three.domElement;

  return {
    canvas,
    components,
    fragments,
    grid,
    handleFragmentMaterialSet,
    handleFragmentModelSet,
    themeObserver,
    updateFragmentsOnCamera,
    world,
  };
}
