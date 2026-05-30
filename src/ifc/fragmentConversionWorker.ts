export interface ConvertIfcToFragmentsRequest {
  bytes?: ArrayBuffer | null;
  file?: File | null;
  fileName: string;
  raw?: boolean;
  text?: string;
  wasmPath: string;
}

export interface ConvertIfcToFragmentsProgress {
  fileName: string;
  progress: number;
  process?: string;
  state?: string;
}

interface ConvertIfcToFragmentsWorkerRequest extends ConvertIfcToFragmentsRequest {
  requestId: number;
}

type ConvertIfcToFragmentsWorkerResponse =
  | {
      requestId: number;
      ok: true;
      elapsedMs: number;
      fragments: ArrayBuffer;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    }
  | {
      requestId: number;
      ok: "progress";
      progress: ConvertIfcToFragmentsProgress;
    };

export interface ConvertIfcToFragmentsResult {
  elapsedMs: number;
  fragments: ArrayBuffer;
}

let nextRequestId = 0;

export function convertIfcToFragmentsInWorker(
  request: ConvertIfcToFragmentsRequest,
  onProgress?: (progress: ConvertIfcToFragmentsProgress) => void,
): Promise<ConvertIfcToFragmentsResult> {
  if (typeof Worker === "undefined") {
    return convertIfcToFragmentsOnMainThread(request, onProgress);
  }

  const requestId = nextRequestId + 1;
  nextRequestId = requestId;

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./fragmentConversion.worker.ts", import.meta.url),
      {
        name: "ifcnative-fragment-converter",
        type: "module",
      },
    );

    const dispose = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
    };

    const handleMessage = (
      event: MessageEvent<ConvertIfcToFragmentsWorkerResponse>,
    ) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      if (message.ok === "progress") {
        onProgress?.(message.progress);
        return;
      }
      dispose();
      if (message.ok) {
        resolve({
          elapsedMs: message.elapsedMs,
          fragments: message.fragments,
        });
      } else {
        reject(new Error(message.error));
      }
    };

    const handleError = (event: ErrorEvent) => {
      dispose();
      reject(
        new Error(event.message || "IFC fragment conversion worker failed."),
      );
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({
      ...request,
      requestId,
    } satisfies ConvertIfcToFragmentsWorkerRequest);
  });
}

async function convertIfcToFragmentsOnMainThread(
  request: ConvertIfcToFragmentsRequest,
  onProgress?: (progress: ConvertIfcToFragmentsProgress) => void,
) {
  const { IfcImporter } = await import("@thatopen/fragments");
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

  const bytes = await readIfcBytes(request);
  const startedAt = performance.now();
  const fragments = await importer.process({
    bytes,
    raw: request.raw ?? false,
    progressCallback: (progress, data) =>
      onProgress?.({
        fileName: request.fileName,
        process: data.process,
        progress,
        state: data.state,
      }),
  });
  return {
    elapsedMs: performance.now() - startedAt,
    fragments: toExactArrayBuffer(fragments),
  };
}

async function readIfcBytes(request: ConvertIfcToFragmentsRequest) {
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

export type {
    ConvertIfcToFragmentsWorkerRequest,
    ConvertIfcToFragmentsWorkerResponse
};

