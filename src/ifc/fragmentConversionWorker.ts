export interface ConvertIfcToFragmentsRequest {
  bytes?: ArrayBuffer | null;
  file?: File | null;
  fileName: string;
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
      /**
       * Rebase-Transformation (Welt → Ursprung, Viewer-Achsen/Meter) aus der
       * Konvertierung — siehe FragmentCoordination. null = kein Rebase.
       */
      coordination: number[] | null;
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
  /** UNKOMPRIMIERTE Fragments-Bytes — mit { raw: true } laden. */
  fragments: ArrayBuffer;
  coordination: number[] | null;
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
          coordination: message.coordination,
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
  const [{ IfcImporter }, { readFragmentCoordination }] = await Promise.all([
    import("@thatopen/fragments"),
    import("./fragmentCoordination"),
  ]);
  const importer = new IfcImporter();
  importer.wasm = {
    absolute: true,
    path: request.wasmPath,
  };
  importer.webIfcSettings = {
    // Rebase far-from-origin (georeferenced) models so vertex data stays
    // within float32 precision. The scene stays rebased; the transform is
    // extracted below and used to convert picks/writes to IFC world.
    COORDINATE_TO_ORIGIN: true,
  };
  importer.addAllAttributes();
  importer.addAllRelations();

  const bytes = await readIfcBytes(request);
  const startedAt = performance.now();
  const fragments = await importer.process({
    bytes,
    // Unkomprimiert lassen: die Koordinations-Transformation wird direkt aus
    // dem Flatbuffer gelesen und der Viewer lädt mit { raw: true }.
    raw: true,
    progressCallback: (progress, data) =>
      onProgress?.({
        fileName: request.fileName,
        process: data.process,
        progress,
        state: data.state,
      }),
  });
  return {
    coordination: readFragmentCoordination(fragments),
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

