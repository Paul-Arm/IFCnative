export function pickIfcFile() {
  return pickIfcFiles(false).then((files) => files[0]);
}

export function pickIfcFiles(multiple: boolean) {
  return new Promise<{ file: File; name: string }[]>((resolve, reject) => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept =
      ".ifc,application/x-step,text/plain,application/octet-stream";
    input.onchange = () => {
      const files = Array.from(input.files ?? []).map((file) => ({
        file,
        name: file.name,
      }));
      resolve(files);
    };
    input.onerror = () => reject(new Error("File picker failed."));
    input.click();
  });
}

export function pickCatalogFile() {
  return new Promise<{ file: File; name: string } | undefined>(
    (resolve, reject) => {
      const input = globalThis.document.createElement("input");
      input.type = "file";
      input.accept =
        ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";
      input.onchange = () => {
        const file = input.files?.[0];
        resolve(file ? { file, name: file.name } : undefined);
      };
      input.onerror = () => reject(new Error("File picker failed."));
      input.click();
    },
  );
}

/** Blob als Datei-Download anstoßen (Object-URL wird verzögert freigegeben). */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  globalThis.document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the object URL alive until the browser has consumed the click.
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
