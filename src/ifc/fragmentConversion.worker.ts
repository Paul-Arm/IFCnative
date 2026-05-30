import { IfcImporter } from "@thatopen/fragments";

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
    importer.wasm = {
      absolute: true,
      path: request.wasmPath,
    };
    importer.webIfcSettings = {
      COORDINATE_TO_ORIGIN: true,
    };
    importer.addAllAttributes();
    importer.addAllRelations();

    let lastProgress = -1;
    const bytes = await readIfcBytes(request);
    const startedAt = performance.now();
    const fragments = await importer.process({
      bytes,
      raw: request.raw ?? false,
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

async function readIfcBytes(request: ConvertIfcToFragmentsWorkerRequest) {
  if (request.file) {
    return new Uint8Array(await request.file.arrayBuffer());
  }
  if (request.bytes) {
    return new Uint8Array(request.bytes);
  }
  return new TextEncoder().encode(request.text ?? "");
}

function toExactArrayBuffer(bytes: Uint8Array) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { };

