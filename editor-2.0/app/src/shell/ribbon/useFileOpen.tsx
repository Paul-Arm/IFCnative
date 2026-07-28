/**
 * Öffnen-Befehl des Ribbons. Das versteckte `<input type=file>` hängt am
 * Ribbon-Rahmen (nicht am Reiter), damit es beim Reiterwechsel und im
 * eingeklappten Zustand montiert bleibt — dieselbe Aufteilung wie in
 * `useFileCommands` des ifc-lite-Viewers.
 *
 * Die Öffnen-Logik selbst ist unverändert aus `shell/HeaderBar.tsx`
 * übernommen (Dokument öffnen, danach Eintrag in „Kürzlich verwendet").
 */
import { useCallback, useRef, type ReactElement } from "react";
import { useDocuments } from "../../store/documents";
import { useUi } from "../../store/ui";

export interface FileCommands {
  /** Muss einmal im Ribbon gerendert werden. */
  fileInput: ReactElement;
  openFiles(): void;
}

export function useFileOpen(): FileCommands {
  const input = useRef<HTMLInputElement>(null);
  const openDocument = useDocuments((s) => s.openDocument);
  const addRecent = useUi((s) => s.addRecent);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      for (const file of files ?? []) {
        await openDocument(file.name, await file.arrayBuffer());
        const doc = useDocuments.getState().documents.at(-1);
        if (doc) {
          const info = doc.session.info();
          addRecent({
            fileName: info.fileName,
            entityCount: info.entityCount,
            schema: info.schema,
            openedAt: new Date().toISOString(),
          });
        }
      }
    },
    [openDocument, addRecent],
  );

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept=".ifc,.ifczip,.zip,.ifcx"
      multiple
      style={{ display: "none" }}
      onChange={(event) => {
        void onFiles(event.target.files);
        event.target.value = "";
      }}
    />
  );

  return {
    fileInput,
    openFiles: () => input.current?.click(),
  };
}
