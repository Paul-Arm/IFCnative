import type { FragmentsModel } from "@thatopen/fragments";

import { resolveIfcPublicAssetUrl } from "./fragmentAssets";
import { buildNativeDocumentFromFragments } from "./fragmentDocument";

export interface FragmentIfcSession {
  components: unknown;
  fragments: unknown;
  model: FragmentsModel | null;
  dispose(): Promise<void>;
  exportFrag(raw?: boolean): Promise<ArrayBuffer>;
  loadFrag(
    data: ArrayBuffer | Uint8Array,
    fileName: string,
  ): Promise<FragmentsModel>;
  loadIfc(data: Uint8Array, fileName: string): Promise<FragmentsModel>;
  readDocument(
    fileName?: string,
  ): ReturnType<typeof buildNativeDocumentFromFragments>;
}

export interface CreateFragmentIfcSessionOptions {
  fragmentsWorkerUrl?: string;
  wasmPath?: string;
}

export async function createFragmentIfcSession(
  options: CreateFragmentIfcSessionOptions = {},
): Promise<FragmentIfcSession> {
  const [OBC] = await Promise.all([import("@thatopen/components")]);
  const components = new OBC.Components();
  const fragments = components.get(OBC.FragmentsManager);
  fragments.init(
    options.fragmentsWorkerUrl ??
      resolveIfcPublicAssetUrl("fragments/worker.mjs"),
  );
  const ifcLoader = components.get(OBC.IfcLoader);
  await ifcLoader.setup({
    autoSetWasm: false,
    webIfc: {
      COORDINATE_TO_ORIGIN: true,
    },
    wasm: {
      absolute: true,
      path: options.wasmPath ?? resolveIfcPublicAssetUrl("wasm/"),
    },
  });
  components.init();

  let model: FragmentsModel | null = null;

  async function setModel(nextModel: FragmentsModel) {
    if (model && model !== nextModel) {
      await model.dispose().catch(() => undefined);
    }
    model = nextModel;
    return model;
  }

  return {
    components,
    fragments,
    get model() {
      return model;
    },
    async dispose() {
      if (model) {
        await model.dispose().catch(() => undefined);
        model = null;
      }
      components.dispose();
    },
    async exportFrag(raw = false) {
      if (!model) {
        throw new Error("No fragments model is loaded.");
      }
      return model.getBuffer(raw);
    },
    async loadFrag(data, fileName) {
      const modelId = toFragmentModelId(fileName);
      const nextModel = await fragments.core.load(data, { modelId });
      return setModel(nextModel);
    },
    async loadIfc(data, fileName) {
      const modelId = toFragmentModelId(fileName);
      const nextModel = await ifcLoader.load(data, true, modelId, {
        instanceCallback: (importer) => {
          importer.webIfcSettings = {
            ...importer.webIfcSettings,
            COORDINATE_TO_ORIGIN: true,
          };
          importer.includeRelationNames = true;
          importer.includeUniqueAttributes = true;
          importer.addAllAttributes();
          importer.addAllRelations();
        },
      });
      return setModel(nextModel);
    },
    readDocument(fileName) {
      if (!model) {
        throw new Error("No fragments model is loaded.");
      }
      return buildNativeDocumentFromFragments(model, {
        fileName: fileName ?? `${model.modelId}.frag`,
      });
    },
  };
}

function toFragmentModelId(fileName: string) {
  return (
    fileName
      .replace(/\.(ifc|frag)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "ifcnative-model"
  );
}
