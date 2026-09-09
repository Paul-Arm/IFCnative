import { readIfcBytes, toExactArrayBuffer } from "./ifcBytes";

import { IfcImporter } from "@thatopen/fragments";

import { readFragmentCoordination } from "./fragmentCoordination";
import { configureFragmentImporter } from "./fragmentImporter";

import type {
    ConvertIfcToFragmentsWorkerRequest,
    ConvertIfcToFragmentsWorkerResponse,
} from "./fragmentConversionWorker";

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<ConvertIfcToFragmentsWorkerRequest>) => void)
    | null;
  postMessage(
    message: ConvertIfcToFragmentsWorkerResponse,
    transfer?: Transferable[],
  ): void;
};

workerScope.onmessage = (event) => {
  void convertIfcToFragments(event.data);
};

async function convertIfcToFragments(
  request: ConvertIfcToFragmentsWorkerRequest,
) {
  try {
    const importer = new IfcImporter();
    configureFragmentImporter(importer, request.wasmPath);

    let lastProgress = -1;
    const bytes = await readIfcBytes(request);
    const startedAt = performance.now();
    const fragments = await importer.process({
      bytes,
      // Unkomprimiert lassen: Koordinations-Transformation direkt aus dem
      // Flatbuffer lesen; der Viewer lädt mit { raw: true }.
      raw: true,
      progressCallback: (progress, data) => {
        if (progress - lastProgress < 0.03 && progress < 1) {
          return;
        }
        lastProgress = progress;
        workerScope.postMessage({
          ok: "progress",
          progress: {
            fileName: request.fileName,
            process: data.process,
            progress,
            state: data.state,
          },
          requestId: request.requestId,
        });
      },
    });
    const buffer = toExactArrayBuffer(fragments);
    workerScope.postMessage(
      {
        coordination: readFragmentCoordination(fragments),
        elapsedMs: performance.now() - startedAt,
        fragments: buffer,
        ok: true,
        requestId: request.requestId,
      },
      [buffer],
    );
  } catch (error) {
    workerScope.postMessage({
      error: stringifyError(error),
      ok: false,
      requestId: request.requestId,
    });
  }
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { };
