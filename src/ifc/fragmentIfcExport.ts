import {
  serializeNativeIfcDocument,
  type NativeIfcDocument,
} from "./nativeDocument";

export interface FragmentIfcExportInput {
  document: NativeIfcDocument;
  documentText?: string;
  documentTextDirty: boolean;
  fragmentsBuffer?: ArrayBuffer | null;
  fragmentsDirty: boolean;
  sourceIfcBytes?: ArrayBuffer | null;
  sourceIfcFile?: Blob | null;
}

export interface FragmentIfcExportResult {
  contents: BlobPart;
  diagnostics: string[];
  source: "fragments-compat" | "fragments-dirty-compat";
}

export function exportIfcFromFragments(input: FragmentIfcExportInput) {
  const diagnostics: string[] = [];

  if (!input.fragmentsBuffer) {
    diagnostics.push(
      "Fragments export bridge: no canonical fragments buffer is stored for this session.",
    );
  }

  if (input.fragmentsDirty) {
    diagnostics.push(
      "Fragments export bridge: fragments are marked dirty; exporting the current IFC compatibility document.",
    );
  }

  if (input.documentTextDirty || input.fragmentsDirty || !input.documentText) {
    return {
      contents: serializeNativeIfcDocument(input.document),
      diagnostics,
      source: "fragments-dirty-compat",
    } satisfies FragmentIfcExportResult;
  }

  return {
    contents:
      input.documentText ||
      input.sourceIfcFile ||
      input.sourceIfcBytes ||
      serializeNativeIfcDocument(input.document),
    diagnostics,
    source: "fragments-compat",
  } satisfies FragmentIfcExportResult;
}
