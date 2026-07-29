/**
 * Absturzsichere Zwischenspeicherung der geöffneten Dokumente.
 *
 * Bisher lebten bearbeitete IFC-Dokumente ausschließlich im React-State: ein
 * Render-Fehler, ein Reload oder ein Absturz des WebView-Renderers hat alle
 * nicht exportierten Änderungen vernichtet. Der Autosave schreibt den
 * serialisierten IFC-Text jedes geänderten Dokuments nach IndexedDB (localStorage
 * scheidet wegen der ~5-MB-Quote aus) und bietet ihn beim nächsten Start zur
 * Wiederherstellung an.
 *
 * IndexedDB ist bewusst die einzige Abhängigkeit: sie funktioniert im Browser
 * wie im Tauri-WebView identisch und braucht keine Dateisystem-Capability.
 */

const DB_NAME = "ifcnative-recovery";
const DB_VERSION = 1;
const STORE_NAME = "documents";

export interface RecoveredDocument {
  /** Id der Workspace-Session, aus der der Stand stammt. */
  id: string;
  fileName: string;
  schema: string;
  entityCount: number;
  selectedId: number;
  /** Serialisierter IFC-Text (STEP) — die Wahrheit, aus der neu geparst wird. */
  ifcText: string;
  savedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB ist in dieser Umgebung nicht verfügbar."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB konnte nicht geöffnet werden."));
    request.onblocked = () =>
      reject(new Error("IndexedDB-Zugriff blockiert (anderes Fenster offen?)."));
  });
}

function runTransaction(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return openDatabase().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onabort = transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB-Transaktion fehlgeschlagen."));
        };
        work(transaction.objectStore(STORE_NAME));
      }),
  );
}

/**
 * Ersetzt den gesamten Wiederherstellungsstand durch `entries`. Dokumente, die
 * nicht mehr in der Liste stehen (geschlossen oder exportiert), verschwinden
 * dadurch automatisch.
 */
export async function writeRecoveryDocuments(entries: RecoveredDocument[]) {
  await runTransaction("readwrite", (store) => {
    store.clear();
    for (const entry of entries) {
      store.put(entry);
    }
  });
}

export function readRecoveryDocuments(): Promise<RecoveredDocument[]> {
  return openDatabase().then(
    (db) =>
      new Promise<RecoveredDocument[]>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => {
          db.close();
          const rows = Array.isArray(request.result)
            ? (request.result as RecoveredDocument[])
            : [];
          resolve(
            rows.filter(
              (row) => typeof row?.ifcText === "string" && row.ifcText.length > 0,
            ),
          );
        };
        request.onerror = () => {
          db.close();
          reject(request.error ?? new Error("Wiederherstellung nicht lesbar."));
        };
      }),
  );
}

export async function clearRecoveryDocuments() {
  await runTransaction("readwrite", (store) => {
    store.clear();
  });
}
