import type {
  ItemAttribute,
  RawItemData,
  UpdateItemRequest,
} from "@thatopen/fragments";

import { resolveIfcPublicAssetUrl } from "./fragmentAssets";
import { buildNativeDocumentFromFragments } from "./fragmentDocument";
import type { NativeIfcDocument } from "./nativeDocument";

export interface FragmentEntityAttributesEdit {
  description: string;
  localId: number;
  name: string;
  type: string;
}

export interface FragmentEntityEditResult {
  document: NativeIfcDocument;
  elapsedMs: number;
  fragmentsBuffer: ArrayBuffer;
}

export async function updateFragmentEntityAttributes(input: {
  edit: FragmentEntityAttributesEdit;
  fileName: string;
  fragmentsBuffer: ArrayBuffer;
}): Promise<FragmentEntityEditResult> {
  const started = performance.now();
  const { EditRequestType, FragmentsModels } = await import(
    "@thatopen/fragments"
  );
  const fragments = new FragmentsModels(
    resolveIfcPublicAssetUrl("fragments/worker.mjs"),
  );

  try {
    const model = await fragments.load(input.fragmentsBuffer.slice(0), {
      modelId: toFragmentModelId(input.fileName),
    });
    const rawItems = await model.getItems([input.edit.localId]);
    const current = rawItems.get(input.edit.localId);
    if (!current) {
      throw new Error(`Fragments item #${input.edit.localId} was not found.`);
    }

    const nextItem = updateRawItemAttributes(current, input.edit);
    const request: UpdateItemRequest = {
      data: nextItem,
      localId: input.edit.localId,
      type: EditRequestType.UPDATE_ITEM,
    };
    await fragments.editor.edit(model.modelId, [request], { removeRedo: true });
    await fragments.editor.save(model.modelId);
    const savedModel = fragments.models.list.get(model.modelId) ?? model;
    const fragmentsBuffer = await savedModel.getBuffer(false);
    const document = await buildNativeDocumentFromFragments(savedModel, {
      fileName: input.fileName,
    });

    return {
      document,
      elapsedMs: performance.now() - started,
      fragmentsBuffer,
    };
  } finally {
    await fragments.dispose().catch(() => undefined);
  }
}

function updateRawItemAttributes(
  current: RawItemData,
  edit: FragmentEntityAttributesEdit,
): RawItemData {
  const nextData = { ...current.data };
  setStringAttribute(nextData, "Name", edit.name);
  setStringAttribute(nextData, "Description", edit.description);
  return {
    ...current,
    category: normalizeFragmentCategory(edit.type, current.category),
    data: nextData,
  };
}

function setStringAttribute(
  data: Record<string, ItemAttribute>,
  key: string,
  value: string,
) {
  const current = data[key];
  data[key] =
    current && typeof current.type === "string"
      ? { type: current.type, value }
      : { value };
}

function normalizeFragmentCategory(type: string, fallback: string) {
  const normalized = type.trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }
  return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
}

function toFragmentModelId(fileName: string) {
  return (
    fileName
      .replace(/\.(ifc|frag)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "ifcnative-model"
  );
}
