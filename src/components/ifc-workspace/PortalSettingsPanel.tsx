import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeIfcClass } from "@/ifc";
import {
  IFC_CLASS_CHOICES,
  PORTAL_VERFAHREN_MAPPING_MODELS,
  createProxyPresetMapping,
  parseFreecadMapping,
  serializeFreecadMapping,
  type PortalMappingTarget,
  type PortalModelMapping,
} from "@/portal/mapping";
import {
  createDefaultPortalSettings,
  type PortalSettings,
} from "@/portal/types";

import {
  Badge,
  Button,
  DataTable,
  DataTableCell,
  DropdownField,
  InfoSection,
  LabeledInput,
  PanelHeader,
  PanelShell,
  Toolbar,
  ToolbarGroup,
  type DataTableColumn,
} from "./ui";

export interface PortalSettingsPanelProps {
  settings: PortalSettings;
  onSettingsChange: (settings: PortalSettings) => void;
}

const MAPPING_COLUMNS: DataTableColumn[] = [
  { header: "API-Modell", key: "model", minWidth: 140 },
  { header: "Ziel", key: "target", minWidth: 130 },
  { header: "Werte", key: "writeProperties", minWidth: 60 },
  { header: "IFC-Klasse", key: "ifcClass", minWidth: 180 },
  { header: "ObjectType", key: "objectType", minWidth: 140 },
];

const MODE_OPTIONS = [
  { label: "Preset (Beispiel-IFC)", value: "proxy" },
  { label: "Benutzerdefiniert", value: "custom" },
];

const TARGET_OPTIONS: {
  label: string;
  value: PortalMappingTarget;
  hint: string;
}[] = [
  { hint: "eigenes IFC-Element (Upsert per ExternalId)", label: "Element", value: "element" },
  { hint: "nur Property-Sets am übergeordneten Element", label: "Pset am Host", value: "pset" },
  { hint: "Ebene überspringen, Kinder trotzdem importieren", label: "Durchreichen", value: "skip" },
  { hint: "Ebene samt Unterbaum nicht importieren", label: "Ignorieren", value: "ignore" },
];

const BULK_VERFAHREN_OPTIONS: { label: string; value: string }[] = [
  { label: "Bulk-Aktion wählen …", value: "" },
  { label: "Alle Verfahren → Pset am Host", value: "pset" },
  { label: "Alle Verfahren → Element", value: "element" },
  { label: "Alle Verfahren → Ignorieren (vor Verfahren aufhören)", value: "ignore" },
];

/** Gruppierung der Mapping-Zeilen für die Anzeige. */
const MAPPING_GROUPS: { title: string; models: string[]; hint?: string }[] = [
  {
    models: ["Bauwerk", "Teilbauwerk", "Bauteil"],
    title: "Struktur",
  },
  {
    hint: "Untersuchungsbereiche, -stellen und Verfahren aus dem BWD-Modul.",
    models: [
      "Untersuchungsbereich",
      "Untersuchungsstelle",
      "Untersuchungsverfahren",
      "Kernbohrung",
      "Oeffnung",
      "Bohrkanal",
      "Bohrkern",
      "Probe",
    ],
    title: "Diagnostik",
  },
  {
    hint: "Messkonzepte, Maßnahmen, Messstellen und Kanäle aus dem Monitoring.",
    models: ["Messkonzept", "Massnahme", "Messstelle", "Kanal"],
    title: "Monitoring",
  },
];

const CUSTOM_IFC_CLASS_VALUE = "__andere__";

