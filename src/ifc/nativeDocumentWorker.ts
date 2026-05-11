import { parseNativeIfcText, type NativeIfcDocument } from "./nativeDocument";

export interface ParseNativeIfcWorkerRequest {
  requestId: number;
  file: File;
  fileName: string;
}

export type ParseNativeIfcWorkerResponse =
  | {
      requestId: number;
      ok: true;
      document: NativeIfcDocument;
      bytes: ArrayBuffer;
      elapsedMs: number;
      text: string;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };

export interface ParseNativeIfcFileResult {
  document: NativeIfcDocument;
  bytes: ArrayBuffer;
  elapsedMs: number;
  text: string;
}

let nextRequestId = 0;

export function parseNativeIfcFileInWorker(
  file: File,
  fileName = file.name || "Untitled.ifc",
): Promise<ParseNativeIfcFileResult> {
  if (typeof Worker === "undefined") {
    return parseNativeIfcFileOnMainThread(file, fileName);
  }

  const requestId = nextRequestId + 1;
  nextRequestId = requestId;

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./nativeDocument.worker.ts", import.meta.url),
      {
        name: "ifcnative-parser",
        type: "module",
      },
    );

    const dispose = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
    };

    const handleMessage = (
      event: MessageEvent<ParseNativeIfcWorkerResponse>,
    ) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      dispose();
      if (message.ok) {
        resolve({
          bytes: message.bytes,
          document: message.document,
          elapsedMs: message.elapsedMs,
          text: message.text,
        });
      } else {
        reject(new Error(message.error));
      }
    };

    const handleError = (event: ErrorEvent) => {
      dispose();
      reject(new Error(event.message || "IFC parser worker failed."));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({
      file,
      fileName,
      requestId,
    } satisfies ParseNativeIfcWorkerRequest);
  });
}

async function parseNativeIfcFileOnMainThread(file: File, fileName: string) {
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder().decode(bytes);
  const startedAt = performance.now();
  const document = parseNativeIfcText(text, fileName);
  return {
    bytes,
    document,
    elapsedMs: performance.now() - startedAt,
    text,
  };
}
