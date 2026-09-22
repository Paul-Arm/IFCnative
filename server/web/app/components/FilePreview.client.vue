<script setup lang="ts">
/**
 * Vorschau einer versionierten Datei (kind "file"). Die Datei wird mit
 * Auth-Header als Blob geladen und je nach Endung gerendert:
 *  - PDF, Bilder: nativ im Browser (iframe / img)
 *  - DOCX: docx-preview (clientseitig zu HTML, Links entschärft)
 *  - DWG/DXF: @mlightcad/cad-simple-viewer (WebGL-Canvas). Der DWG-Parser
 *    (libredwg, GPL) läuft als Worker aus public/cad/ — siehe
 *    scripts/sync-cad-workers.mjs.
 *  - Textformate: <pre>
 */
import type { AcApDocManager } from "@mlightcad/cad-simple-viewer";
import { PhCornersOut, PhDownloadSimple } from "@phosphor-icons/vue";

const props = defineProps<{
  /** API-URL der Datei (…/commits/:id/file). */
  src: string;
  /** Dateiname — bestimmt die Vorschauart über die Endung. */
  name: string;
}>();

const { token } = useAuth();

type PreviewKind = "pdf" | "image" | "docx" | "cad" | "text" | "none";

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx + 1).toLowerCase();
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const TEXT_EXT = new Set([
  "txt", "csv", "json", "xml", "ids", "py", "log", "yaml", "yml", "ini",
]);
const TEXT_LIMIT = 2 * 1024 * 1024;

const extension = computed(() => extensionOf(props.name));
const kind = computed<PreviewKind>(() => {
  const ext = extension.value;
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "dwg" || ext === "dxf") return "cad";
  if (IMAGE_EXT.has(ext)) return "image";
  if (TEXT_EXT.has(ext)) return "text";
  return "none";
});

const status = ref<"loading" | "ready" | "error">("loading");
const stage = ref("Lade Datei …");
const error = ref<string | null>(null);
const blobUrl = ref<string | null>(null);
const textContent = ref<string | null>(null);
const docxTarget = ref<HTMLDivElement | null>(null);
const cadTarget = ref<HTMLDivElement | null>(null);

/** Der CAD-Viewer ist ein Singleton — pro Seite gibt es nur eine Instanz. */
let cadManager: AcApDocManager | null = null;

/**
 * Zählt Ladevorgänge: Ein veralteter Lauf (neue src oder Unmount während
 * des Ladens) verwirft sein Ergebnis, statt Blob-URLs oder Viewer zu leaken.
 */
let generation = 0;

function revoke(): void {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = null;
  }
}

async function disposeCad(): Promise<void> {
  const manager = cadManager;
  cadManager = null;
  if (!manager) return;
  await manager.destroy();
  // destroy() lässt je Instanz zwei versteckte Divs an <body> hängen
  // (cad-simple-viewer 1.7.1) — sonst sammeln sie sich pro Seitenwechsel.
  document
    .querySelectorAll("body > .ml-ui-simple-toolbar__menu, body > .ml-aci-loupe")
    .forEach((element) => element.remove());
}

