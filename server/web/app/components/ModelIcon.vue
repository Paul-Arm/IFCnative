<script setup lang="ts">
import {
  PhBlueprint,
  PhCube,
  PhFile,
  PhFileCsv,
  PhFileDoc,
  PhFileImage,
  PhFileMd,
  PhFilePdf,
  PhFileText,
  PhFileXls,
} from "@phosphor-icons/vue";

/** Icon je Dateiart (IFC, Markdown, PDF, Word, DWG …), farbig wie die Dateityp-Leiste. */
const props = withDefaults(
  defineProps<{
    kind: "ifc" | "md" | "file";
    name: string;
    size?: number;
    colored?: boolean;
  }>(),
  { size: 16, colored: true },
);

const extension = computed(() =>
  props.kind === "ifc" ? "ifc" : props.kind === "md" ? "md" : fileExtension(props.name),
);

const icon = computed(() => {
  const ext = extension.value;
  if (props.kind === "ifc") return PhCube;
  if (props.kind === "md") return PhFileMd;
  if (ext === "pdf") return PhFilePdf;
  if (ext === "doc" || ext === "docx") return PhFileDoc;
  if (ext === "xls" || ext === "xlsx") return PhFileXls;
  if (ext === "csv") return PhFileCsv;
  if (ext === "dwg" || ext === "dxf") return PhBlueprint;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return PhFileImage;
  if (["txt", "json", "xml", "ids", "log", "yaml", "yml"].includes(ext)) return PhFileText;
  return PhFile;
});

const color = computed(() => (props.colored ? kindColor(extension.value) : undefined));
</script>

<template>
  <component
    :is="icon"
    :size="size"
    :weight="kind === 'ifc' ? 'duotone' : 'regular'"
    :style="color ? { color } : undefined"
    aria-hidden="true"
  />
</template>
