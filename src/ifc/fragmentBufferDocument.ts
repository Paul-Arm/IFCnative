import { resolveIfcPublicAssetUrl } from "./fragmentAssets";
import { buildNativeDocumentFromFragments } from "./fragmentDocument";

export interface BuildDocumentFromFragmentBufferResult {
  document: Awaited<ReturnType<typeof buildNativeDocumentFromFragments>>;
  elapsedMs: number;
}

export async function buildDocumentFromFragmentBuffer(
  fragmentsBuffer: ArrayBuffer,
  fileName: string,
): Promise<BuildDocumentFromFragmentBufferResult> {
  const { FragmentsModels } = await import("@thatopen/fragments");
  const fragments = new FragmentsModels(
    resolveIfcPublicAssetUrl("fragments/worker.mjs"),
  );
  const startedAt = performance.now();
  try {
    const model = await fragments.load(fragmentsBuffer.slice(0), {
      modelId: toFragmentModelId(fileName),
    });
    const document = await buildNativeDocumentFromFragments(model, {
      fileName,
    });
    return {
      document,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    await fragments.dispose().catch(() => undefined);
  }
}

function toFragmentModelId(fileName: string) {
  return (
    fileName
      .replace(/\.(ifc|frag)$/i, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "ifcnative-model"
  );
}