async function fetchBlob(): Promise<Blob> {
  const response = await fetch(props.src, {
    headers: token.value ? { authorization: `Bearer ${token.value}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Datei konnte nicht geladen werden (HTTP ${response.status})`);
  }
  return response.blob();
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * docx-preview übernimmt Link-Ziele ungeprüft aus dem Dokument — ein
 * `javascript:`-Ziel liefe beim Klick im Origin des Hubs. Nur absolute
 * http(s)-/mailto-Links und interne Sprungmarken bleiben klickbar, externe
 * öffnen in einem neuen Tab.
 */
function sanitizeDocxLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) continue;
    let safe = false;
    try {
      safe = SAFE_LINK_PROTOCOLS.has(new URL(href).protocol);
    } catch {
      safe = false;
    }
    if (!safe) {
      link.removeAttribute("href");
      continue;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

async function renderDocx(blob: Blob, isStale: () => boolean): Promise<void> {
  stage.value = "Word-Dokument wird gerendert …";
  const { renderAsync } = await import("docx-preview");
  if (isStale()) return;
  status.value = "ready";
  await nextTick();
  if (isStale() || !docxTarget.value) return;
  docxTarget.value.innerHTML = "";
  await renderAsync(blob, docxTarget.value, undefined, {
    inWrapper: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
    useBase64URL: true,
  });
  if (isStale() || !docxTarget.value) return;
  sanitizeDocxLinks(docxTarget.value);
}

async function renderCad(blob: Blob, isStale: () => boolean): Promise<void> {
  stage.value = "Zeichnung wird geöffnet …";
  const [viewer, dataModel, libredwg, bytes] = await Promise.all([
    import("@mlightcad/cad-simple-viewer"),
    import("@mlightcad/data-model"),
    import("@mlightcad/libredwg-converter"),
    blob.arrayBuffer(),
  ]);
  if (isStale()) return;

  const workerUrl = (file: string) =>
    new URL(`/cad/${file}`, window.location.origin).href;
  // DXF parst data-model selbst; DWG nur über den libredwg-Worker. Die
  // Registrierung ist global und überlebt das Zerstören des Viewers.
  const converters = dataModel.AcDbDatabaseConverterManager.instance;
  if (!converters.get(dataModel.AcDbFileType.DWG)) {
    converters.register(
      dataModel.AcDbFileType.DWG,
      new libredwg.AcDbLibreDwgConverter({
        useWorker: true,
        parserWorkerUrl: workerUrl(viewer.LIBREDWG_PARSER_WORKER_FILE),
      }),
    );
  }
  // Reine Ansicht: Kommandozeile, Ribbon & Co. des Viewers ausblenden, ohne
  // die Einstellungen in localStorage zu schreiben.
  viewer.AcApSettingManager.configure({ storageKey: "ifc-hub:cad-viewer" });
  viewer.AcApSettingManager.instance.apply(
    {
      isShowCommandLine: false,
      isShowCoordinate: false,
      isShowEntityInfo: false,
      isShowLanguageSelector: false,
      isShowRibbon: false,
      isShowToolbar: false,
      isShowShortCutToolbar: false,
      isShowStats: false,
    },
    { persist: false },
  );

  // Der Canvas-Container steht schon während des Ladens im DOM (unter dem
  // Lade-Overlay), damit der Viewer die richtige Größe mitbekommt.
  await nextTick();
  if (isStale() || !cadTarget.value) return;
  await viewer.AcApDocManager.tryGetInstance()?.destroy();
  if (isStale() || !cadTarget.value) return;
  const manager = viewer.AcApDocManager.createInstance({
    container: cadTarget.value,
    autoResize: true,
    notificationCenter: false,
    builtinOpenFileDialog: false,
    disableExport: true,
    webworkerFileUrls: {
      dwgParser: workerUrl(viewer.LIBREDWG_PARSER_WORKER_FILE),
      mtextRender: workerUrl(viewer.MTEXT_RENDERER_WORKER_FILE),
    },
  });
  if (!manager) throw new Error("Der CAD-Viewer konnte nicht gestartet werden.");
  cadManager = manager;
  const opened = await manager.openDocument(props.name, bytes, {
    mode: viewer.AcEdOpenMode.Read,
  });
  if (isStale()) return;
  if (!opened) throw new Error("Die Zeichnung konnte nicht gelesen werden.");
  // openDocument kehrt nach dem Parsen zurück; die Geometrie wird danach
  // noch konvertiert. Erst danach einpassen — die gespeicherten Extents
  // fehlen in manchen DXF-Dateien, dann bliebe die Startansicht leer.
  stage.value = "Zeichnung wird aufgebaut …";
  await manager.curView.waitUntilIdle(120_000);
  if (isStale()) return;
  // Reine Ansicht: Ziehen mit links verschiebt (statt Auswahlrahmen).
  manager.curView.mode = viewer.AcEdViewMode.PAN;
  manager.curView.zoomToFitDrawing();
  status.value = "ready";
}

function fitDrawing(): void {
  cadManager?.curView.zoomToFitDrawing();
}

async function load(): Promise<void> {
  const current = ++generation;
  const isStale = () => current !== generation;
  status.value = "loading";
  stage.value = "Lade Datei …";
  error.value = null;
  textContent.value = null;
  revoke();
  await disposeCad();
  try {
    const blob = await fetchBlob();
    if (isStale()) return;
    switch (kind.value) {
      case "pdf":
      case "image":
        blobUrl.value = URL.createObjectURL(blob);
        status.value = "ready";
        break;
      case "text": {
        const slice = blob.size > TEXT_LIMIT ? blob.slice(0, TEXT_LIMIT) : blob;
        const text = await slice.text();
        if (isStale()) return;
        textContent.value =
          text +
          (blob.size > TEXT_LIMIT ? "\n\n… (gekürzt, vollständig per Download)" : "");
        status.value = "ready";
        break;
      }
      case "docx":
        await renderDocx(blob, isStale);
        break;
      case "cad":
        await renderCad(blob, isStale);
        break;
      default:
        status.value = "ready";
    }
  } catch (e) {
    if (isStale()) return;
    error.value = e instanceof Error ? e.message : String(e);
    status.value = "error";
    await disposeCad();
  }
}

async function download(): Promise<void> {
  try {
    const blob = await fetchBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = props.name;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    status.value = "error";
  }
}

watch(() => props.src, load, { immediate: true });
onBeforeUnmount(() => {
  generation++;
  revoke();
  void disposeCad();
});
</script>

<template>
  <div class="file-preview">
    <!-- CAD: Container bleibt während des Ladens im DOM (Canvas-Größe). -->
    <template v-if="kind === 'cad' && status !== 'error'">
      <div class="file-preview-toolbar">
        <span class="muted small">Mausrad: Zoom · Ziehen: Verschieben</span>
        <span class="topbar-spacer" />
        <button title="Ganze Zeichnung zeigen" :disabled="status !== 'ready'" @click="fitDrawing">
          <PhCornersOut :size="15" aria-hidden="true" />
          Einpassen
        </button>
      </div>
      <div ref="cadTarget" class="file-preview-cad" />
    </template>

    <div v-if="status === 'loading'" class="viewer-overlay">
      <LoadingState center large :text="stage" />
    </div>
    <div v-else-if="status === 'error'" class="viewer-overlay error file-preview-overlay">
      <div>
        <p>{{ error }}</p>
        <button @click="download">
          <PhDownloadSimple :size="15" aria-hidden="true" />
          Herunterladen
        </button>
      </div>
    </div>

    <template v-else>
      <iframe
        v-if="kind === 'pdf' && blobUrl"
        class="file-preview-frame"
        :src="blobUrl"
        :title="name"
      />

      <div v-else-if="kind === 'image' && blobUrl" class="file-preview-scroll">
        <img class="file-preview-image" :src="blobUrl" :alt="name" />
      </div>

      <div v-else-if="kind === 'docx'" class="file-preview-scroll docx-scroll">
        <div ref="docxTarget" class="docx-target"></div>
      </div>

      <pre v-else-if="kind === 'text'" class="file-preview-text">{{ textContent }}</pre>

      <div v-else-if="kind === 'none'" class="viewer-overlay file-preview-overlay">
        <div>
          <p>
            Für <strong>.{{ extension || "?" }}</strong>-Dateien gibt es keine
            Vorschau im Browser.
          </p>
          <button class="primary" @click="download">
            <PhDownloadSimple :size="15" aria-hidden="true" />
            {{ name }} herunterladen
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
