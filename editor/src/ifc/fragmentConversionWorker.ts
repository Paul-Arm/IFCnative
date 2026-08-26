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

/**
 * Ein geteilter, persistenter Worker statt eines Wegwerf-Workers pro
 * Konvertierung: bei mehreren geladenen IFCs bzw. Rekonvertierungen entfällt
 * so der wiederholte Worker-/Modul-Bootstrap. Nach kurzer Leerlaufzeit wird
 * er beendet, um WASM-/Heap-Speicher freizugeben.
 */
const WORKER_IDLE_TIMEOUT_MS = 30_000;
let sharedWorker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pendingRequests = new Map<
  number,
  {
    onProgress?: (progress: ConvertIfcToFragmentsProgress) => void;
    resolve: (result: ConvertIfcToFragmentsResult) => void;
    reject: (error: Error) => void;
  }
>();

function acquireWorker() {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  if (sharedWorker) {
    return sharedWorker;
  }
  const worker = new Worker(
    new URL("./fragmentConversion.worker.ts", import.meta.url),
    {
      name: "ifcnative-fragment-converter",
      type: "module",
    },
  );
  worker.addEventListener(
    "message",
    (event: MessageEvent<ConvertIfcToFragmentsWorkerResponse>) => {
      const message = event.data;
      const pending = pendingRequests.get(message.requestId);
      if (!pending) {
        return;
      }
      if (message.ok === "progress") {
        pending.onProgress?.(message.progress);
        return;
      }
      pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve({
          coordination: message.coordination,
          elapsedMs: message.elapsedMs,
          fragments: message.fragments,
        });
      } else {
        pending.reject(new Error(message.error));
      }
      releaseWorkerIfIdle();
    },
  );
  worker.addEventListener("error", (event: ErrorEvent) => {
    const error = new Error(
      event.message || "IFC fragment conversion worker failed.",
    );
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
    disposeSharedWorker();
  });
  sharedWorker = worker;
  return worker;
}

function releaseWorkerIfIdle() {
  if (pendingRequests.size > 0 || !sharedWorker) {
    return;
  }
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (pendingRequests.size === 0) {
      disposeSharedWorker();
    }
  }, WORKER_IDLE_TIMEOUT_MS);
}

function disposeSharedWorker() {
  if (idleTimer !== undefined) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  sharedWorker?.terminate();
  sharedWorker = null;
}

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
    const worker = acquireWorker();
    pendingRequests.set(requestId, { onProgress, reject, resolve });
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

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export type {
    ConvertIfcToFragmentsWorkerRequest,
    ConvertIfcToFragmentsWorkerResponse
};