export function PortalSettingsPanel({
  settings,
  onSettingsChange,
}: PortalSettingsPanelProps) {
  const [mappingError, setMappingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const update = (patch: Partial<PortalSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  /**
   * Zeilen-Änderungen schalten automatisch auf "Benutzerdefiniert" um —
   * im Preset-Modus würde der Import sonst weiter das Preset verwenden
   * (Proxy-Modus löst beim Laden immer auf das aktuelle Preset auf).
   */
  const patchMappingRows = (
    models: string[],
    patch: Partial<PortalModelMapping>,
  ) => {
    const wanted = new Set(models.map((model) => model.toLowerCase()));
    const mappings = settings.mapping.mappings.map((row) =>
      wanted.has(row.model.toLowerCase()) ? { ...row, ...patch } : row,
    );
    update({ mapping: { mappings, mode: "custom", version: 1 } });
  };

  const handleModeChange = (value: string) => {
    if (value === "proxy") {
      // Preset-Modus setzt die Tabelle auf das aktuelle Preset zurück, damit
      // Anzeige und Import identisch bleiben.
      update({ mapping: createProxyPresetMapping() });
    } else if (value === "custom") {
      update({ mapping: { ...settings.mapping, mode: "custom" } });
    }
  };

  const handleBulkVerfahren = (value: string) => {
    if (value === "element" || value === "pset" || value === "ignore") {
      patchMappingRows(PORTAL_VERFAHREN_MAPPING_MODELS, { target: value });
    }
  };

  const exportMapping = () => {
    const blob = new Blob([serializeFreecadMapping(settings.mapping)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "ifc-api-mapping.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importMappingFile = async (file: File) => {
    setMappingError(null);
    try {
      const text = await file.text();
      update({ mapping: parseFreecadMapping(text) });
    } catch (cause) {
      setMappingError(
        cause instanceof Error
          ? cause.message
          : "Mapping-Datei konnte nicht gelesen werden.",
      );
    }
  };

  const resetToDefaults = () => {
    // "Zurücksetzen" = Preset + Default-URLs; Bauwerk-/Projekt-Auswahl,
    // Mock-Schalter und Pset-Optionen bleiben erhalten.
    const defaults = createDefaultPortalSettings();
    onSettingsChange({
      ...settings,
      assetBaseUrl: defaults.assetBaseUrl,
      bwdBaseUrl: defaults.bwdBaseUrl,
      clientId: defaults.clientId,
      mapping: defaults.mapping,
      monitoringBaseUrl: defaults.monitoringBaseUrl,
      tokenUrl: defaults.tokenUrl,
    });
  };

  const rowsByModel = new Map(
    settings.mapping.mappings.map((row) => [row.model.toLowerCase(), row]),
  );
  const groupedModels = new Set(
    MAPPING_GROUPS.flatMap((group) => group.models.map((m) => m.toLowerCase())),
  );
  const extraRows = settings.mapping.mappings.filter(
    (row) => !groupedModels.has(row.model.toLowerCase()),
  );

  return (
    <PanelShell>
      <PanelHeader
        title="Portal-Einstellungen"
        description="Verbindung, Import-Mapping und Pset-Optionen für das MKP-Portal."
        meta={
          settings.useMockData ? <Badge tone="info">Mock-Daten</Badge> : null
        }
      />

      <PanelShell scroll>
        <InfoSection title="Verbindung">
          <LabeledInput
            label="BWD-API (bwdBaseUrl)"
            mono
            value={settings.bwdBaseUrl}
            onChangeText={(value) => update({ bwdBaseUrl: value })}
          />
          <LabeledInput
            label="Assetverwaltung-API (assetBaseUrl)"
            mono
            value={settings.assetBaseUrl}
            onChangeText={(value) => update({ assetBaseUrl: value })}
          />
          <LabeledInput
            label="Monitoring-API (monitoringBaseUrl)"
            mono
            value={settings.monitoringBaseUrl}
            onChangeText={(value) => update({ monitoringBaseUrl: value })}
          />
          <LabeledInput
            label="Token-URL (Keycloak)"
            mono
            value={settings.tokenUrl}
            onChangeText={(value) => update({ tokenUrl: value })}
          />
          <LabeledInput
            label="Client-ID"
            mono
            value={settings.clientId}
            onChangeText={(value) => update({ clientId: value })}
          />
          <CheckboxField
            checked={settings.useMockData}
            description="Alle Portal-Abrufe liefern lokale Demo-Daten (kein Netzwerk, keine Anmeldung nötig)."
            label="Mock-Daten verwenden"
            onChange={(checked) => update({ useMockData: checked })}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Die Standardpfade (/mkp/…) laufen im Dev-Server über den
            Vite-Proxy (siehe vite.config.mts) und umgehen so CORS. Direkte
            URLs zum Portal oder zu einem lokalen Backend erfordern passende
            CORS-Freigaben im Backend.
          </p>
        </InfoSection>

        <InfoSection title="Import-Mapping">
          <div className="flex flex-wrap items-end gap-3">
            <DropdownField
              label="Modus"
              options={MODE_OPTIONS}
              value={settings.mapping.mode}
              onChange={handleModeChange}
            />
            <DropdownField
              label="Diagnostik-Verfahren (Bulk)"
              options={BULK_VERFAHREN_OPTIONS}
              value=""
              onChange={handleBulkVerfahren}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {settings.mapping.mode === "custom"
              ? "Benutzerdefiniert: pro API-Modell frei einstellbar."
              : "Preset entspricht den Beispiel-IFCs; jede Änderung wechselt automatisch zu Benutzerdefiniert."}{" "}
            Ziele: <strong>Element</strong> = eigenes IFC-Element ·{" "}
            <strong>Pset am Host</strong> = nur Property-Sets am übergeordneten
            Element · <strong>Durchreichen</strong> = Ebene überspringen, Kinder
            importieren · <strong>Ignorieren</strong> = Ebene samt Unterbaum
            nicht importieren. <strong>Werte</strong> abgewählt = nur leere
            Pset-Hüllen ohne Properties anlegen.
          </p>
        </InfoSection>

        {MAPPING_GROUPS.map((group) => {
          const rows = group.models
            .map((model) => rowsByModel.get(model.toLowerCase()))
            .filter((row): row is PortalModelMapping => row !== undefined);
          if (rows.length === 0) {
            return null;
          }
          return (
            <InfoSection key={group.title} title={`Mapping: ${group.title}`}>
              {group.hint ? (
                <p className="text-[11px] text-muted-foreground">{group.hint}</p>
              ) : null}
              <MappingTable rows={rows} onPatchRow={patchMappingRows} />
            </InfoSection>
          );
        })}
        {extraRows.length > 0 ? (
          <InfoSection title="Mapping: Weitere Modelle">
            <MappingTable rows={extraRows} onPatchRow={patchMappingRows} />
          </InfoSection>
        ) : null}

        {mappingError ? (
          <div
            role="alert"
            className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {mappingError}
          </div>
        ) : null}

        <InfoSection title="Pset-Optionen">
          <CheckboxField
            checked={settings.psetOptions.writeLinkPset}
            description="Pset_MarxKrontalBWD mit ExternalId, Quellsystem und API-Metadaten am verknüpften Element. Auch ohne Link-Pset bleiben Re-Importe über die deterministische GlobalId erkennbar (keine Duplikate)."
            label="Link-Pset schreiben"
            onChange={(checked) =>
              update({
                psetOptions: {
                  ...settings.psetOptions,
                  writeLinkPset: checked,
                },
              })
            }
          />
          <CheckboxField
            checked={settings.psetOptions.writeCatalogPsets}
            description="ePset_* nach Objektkatalog BWD/MON, z. B. ePset_Objektinformationen oder ePset_Sensor."
            label="Katalog-Psets schreiben"
            onChange={(checked) =>
              update({
                psetOptions: {
                  ...settings.psetOptions,
                  writeCatalogPsets: checked,
                },
              })
            }
          />
          <CheckboxField
            checked={settings.psetOptions.writeRecordPsets}
            description="Pset_MarxKrontalBWD_<Modell> mit allen rohen Datenbankfeldern des Portal-Datensatzes."
            label="Rohdaten-Psets schreiben"
            onChange={(checked) =>
              update({
                psetOptions: {
                  ...settings.psetOptions,
                  writeRecordPsets: checked,
                },
              })
            }
          />
        </InfoSection>
      </PanelShell>

      <Toolbar>
        <ToolbarGroup>
          <Button
            label="Preset laden"
            onPress={() => update({ mapping: createProxyPresetMapping() })}
          />
          <Button label="Mapping exportieren" onPress={exportMapping} />
          <Button
            label="Mapping importieren"
            onPress={() => fileInputRef.current?.click()}
          />
          <Button label="Zurücksetzen" onPress={resetToDefaults} />
        </ToolbarGroup>
      </Toolbar>
      <input
        ref={fileInputRef}
        accept="application/json,.json"
        aria-label="Mapping-Datei wählen"
        className="hidden"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            void importMappingFile(file);
          }
        }}
      />
    </PanelShell>
  );
}

function MappingTable({
  rows,
  onPatchRow,
}: {
  rows: PortalModelMapping[];
  onPatchRow(models: string[], patch: Partial<PortalModelMapping>): void;
}) {
  return (
    <DataTable
      columns={MAPPING_COLUMNS}
      emptyMessage="Keine Mapping-Zeilen."
      keyExtractor={(row: PortalModelMapping) => row.model}
      minWidth={680}
      rows={rows}
      renderRow={(row) => {
        const inactive = row.target === "skip" || row.target === "ignore";
        return (
          <>
            <DataTableCell column={MAPPING_COLUMNS[0]}>
              <span
                className={
                  row.target === "ignore"
                    ? "text-xs font-medium text-muted-foreground line-through"
                    : "text-xs font-medium text-foreground"
                }
              >
                {row.model}
              </span>
            </DataTableCell>
            <DataTableCell column={MAPPING_COLUMNS[1]}>
              <TargetSelect
                value={row.target}
                onChange={(target) => onPatchRow([row.model], { target })}
              />
            </DataTableCell>
            <DataTableCell column={MAPPING_COLUMNS[2]}>
              <input
                aria-label={`Property-Werte für ${row.model} schreiben`}
                checked={row.writeProperties}
                className="size-4 accent-primary disabled:opacity-40"
                disabled={inactive}
                title="Abgewählt: nur leere Pset-Hüllen ohne Properties"
                type="checkbox"
                onChange={(event) =>
                  onPatchRow([row.model], {
                    writeProperties: event.currentTarget.checked,
                  })
                }
              />
            </DataTableCell>
            <DataTableCell column={MAPPING_COLUMNS[3]}>
              <IfcClassCell
                disabled={row.target !== "element"}
                value={row.ifcClass}
                onChange={(ifcClass) => onPatchRow([row.model], { ifcClass })}
              />
            </DataTableCell>
            <DataTableCell column={MAPPING_COLUMNS[4]}>
              <CommitInput
                ariaLabel={`ObjectType für ${row.model}`}
                disabled={row.target !== "element"}
                placeholder={row.model}
                value={row.objectType}
                onCommit={(objectType) => onPatchRow([row.model], { objectType })}
              />
            </DataTableCell>
          </>
        );
      }}
    />
  );
}

function targetLabel(target: PortalMappingTarget): string {
  return (
    TARGET_OPTIONS.find((option) => option.value === target)?.label ?? target
  );
}

function matchedIfcClassChoice(value: string): string | null {
  return (
    IFC_CLASS_CHOICES.find(
      (choice) => normalizeIfcClass(choice) === value,
    ) ?? null
  );
}

function TargetSelect({
  value,
  onChange,
}: {
  value: PortalMappingTarget;
  onChange(value: PortalMappingTarget): void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const option = TARGET_OPTIONS.find(
          (candidate) => candidate.value === next,
        );
        if (option) {
          onChange(option.value);
        }
      }}
    >
      <SelectTrigger className="h-7 w-full min-w-0" size="sm">
        <SelectValue className="truncate text-xs">
          {targetLabel(value)}
        </SelectValue>
      </SelectTrigger>
      {/* Ausgeklappt inhaltsbreit (Hinweistexte), mindestens Trigger-Breite. */}
      <SelectContent
        align="start"
        className="w-auto max-w-96 min-w-(--anchor-width)"
      >
        {TARGET_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="grid gap-0.5">
              <span>{option.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * IFC-Klassen-Zelle: Select mit den Standard-Klassen plus "Andere…", das ein
 * Freitext-Feld einblendet (Wert wird beim Commit normalisiert).
 */
function IfcClassCell({
  disabled,
  value,
  onChange,
}: {
  disabled?: boolean;
  value: string;
  onChange(value: string): void;
}) {
  const matched = matchedIfcClassChoice(value);
  const [forceCustom, setForceCustom] = useState(false);
  const custom = forceCustom || matched === null;

  return (
    <div className="grid min-w-0 gap-1 py-1">
      <Select
        disabled={disabled}
        value={custom ? CUSTOM_IFC_CLASS_VALUE : (matched ?? "")}
        onValueChange={(next) => {
          if (typeof next !== "string" || !next) {
            return;
          }
          if (next === CUSTOM_IFC_CLASS_VALUE) {
            setForceCustom(true);
            return;
          }
          setForceCustom(false);
          onChange(normalizeIfcClass(next));
        }}
      >
        <SelectTrigger className="h-7 w-full min-w-0" size="sm" disabled={disabled}>
          <SelectValue className="truncate text-xs">
            {custom ? "Andere…" : (matched ?? value)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          className="max-h-72 w-auto max-w-96 min-w-(--anchor-width)"
        >
          {IFC_CLASS_CHOICES.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_IFC_CLASS_VALUE}>Andere…</SelectItem>
        </SelectContent>
      </Select>
      {custom ? (
        <CommitInput
          ariaLabel="IFC-Klasse (Freitext)"
          disabled={disabled}
          placeholder="IfcBuildingElementProxy"
          value={value}
          onCommit={(next) => onChange(normalizeIfcClass(next))}
        />
      ) : null}
    </div>
  );
}

/** Input mit lokalem Entwurf; übernimmt den Wert bei Blur/Enter (Escape verwirft). */
function CommitInput({
  ariaLabel,
  disabled,
  placeholder,
  value,
  onCommit,
}: {
  ariaLabel: string;
  disabled?: boolean;
  placeholder?: string;
  value: string;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <Input
      aria-label={ariaLabel}
      className="h-7 min-w-0 text-xs text-foreground"
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function CheckboxField({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input
        checked={checked}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="grid gap-0.5">
        <span>{label}</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
