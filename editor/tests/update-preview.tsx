// Development-only browser fixture. Not referenced by the production entry.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { SettingsDialog } from "../src/components/ifc-workspace/SettingsDialog";
import { UpdateNotification } from "../src/components/ifc-workspace/UpdateNotification";
import { createDefaultAttributionSettings, createDefaultPortalSettings, createDefaultVcsSettings } from "../src/components/ifc-workspace/workspaceStorage";
import { editorUpdates } from "../src/updates/client";
import "../src/global.css";

mockIPC(async (command, args) => {
  switch (command) {
    case "update_status": return { currentVersion: "1.4.12", configured: true };
    case "check_editor_update": return { version: "1.4.13", notes: "Test-Release mit Verbesserungen." };
    case "editor_patchnotes": return { version: "1.4.13", title: "Verbesserungen im IFC-Editor", publishedAt: "2026-09-15T10:00:00Z", changes: ["Update-Hinweise können für sieben Tage ausgeblendet werden.", "Installation nach einem Klick mit Signaturprüfung."] };
    case "download_editor_update": {
      const channel = (args as { onProgress: { onmessage: (value: unknown) => void } }).onProgress;
      channel.onmessage({ downloaded: 5, total: 10 });
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      channel.onmessage({ downloaded: 10, total: 10 });
      return;
    }
    case "install_editor_update": document.body.dataset.installRequested = "true"; return;
    default: throw new Error(`Unexpected mock command: ${command}`);
  }
});
await editorUpdates.check();

function Preview() {
  const [open, setOpen] = useState(false);
  return <div className="min-h-screen bg-background p-8 text-foreground">
    <h1 className="text-xl font-semibold">IFCnative · Update-Prüfung</h1>
    <p className="my-3 text-sm text-muted-foreground">Simulierter Desktop-Update-Dienst. Es wird kein Installer ausgeführt.</p>
    <button className="rounded border p-2" onClick={() => setOpen(true)}>Einstellungen öffnen</button>
    <UpdateNotification hidden={open} onOpenSettings={() => setOpen(true)} />
    <SettingsDialog open={open} onOpenChange={setOpen} defaultSection="updates"
      portalSettings={createDefaultPortalSettings()} onPortalSettingsChange={() => {}}
      vcsSettings={createDefaultVcsSettings()} onVcsSettingsChange={() => {}}
      attributionSettings={createDefaultAttributionSettings()} onAttributionSettingsChange={() => {}}
      vcsAuth={null} onVcsAuthChange={() => {}} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Preview /></React.StrictMode>);
