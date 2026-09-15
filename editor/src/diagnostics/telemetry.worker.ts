import { BrowserClient, defaultStackParser, makeFetchTransport } from "@sentry/browser";
import { version } from "../../package.json";
import { sanitizeTelemetryText, telemetryFileNames } from "./telemetry-sanitize";
import { createTelemetryTransport } from "./telemetry-transport";

type WorkerMessage =
  | { type: "context"; online: boolean; ifcNames: string[] }
  | { type: "error"; message: string; stack: string; source: string };

let online = false;
let ifcNames: string[] = [];
const transport = createTelemetryTransport(() => online);
const client = new BrowserClient({
  dsn: import.meta.env.VITE_IFCNATIVE_SENTRY_DSN,
  release: `ifcnative-web@${version}`,
  environment: import.meta.env.MODE,
  integrations: [],
  stackParser: defaultStackParser,
  sendDefaultPii: false,
  sendClientReports: false,
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  transport: options => makeFetchTransport({ ...options, bufferSize: 4 }, transport.send),
});
client.init();

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const data = event.data;
  if (data.type === "context") {
    online = data.online;
    ifcNames = telemetryFileNames(data.ifcNames);
    return;
  }
  try {
    if (!transport.canSend()) return;
    const source = ["javascript", "react", "unhandledrejection", "application"].includes(data.source) ? data.source : "application";
    client.captureEvent({
      level: "error",
      exception: { values: [{ type: source, value: sanitizeTelemetryText(data.message) }] },
      tags: { source, app_version: version, platform: "web" },
      extra: { stack: sanitizeTelemetryText(data.stack), open_ifc: ifcNames },
    });
  } finally {
    self.postMessage({ type: "handled" });
  }
});
