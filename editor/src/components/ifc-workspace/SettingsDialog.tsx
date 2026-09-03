/**
 * Zentrale Einstellungen als Modal. Ersetzt die früheren Einstellungs-Panels
 * im Mosaik (zuletzt "Portal-Einstellungen") und die verstreuten
 * Verbindungs-Abschnitte in den Panels: alles Konfigurierbare liegt hier an
 * einer Stelle, navigiert über vertikale Tabs wie in VS Code.
 *
 * Alle Änderungen wirken sofort und werden von der Workspace-Ebene in den
 * LocalStorage geschrieben — der Dialog hat bewusst kein "Speichern".
 */

import {
  Cloud,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  Sun,
  Tags,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { UI_SCALE_OPTIONS, useUiScale, type UiScale } from "@/hooks/use-ui-scale";
import { cn } from "@/lib/utils";
import type { PortalSettings } from "@/portal/types";
import {
  createDefaultVcsSettings,
  type VcsAuth,
  type VcsSettings,
} from "@/vcs/types";

import { HubAuthForm } from "./HubAuthForm";
import {
  PortalConnectionSettings,
  PortalMappingSettings,
  PortalPsetSettings,
} from "./PortalSettingsSections";
import {
  Button,
  DropdownField,
  InfoSection,
  LabeledInput,
  PanelHeader,
  SegmentedControl,
  Toolbar,
  ToolbarGroup,
} from "./ui";

export type SettingsSectionId =
  | "appearance"
  | "hub"
  | "portal-connection"
  | "portal-mapping"
  | "portal-psets";

interface SettingsSection {
  id: SettingsSectionId;
  /** Beschriftung in der linken Tab-Leiste. */
  label: string;
  /** Überschrift im Inhaltsbereich. */
  title: string;
  description: string;
  group: string;
  icon: LucideIcon;
}

const SECTIONS: SettingsSection[] = [
  {
    description: "Farbschema und Skalierung der Oberfläche.",
    group: "Allgemein",
    icon: Palette,
    id: "appearance",
    label: "Darstellung",
    title: "Darstellung",
  },
  {
    description: "Server-URL und Anmeldung an der zentralen IFC-Ablage.",
    group: "IFC Hub",
    icon: Cloud,
    id: "hub",
    label: "Verbindung & Konto",
    title: "IFC Hub — Verbindung & Konto",
  },
  {
    description: "API-Endpunkte, Keycloak-Client und Mock-Modus des MKP-Portals.",
    group: "MKP Portal",
    icon: PlugZap,
    id: "portal-connection",
    label: "Verbindung",
    title: "MKP Portal — Verbindung",
  },
  {
    description:
      "Welche API-Modelle beim Import zu welchen IFC-Klassen werden.",
    group: "MKP Portal",
    icon: Workflow,
    id: "portal-mapping",
    label: "Import-Mapping",
    title: "MKP Portal — Import-Mapping",
  },
  {
    description: "Welche Property-Sets der Portal-Import ans IFC schreibt.",
    group: "MKP Portal",
    icon: Tags,
    id: "portal-psets",
    label: "Property-Sets",
    title: "MKP Portal — Property-Sets",
  },
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { label: "Hell", value: "light" },
  { label: "Dunkel", value: "dark" },
  { label: "System", value: "system" },
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abschnitt, mit dem der Dialog beim Öffnen startet. */
  defaultSection?: SettingsSectionId;
  portalSettings: PortalSettings;
  onPortalSettingsChange: (settings: PortalSettings) => void;
  vcsSettings: VcsSettings;
  onVcsSettingsChange: (settings: VcsSettings) => void;
  vcsAuth: VcsAuth | null;
  onVcsAuthChange: (auth: VcsAuth | null) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  defaultSection = "appearance",
  portalSettings,
  onPortalSettingsChange,
  vcsSettings,
  onVcsSettingsChange,
  vcsAuth,
  onVcsAuthChange,
}: SettingsDialogProps) {
  const [activeId, setActiveId] = useState<SettingsSectionId>(defaultSection);
  const navRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Beim Öffnen immer im gewünschten Abschnitt starten (z. B. Hub-Zahnrad).
  useEffect(() => {
    if (open) {
      setActiveId(defaultSection);
    }
  }, [open, defaultSection]);

  // Abschnittswechsel beginnt oben — sonst bleibt die Scrollposition des
  // langen Mapping-Abschnitts im kurzen Darstellungs-Abschnitt stehen.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [activeId]);

  const active = SECTIONS.find((section) => section.id === activeId) ?? SECTIONS[0];

  /** Pfeiltasten-Navigation in der vertikalen Tab-Leiste (roving tabindex). */
  const handleNavKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = SECTIONS.findIndex((section) => section.id === activeId);
    let next = -1;
    if (event.key === "ArrowDown") {
      next = (index + 1) % SECTIONS.length;
    } else if (event.key === "ArrowUp") {
      next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = SECTIONS.length - 1;
    }
    if (next < 0) {
      return;
    }
    event.preventDefault();
    const nextId = SECTIONS[next].id;
    setActiveId(nextId);
    navRef.current
      ?.querySelector<HTMLButtonElement>(`[data-section="${nextId}"]`)
      ?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(85vh,44rem)] w-[min(96vw,58rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 gap-1 border-b border-border/60 px-4 py-3 pr-12">
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>
            Gelten für diesen Rechner und werden automatisch gespeichert.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <div
            ref={navRef}
            aria-label="Einstellungs-Bereiche"
            aria-orientation="vertical"
            className="w-44 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/30 p-2 sm:w-56"
            role="tablist"
            onKeyDown={handleNavKeyDown}
          >
            {SECTIONS.map((section, index) => {
              const isActive = section.id === activeId;
              const isGroupStart =
                index === 0 || SECTIONS[index - 1].group !== section.group;
              const Icon = section.icon;
              return (
                <div key={section.id}>
                  {isGroupStart ? (
                    <div
                      className={cn(
                        "px-2 pb-1 text-[0.65rem] font-semibold tracking-wider text-muted-foreground uppercase",
                        index === 0 ? "pt-1" : "pt-3",
                      )}
                    >
                      {section.group}
                    </div>
                  ) : null}
                  <button
                    aria-controls={`settings-panel-${section.id}`}
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-[0.8125rem] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      isActive
                        ? "border-primary bg-background font-medium text-foreground shadow-sm"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    data-section={section.id}
                    id={`settings-tab-${section.id}`}
                    role="tab"
                    tabIndex={isActive ? 0 : -1}
                    title={section.title}
                    type="button"
                    onClick={() => setActiveId(section.id)}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground/80",
                      )}
                    />
                    <span className="min-w-0 truncate">{section.label}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div
            ref={contentRef}
            aria-labelledby={`settings-tab-${active.id}`}
            className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4"
            id={`settings-panel-${active.id}`}
            role="tabpanel"
            tabIndex={0}
          >
            <PanelHeader title={active.title} description={active.description} />
            {active.id === "appearance" ? <AppearanceSettings /> : null}
            {active.id === "hub" ? (
              <HubSettings
                auth={vcsAuth}
                settings={vcsSettings}
                onAuthChange={onVcsAuthChange}
                onSettingsChange={onVcsSettingsChange}
              />
            ) : null}
            {active.id === "portal-connection" ? (
              <PortalConnectionSettings
                settings={portalSettings}
                onSettingsChange={onPortalSettingsChange}
              />
            ) : null}
            {active.id === "portal-mapping" ? (
              <PortalMappingSettings
                settings={portalSettings}
                onSettingsChange={onPortalSettingsChange}
              />
            ) : null}
            {active.id === "portal-psets" ? (
              <PortalPsetSettings
                settings={portalSettings}
                onSettingsChange={onPortalSettingsChange}
              />
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-muted/40 px-4 py-2.5">
          <Button variant="default" onClick={() => onOpenChange(false)}>
            Schließen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Farbschema und globale Skalierung — beides sofort wirksam. */
function AppearanceSettings() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { scale, setScale } = useUiScale();

  return (
    <>
      <InfoSection title="Farbschema">
        <SegmentedControl
          options={THEME_OPTIONS}
          value={theme}
          onChange={(next) => setTheme(next as ThemePreference)}
        />
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {theme === "system" ? (
            <Monitor aria-hidden className="size-3.5" />
          ) : resolvedTheme === "dark" ? (
            <Moon aria-hidden className="size-3.5" />
          ) : (
            <Sun aria-hidden className="size-3.5" />
          )}
          {theme === "system"
            ? `Folgt den Systemeinstellungen — aktuell ${
                resolvedTheme === "dark" ? "dunkel" : "hell"
              }.`
            : "Feste Auswahl, unabhängig von den Systemeinstellungen."}
        </p>
      </InfoSection>

      <InfoSection title="Skalierung">
        <div className="max-w-56">
          <DropdownField
            label="Schriftgröße der Oberfläche"
            options={UI_SCALE_OPTIONS.map((option) => ({
              label: `${option} %`,
              value: String(option),
            }))}
            value={String(scale)}
            onChange={(next) => setScale(Number(next) as UiScale)}
          />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Skaliert die rem-Basis: Schriften, Abstände und Bedienelemente aller
          Panels folgen. Dieselbe Auswahl steht in der Statusleiste unten
          rechts.
        </p>
      </InfoSection>
    </>
  );
}

/** Server-URL und Anmeldung des IFC Hub — die einzige Stelle für beides. */
function HubSettings({
  auth,
  settings,
  onAuthChange,
  onSettingsChange,
}: {
  auth: VcsAuth | null;
  settings: VcsSettings;
  onAuthChange: (auth: VcsAuth | null) => void;
  onSettingsChange: (settings: VcsSettings) => void;
}) {
  return (
    <>
      <InfoSection title="Server">
        <LabeledInput
          label="Server-URL"
          mono
          value={settings.baseUrl}
          onChangeText={(baseUrl) => onSettingsChange({ ...settings, baseUrl })}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Web-Oberfläche des Servers:{" "}
          <a
            className="text-primary underline-offset-2 hover:underline"
            href={settings.baseUrl}
            rel="noreferrer"
            target="_blank"
          >
            {settings.baseUrl}
          </a>
          . Die Projektauswahl erfolgt im Panel „IFC Hub“.
        </p>
      </InfoSection>

      <InfoSection title="Konto">
        <HubAuthForm
          auth={auth}
          settings={settings}
          onAuthChange={onAuthChange}
        />
      </InfoSection>

      <Toolbar>
        <ToolbarGroup>
          <Button
            title="Server-URL auf den Standardwert zurücksetzen"
            variant="outline"
            onClick={() =>
              onSettingsChange({
                ...settings,
                baseUrl: createDefaultVcsSettings().baseUrl,
              })
            }
          >
            Zurücksetzen
          </Button>
        </ToolbarGroup>
      </Toolbar>
    </>
  );
}
