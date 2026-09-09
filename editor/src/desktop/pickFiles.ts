/** A cancelled dialog resolves with an empty selection, just like a cleared input. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    const cleanup = () => {
      input.onchange = input.oncancel = input.onerror = null;
      input.remove();
    };
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    };
    input.oncancel = () => { cleanup(); resolve([]); };
    input.onerror = () => { cleanup(); reject(new Error("File picker failed.")); };
    try {
      input.click();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
