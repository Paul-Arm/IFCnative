import { createBodyGeometry } from "../bodyGeometry";
import type { ViewerMirrorOp } from "../that-open-viewer.types";
import type { ThreeModule } from "./runtime-shared";

export type EditableFragmentElementLike = import("@thatopen/fragments").Element;
export type EditableFragmentsLike =
  import("@thatopen/fragments").FragmentsModels;
export type EditableFragmentModelLike =
  import("@thatopen/fragments").FragmentsModel;

/**
 * Synchronisiert die Sichtbarkeit des bearbeiteten Elements zwischen Basis-
 * und Delta-Modell nach dem offiziellen EditElements-Muster. Andere geladene
 * Dokumente bleiben unberührt, weil sich deren localIds überschneiden können.
 */
export async function setFragmentElementVisible(
  fragments: EditableFragmentsLike,
  model: EditableFragmentModelLike,
  element: EditableFragmentElementLike,
  visible: boolean,
) {
  const relatedModelIds = new Set(
    [model.modelId, model.deltaModelId].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const promises: Promise<void>[] = [];
  for (const [modelId, candidate] of fragments.models.list) {
    if (!relatedModelIds.has(modelId)) {
      continue;
    }
    if (visible && candidate.deltaModelId) {
      const editedElements = new Set(await candidate.getEditedElements());
      if (editedElements.has(element.localId)) {
        // Das veraltete Basiselement bleibt verborgen; sein Ersatz liegt im
        // Delta-Modell.
        continue;
      }
    }
    promises.push(candidate.setVisible([element.localId], visible));
  }
  await Promise.all(promises);
}

export async function createFragmentBodyElement(
  fragments: import("@thatopen/fragments").FragmentsModels,
  loaded: {
    model: import("@thatopen/fragments").FragmentsModel;
    ifcWorldToModel: import("three").Matrix4 | null;
  },
  op: Extract<ViewerMirrorOp, { kind: "create-body" }>,
  THREE: ThreeModule,
) {
  const geometry = createBodyGeometry(THREE, op);
  // Neutrales Grau wie unstylte konvertierte Elemente — der Mirror soll
  // nicht wie eine Vorschau aussehen.
  const material = new THREE.MeshLambertMaterial({
    color: 0xc9cdd2,
    side: THREE.DoubleSide,
  });
  // GlobalTransform in IFC-Welt (Viewer-Achsen): geerbte Rotation der
  // Platzierungskette + Position — dann als Ganzes in den rebased
  // Modell-/Szenenraum (die Koordination kann selbst rotieren).
  const globalTransform = new THREE.Matrix4();
  if (op.axes) {
    globalTransform.makeBasis(
      new THREE.Vector3(op.axes.x.x, op.axes.x.y, op.axes.x.z),
      new THREE.Vector3(op.axes.y.x, op.axes.y.y, op.axes.y.z),
      new THREE.Vector3(op.axes.z.x, op.axes.z.y, op.axes.z.z),
    );
  }
  globalTransform.setPosition(op.position.x, op.position.y, op.position.z);
  if (loaded.ifcWorldToModel) {
    globalTransform.premultiply(loaded.ifcWorldToModel);
  }
  try {
    const created = await fragments.editor.createElements(
      loaded.model.modelId,
      [
        {
          attributes: {
            _category: { value: normalizeFragmentCategory(op.category) },
            // GlobalId der nativen Entität, damit die Identität eine
            // Rekonversion überlebt.
            _guid: { value: op.globalId || createFragmentGuid() },
            Name: { value: op.name || "IFCnative Body", type: "IFCLABEL" },
            ObjectType: {
              value: op.tag || "IFCnative Body",
              type: "IFCLABEL",
            },
          },
          globalTransform,
          samples: [
            {
              localTransform: new THREE.Matrix4(),
              material,
              representation: geometry,
            },
          ],
        },
      ],
    );
    return created?.[0] ?? null;
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

export async function replaceFragmentElementGeometry(
  fragments: import("@thatopen/fragments").FragmentsModels,
  model: import("@thatopen/fragments").FragmentsModel,
  localId: number,
  options: {
    profile?: string;
    width: string;
    depth: string;
    height: string;
  },
  THREE: ThreeModule,
) {
  const [element] = await fragments.editor.getElements(model.modelId, [
    localId,
  ]);
  if (!element) {
    return false;
  }
  const meshes = await element.getMeshes();
  const replacement = createBodyGeometry(THREE, options);
  let changedMeshes = 0;
  let disposed = false;
  try {
    meshes.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.geometry.copy(replacement);
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      object.geometry.computeVertexNormals();
      changedMeshes += 1;
    });
    if (!changedMeshes) {
      return false;
    }
    meshes.updateMatrixWorld(true);
    await element.setMeshes(meshes);
    element.disposeMeshes(meshes);
    disposed = true;
    const requests = element.getRequests();
    if (!requests?.length) {
      return false;
    }
    await fragments.editor.edit(model.modelId, requests);
    await setFragmentElementVisible(fragments, model, element, true);
    return true;
  } finally {
    replacement.dispose();
    if (!disposed) {
      element.disposeMeshes(meshes);
    }
  }
}

function normalizeFragmentCategory(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return "IFCBUILDINGELEMENTPROXY";
  }
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

function createFragmentGuid() {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `IFCnative-${uuid}`;
}
