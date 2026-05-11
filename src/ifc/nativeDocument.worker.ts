import { parseNativeIfcText } from "./nativeDocument";
import type {
    ParseNativeIfcWorkerRequest,
    ParseNativeIfcWorkerResponse,
} from "./nativeDocumentWorker";

const workerScope = self as unknown as {
  onmessage:
    | ((event: MessageEvent<ParseNativeIfcWorkerRequest>) => void)
    | null;
  postMessage(
    message: ParseNativeIfcWorkerResponse,
    transfer?: Transferable[],
  ): void;
};

workerScope.onmessage = (event) => {
  void parseFile(event.data);
};

async function parseFile({
  file,
  fileName,
  requestId,
}: ParseNativeIfcWorkerRequest) {
  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder().decode(bytes);
    const startedAt = performance.now();
    const document = parseNativeIfcText(text, fileName);
    workerScope.postMessage(
      {
        bytes,
        document,
        elapsedMs: performance.now() - startedAt,
        ok: true,
        requestId,
        text,
      },
      [bytes],
    );
  } catch (error) {
    workerScope.postMessage({
      error: stringifyError(error),
      ok: false,
      requestId,
    });
  }
}

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { };

