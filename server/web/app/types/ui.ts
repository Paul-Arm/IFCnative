// Gemeinsame Typen der UI-Komponenten.

/** Eintrag eines Auswahlmenüs der Issue-Seitenleiste (SidePicker). */
export interface PickerItem {
  id: string;
  label: string;
  sub?: string;
  /** Benutzer → Avatar; Modell → Icon. */
  user?: { id: string; name: string } | null;
  model?: { kind: "ifc" | "md" | "file"; name: string };
}
