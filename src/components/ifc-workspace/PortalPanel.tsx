import {
  Box,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FlaskConical,
  Gauge,
  Landmark,
  Layers,
  ListChecks,
  Target,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  isRelationshipTypeAllowedForEndpointTypes,
  type NativeIfcDocument,
} from "@/ifc";
import { cn } from "@/lib/utils";
import { LINK_PSET_NAME } from "@/portal/catalogPsets";
import { PortalApiClient, PortalApiError } from "@/portal/client";
import {
  assignPortalLink,
  findEntityIdByExternalId,
  importPortalChildren,
  importPortalStructure,
  type PortalImportContext,
} from "@/portal/import";
import {
  portalExternalId,
  type PortalBauwerk,
  type PortalNode,
  type PortalProjekt,
  type PortalSettings,
  type PortalTokens,
} from "@/portal/types";

import {
  Badge,
  Button,
  CollapsibleSection,
  DropdownField,
  PanelHeader,
  PanelShell,
  SegmentedControl,
  Toolbar,
  ToolbarGroup,
  type DropdownOption,
} from "./ui";

/** Dokument-/Selektionsstand, gegen den ein Import angewendet wird. */
export interface PortalApplyTarget {
  document: NativeIfcDocument | null;
  selectedId: number | null;
}

export interface PortalPanelProps {
  document: NativeIfcDocument | null;
  selectedId: number | null;
  settings: PortalSettings;
  onSettingsChange: (settings: PortalSettings) => void;
  tokens: PortalTokens | null;
  onTokensChange: (tokens: PortalTokens | null) => void;
  onApplyImport: (nextDocument: NativeIfcDocument, summary: string) => void;
  onSelectEntity: (id: number) => void;
  /**
   * Liefert den zum ANWENDUNGSZEITPUNKT aktuellen Dokument-/Selektionsstand
   * (Ref im Workspace). Die Import-Aktionen laden erst Verfahrens-Records
   * über das Netz; würden sie danach gegen den Klick-Zeitpunkt-Snapshot
   * importieren, gingen zwischenzeitliche Änderungen verloren.
   */
  getApplyTarget: () => PortalApplyTarget;
}

type PortalTreeTab = "Diagnostik" | "Monitoring";

type PortalBusyAction = "assign" | "children" | "structure" | null;

interface PortalNodeIndexEntry {
  node: PortalNode;
  ancestors: string[];
  tab: PortalTreeTab;
}

const TREE_TABS: PortalTreeTab[] = ["Diagnostik", "Monitoring"];

const NODE_ICONS: Record<string, LucideIcon> = {
  bauteil: Box,
  bauwerk: Landmark,
  kanal: Waves,
  massnahme: ListChecks,
  messkonzept: ClipboardList,
  messstelle: Gauge,
  teilbauwerk: Layers,
  untersuchungsbereich: Target,
  untersuchungsstelle: Crosshair,
};

const CATEGORY_LABELS: Record<string, string> = {
  Laboruntersuchung: "Labor",
  VorOrtUntersuchung: "Vor Ort",
};

export function PortalPanel({
  document,
  selectedId,
  settings,
  onSettingsChange,
  tokens,
  onTokensChange,
  onApplyImport,
  onSelectEntity,
  getApplyTarget,
}: PortalPanelProps) {
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [bauwerke, setBauwerke] = useState<PortalBauwerk[] | null>(null);
  const [bauwerkeBusy, setBauwerkeBusy] = useState(false);
  const [projekte, setProjekte] = useState<PortalProjekt[] | null>(null);
  const [projekteBusy, setProjekteBusy] = useState(false);

  const [treeTab, setTreeTab] = useState<PortalTreeTab>("Diagnostik");
  const [diagnostikRoot, setDiagnostikRoot] = useState<PortalNode | null>(null);
  const [monitoringRoots, setMonitoringRoots] = useState<PortalNode[] | null>(
    null,
  );
  const [treeBusy, setTreeBusy] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<PortalBusyAction>(null);
  const [lastResult, setLastResult] = useState<{
    summary: string;
    warnings: string[];
  } | null>(null);

  const createClient = () =>
    new PortalApiClient(settings, tokens, onTokensChange);

  // --- Auswahl (Bauwerk / Projekt) --------------------------------------------

  const loadProjekte = async (
    bauwerkId: number,
    client = createClient(),
  ) => {
    setProjekteBusy(true);
    setError(null);
    try {
      setProjekte(await client.fetchProjekte(bauwerkId));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setProjekteBusy(false);
    }
  };

  const loadBauwerke = async () => {
    setBauwerkeBusy(true);
    setError(null);
    try {
      // EIN Client für beide Aufrufe: nach einem Token-Refresh hielte ein
      // zweiter Client sonst das bereits rotierte (ungültige) Token-Paar.
      const client = createClient();
      const list = await client.fetchBauwerke();
      setBauwerke(list);
      if (settings.bauwerkId !== null) {
        void loadProjekte(settings.bauwerkId, client);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBauwerkeBusy(false);
    }
  };

  const handleBauwerkChange = (value: string) => {
    if (!value) {
      onSettingsChange({
        ...settings,
        bauwerkId: null,
        bauwerkName: "",
        bauwerkNummer: "",
        projektId: null,
        projektName: "",
      });
      setProjekte(null);
      return;
    }
    const id = Number(value);
    const bauwerk = (bauwerke ?? []).find((candidate) => candidate.id === id);
    const name =
      bauwerk?.bezeichnung ||
      (id === settings.bauwerkId ? settings.bauwerkName : "") ||
      `Bauwerk ${id}`;
    const nummer =
      bauwerk?.bauwerksnummer ||
      (id === settings.bauwerkId ? settings.bauwerkNummer : "");
    onSettingsChange({
      ...settings,
      bauwerkId: id,
      bauwerkName: name,
      bauwerkNummer: nummer,
      projektId: null,
      projektName: "",
    });
    setProjekte(null);
    void loadProjekte(id);
  };

  const handleProjektChange = (value: string) => {
    if (!value) {
      onSettingsChange({ ...settings, projektId: null, projektName: "" });
      return;
    }
    const id = Number(value);
    const name =
      (projekte ?? []).find((projekt) => projekt.id === id)?.bezeichnung ||
      (id === settings.projektId ? settings.projektName : "") ||
      `Projekt ${id}`;
    onSettingsChange({ ...settings, projektId: id, projektName: name });
  };

  const bauwerkOptions = useMemo<DropdownOption[]>(() => {
    const options: DropdownOption[] = [
      { label: "– Bitte wählen –", value: "" },
    ];
    const list = bauwerke ?? [];
    if (
      settings.bauwerkId !== null &&
      !list.some((bauwerk) => bauwerk.id === settings.bauwerkId)
    ) {
      options.push({
        label: settings.bauwerkName || `Bauwerk ${settings.bauwerkId}`,
        value: String(settings.bauwerkId),
      });
    }
    for (const bauwerk of list) {
      options.push({ label: bauwerk.bezeichnung, value: String(bauwerk.id) });
    }
    return options;
  }, [bauwerke, settings.bauwerkId, settings.bauwerkName]);

  const projektOptions = useMemo<DropdownOption[]>(() => {
    const options: DropdownOption[] = [
      { label: "– Bitte wählen –", value: "" },
    ];
    const list = projekte ?? [];
    if (
      settings.projektId !== null &&
      !list.some((projekt) => projekt.id === settings.projektId)
    ) {
      options.push({
        label: settings.projektName || `Projekt ${settings.projektId}`,
        value: String(settings.projektId),
      });
    }
    for (const projekt of list) {
      options.push({
        detail: projekt.typ,
        label: projekt.bezeichnung,
        value: String(projekt.id),
      });
    }
    return options;
  }, [projekte, settings.projektId, settings.projektName]);

  // --- Anmeldung ----------------------------------------------------------------

  const handleLogin = async () => {
    // Enter im Passwortfeld muss dieselben Guards wie der Button einhalten
    // (kein Doppel-Submit, keine leeren Zugangsdaten).
    if (loginBusy || !loginName.trim() || !loginPassword) {
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      await createClient().login(loginName.trim(), loginPassword);
      setLoginPassword("");
    } catch (cause) {
      setLoginError(errorText(cause));
    } finally {
      setLoginBusy(false);
    }
  };

  // --- Baum -----------------------------------------------------------------------

  const canLoadTree =
    settings.useMockData ||
    (treeTab === "Diagnostik"
      ? settings.bauwerkId !== null && settings.projektId !== null
      : settings.bauwerkId !== null);

  const loadTree = async () => {
    setTreeBusy(true);
    setError(null);
    try {
      const client = createClient();
      if (treeTab === "Diagnostik") {
        const root = await client.fetchHierarchy(
          settings.bauwerkId ?? 0,
          settings.projektId ?? 0,
        );
        setDiagnostikRoot(root);
        setExpandedKeys(
          (prev) => new Set([...prev, portalExternalId(root)]),
        );
      } else {
        const roots = await client.fetchMonitoringTree(settings.bauwerkId ?? 0);
        setMonitoringRoots(roots);
        setExpandedKeys(
          (prev) => new Set([...prev, ...roots.map(portalExternalId)]),
        );
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setTreeBusy(false);
    }
  };

  const roots = useMemo<PortalNode[]>(() => {
    if (treeTab === "Diagnostik") {
      return diagnostikRoot ? [diagnostikRoot] : [];
    }
    return monitoringRoots ?? [];
  }, [diagnostikRoot, monitoringRoots, treeTab]);

  const nodeIndex = useMemo(() => {
    const map = new Map<string, PortalNodeIndexEntry>();
    const walk = (node: PortalNode, ancestors: string[], tab: PortalTreeTab) => {
      const key = portalExternalId(node);
      if (!map.has(key)) {
        map.set(key, { ancestors, node, tab });
      }
      for (const child of node.children) {
        walk(child, [...ancestors, key], tab);
      }
    };
    if (diagnostikRoot) {
      walk(diagnostikRoot, [], "Diagnostik");
    }
    for (const root of monitoringRoots ?? []) {
      walk(root, [], "Monitoring");
    }
    return map;
  }, [diagnostikRoot, monitoringRoots]);

  const selectedNode = selectedNodeKey
    ? (nodeIndex.get(selectedNodeKey)?.node ?? null)
    : null;

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // --- Verknüpfungs-Info ------------------------------------------------------------

  const linkedExternalId = useMemo(() => {
    if (!document || selectedId === null) {
      return null;
    }
    for (const set of document.propertySetsByEntity.get(selectedId) ?? []) {
      if (set.name !== LINK_PSET_NAME) {
        continue;
      }
      const property = set.values.find((value) => value.name === "ExternalId");
      if (property) {
        const externalId = readIfcValueText(property.value);
        return externalId || null;
      }
    }
    return null;
  }, [document, selectedId]);

  const showLinkedInTree = () => {
    if (!linkedExternalId) {
      return;
    }
    const entry = nodeIndex.get(linkedExternalId);
    if (!entry) {
      return;
    }
    setTreeTab(entry.tab);
    setExpandedKeys((prev) => new Set([...prev, ...entry.ancestors]));
    setSelectedNodeKey(linkedExternalId);
    setQuery("");
  };

  /** Bereits importiertes Element des ausgewählten Portal-Knotens (falls vorhanden). */
  const linkedEntityForNode = useMemo(() => {
    if (!document || !selectedNode) {
      return null;
    }
    return findEntityIdByExternalId(document, portalExternalId(selectedNode));
  }, [document, selectedNode]);

  // --- Import-Aktionen -----------------------------------------------------------------

  /**
   * Dot-ID-Präfix (Bauwerksnummer.Teilbauwerksnummer.Projekt) für einen
   * Portal-Knoten: Die Bauwerksnummer kommt aus den Einstellungen (der
   * Hierarchie-Payload liefert sie nicht), Teilbauwerksnummer und Projekt
   * werden über die Vorfahren-Kette des Knotens im geladenen Baum aufgelöst —
   * so stimmt das Präfix auch, wenn der Import mitten im Baum (z. B. am
   * zugeordneten UB) startet.
   */
  const idPrefixForNode = (
    node: PortalNode | null,
  ): NonNullable<PortalImportContext["idPrefix"]> => {
    const prefix: NonNullable<PortalImportContext["idPrefix"]> = {
      bauwerk: settings.bauwerkNummer || settings.bauwerkName || undefined,
      projekt: settings.projektName || undefined,
    };
    if (!node) {
      return prefix;
    }
    const entry = nodeIndex.get(portalExternalId(node));
    const chain = [...(entry?.ancestors ?? []), portalExternalId(node)];
    for (const key of chain) {
      const ancestor = nodeIndex.get(key)?.node;
      if (!ancestor) {
        continue;
      }
      if (ancestor.nodeType === "bauwerk") {
        const projekt = ancestor.raw.projekt;
        if (typeof projekt === "object" && projekt !== null && !Array.isArray(projekt)) {
          const name = (projekt as Record<string, unknown>).name;
          if (typeof name === "string" && name.trim()) {
            prefix.projekt = name;
          }
        }
        if (!prefix.bauwerk) {
          prefix.bauwerk = ancestor.name;
        }
      } else if (ancestor.nodeType === "teilbauwerk") {
        const number =
          typeof ancestor.raw.number === "number"
            ? String(ancestor.raw.number)
            : typeof ancestor.raw.number === "string"
              ? ancestor.raw.number.trim()
              : "";
        prefix.teilbauwerk = number || ancestor.name;
      }
    }
    return prefix;
  };

  const buildContext = (
    verfahrenRecords?: Map<string, Record<string, unknown>>,
    prefixNode: PortalNode | null = null,
  ): PortalImportContext => ({
    idPrefix: idPrefixForNode(prefixNode),
    mapping: settings.mapping,
    psetOptions: settings.psetOptions,
    verfahrenRecords,
  });

  const applyResult = (
    baseDocument: NativeIfcDocument,
    result: { document: NativeIfcDocument; summary: string; warnings: string[] },
    extraWarnings: string[] = [],
  ) => {
    setLastResult({
      summary: result.summary,
      warnings: [...extraWarnings, ...result.warnings],
    });
    if (result.document !== baseDocument) {
      onApplyImport(result.document, result.summary);
    }
  };

  /**
   * Verfahrens-Rohdaten defensiv laden (nur Diagnostik). Fehler werden als
   * Warnung toleriert; der Import läuft dann ohne Record-Daten weiter.
   * Abweichend von der Spezifikation auch im Mock-Modus, weil der Client dort
   * ohne Netzzugriff Mock-Records liefert.
   */
  const fetchRecordsTolerant = async (
    warnings: string[],
  ): Promise<Map<string, Record<string, unknown>> | undefined> => {
    if (treeTab !== "Diagnostik") {
      return undefined;
    }
    if (
      !settings.useMockData &&
      (settings.bauwerkId === null || settings.projektId === null)
    ) {
      warnings.push(
        "Verfahrens-Rohdaten übersprungen: Bauwerk und Projekt sind nicht gewählt.",
      );
      return undefined;
    }
    try {
      return await createClient().fetchVerfahrenRecords(
        settings.bauwerkId ?? 0,
        settings.projektId ?? 0,
      );
    } catch (cause) {
      warnings.push(
        `Verfahrens-Rohdaten konnten nicht geladen werden: ${errorText(cause)}`,
      );
      return undefined;
    }
  };

  const handleAssign = () => {
    if (!document || selectedId === null || !selectedNode) {
      return;
    }
    setBusyAction("assign");
    setError(null);
    try {
      const result = assignPortalLink(
        document,
        selectedId,
        selectedNode,
        buildContext(undefined, selectedNode),
      );
      applyResult(document, result);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportChildren = async () => {
    if (!document || !selectedNode) {
      return;
    }
    if (linkedEntityForNode === null && selectedId === null) {
      return;
    }
    setBusyAction("children");
    setError(null);
    try {
      const warnings: string[] = [];
      const records = await fetchRecordsTolerant(warnings);
      // Nach dem Netz-Roundtrip gegen den DANN aktuellen Dokument-/
      // Selektionsstand importieren, damit während des Ladens gemachte
      // Änderungen nicht verworfen werden.
      const target = getApplyTarget();
      if (!target.document) {
        return;
      }
      const host =
        findEntityIdByExternalId(
          target.document,
          portalExternalId(selectedNode),
        ) ?? hostCandidateId(target.document, target.selectedId);
      if (host === null) {
        setError(
          "Kein gültiges Host-Element gewählt (räumliches Element oder Produkt erwartet).",
        );
        return;
      }
      const result = importPortalChildren(
        target.document,
        host,
        selectedNode,
        buildContext(records, selectedNode),
      );
      applyResult(target.document, result, warnings);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const handleImportStructure = async () => {
    if (!document || roots.length === 0) {
      return;
    }
    setBusyAction("structure");
    setError(null);
    try {
      const warnings: string[] = [];
      const records = await fetchRecordsTolerant(warnings);
      // Nach dem Netz-Roundtrip gegen den DANN aktuellen Dokument-/
      // Selektionsstand importieren (siehe handleImportChildren).
      const target = getApplyTarget();
      if (!target.document) {
        return;
      }
      // Host-Fallback: taugt die Editor-Selektion nicht als Aggregations-
      // Wurzel (Pset, Material, …) oder fehlt sie, wird das erste
      // IfcBuilding, sonst das IfcProject verwendet.
      const host =
        hostCandidateId(target.document, target.selectedId) ??
        firstEntityIdOfType(target.document, "IFCBUILDING") ??
        firstEntityIdOfType(target.document, "IFCPROJECT");
      if (host === null) {
        setError(
          "Kein Host-Element gefunden (weder Auswahl noch IfcBuilding/IfcProject).",
        );
        return;
      }
      let current = target.document;
      const summaries: string[] = [];
      // Monitoring liefert mehrere Wurzeln; die Importe werden auf demselben
      // Host verkettet und erst am Ende einmal übernommen.
      for (const root of roots) {
        const result = importPortalStructure(
          current,
          root,
          host,
          buildContext(records),
        );
        current = result.document;
        summaries.push(result.summary);
        warnings.push(...result.warnings);
      }
      const summary = summaries.join(" · ");
      setLastResult({ summary, warnings });
      if (current !== target.document) {
        onApplyImport(current, summary);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyAction(null);
    }
  };

  const busy = busyAction !== null;
  const canAssign =
    !busy && !!document && selectedId !== null && !!selectedNode;
  const canImportChildren =
    !busy &&
    !!document &&
    !!selectedNode &&
    (linkedEntityForNode !== null || selectedId !== null);
  const canImportStructure = !busy && !!document && roots.length > 0;

  const token = query.trim().toLowerCase();

  return (
    <PanelShell>
      <PanelHeader
        title="MKP Portal"
        description="Diagnostik- und Monitoring-Struktur aus dem MKP-Portal laden und IFC-Elementen zuordnen."
        meta={
          <>
            {settings.useMockData ? (
              <Badge tone="info">Mock-Daten</Badge>
            ) : null}
            <Badge tone={tokens ? "success" : "neutral"}>
              {tokens ? "Angemeldet" : "Nicht angemeldet"}
            </Badge>
          </>
        }
        actions={
          tokens ? (
            <Button label="Abmelden" onPress={() => onTokensChange(null)} />
          ) : null
        }
      />

      {error ? <AlertMessage message={error} /> : null}

      <PanelShell scroll>
        {!tokens ? (
          <CollapsibleSection
            defaultOpen={!settings.useMockData}
            title="Anmeldung"
            meta={
              settings.useMockData
                ? "Mock-Modus: Anmeldung optional"
                : "MKP-Portal-Konto (Keycloak)"
            }
          >
            <TextField
              label="Benutzername"
              value={loginName}
              onChangeText={setLoginName}
            />
            <TextField
              label="Passwort"
              type="password"
              value={loginPassword}
              onChangeText={setLoginPassword}
              onSubmit={() => void handleLogin()}
            />
            {loginError ? <AlertMessage message={loginError} /> : null}
            <Button
              disabled={loginBusy || !loginName.trim() || !loginPassword}
              label={loginBusy ? "Lädt…" : "Anmelden"}
              primary
              onPress={() => void handleLogin()}
            />
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          defaultOpen
          title="Bauwerk & Projekt"
          meta={
            settings.bauwerkId !== null
              ? `${settings.bauwerkName || `Bauwerk ${settings.bauwerkId}`}${
                  settings.projektId !== null
                    ? ` · ${settings.projektName || `Projekt ${settings.projektId}`}`
                    : ""
                }`
              : "Nichts gewählt"
          }
        >
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <DropdownField
                label="Bauwerk"
                options={bauwerkOptions}
                value={
                  settings.bauwerkId !== null ? String(settings.bauwerkId) : ""
                }
                onChange={handleBauwerkChange}
              />
            </div>
            <Button
              disabled={bauwerkeBusy}
              label={bauwerkeBusy ? "Lädt…" : "Laden"}
              onPress={() => void loadBauwerke()}
            />
          </div>
          <DropdownField
            label={projekteBusy ? "Projekt (lädt…)" : "Projekt"}
            options={projektOptions}
            value={
              settings.projektId !== null ? String(settings.projektId) : ""
            }
            onChange={handleProjektChange}
          />
        </CollapsibleSection>

        <div className="grid shrink-0 gap-2">
          <SegmentedControl
            options={TREE_TABS}
            value={treeTab}
            onChange={(value) =>
              setTreeTab(value === "Monitoring" ? "Monitoring" : "Diagnostik")
            }
          />
          <div className="flex items-center gap-2">
            <Button
              disabled={treeBusy || !canLoadTree}
              label={treeBusy ? "Lädt…" : "Struktur laden"}
              primary={roots.length === 0}
              onPress={() => void loadTree()}
            />
            <Input
              aria-label="Baum durchsuchen"
              className="h-8 min-w-0 flex-1 text-sm"
              placeholder="Suchen…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </div>
          {!canLoadTree ? (
            <p className="text-[11px] text-muted-foreground">
              {treeTab === "Diagnostik"
                ? "Zum Laden zuerst Bauwerk und Projekt wählen (oder Mock-Daten aktivieren)."
                : "Zum Laden zuerst ein Bauwerk wählen (oder Mock-Daten aktivieren)."}
            </p>
          ) : null}
        </div>

        {roots.length ? (
          <div className="grid shrink-0 gap-0.5 rounded-lg border border-border/60 bg-card p-1.5">
            {roots.map((root) => (
              <PortalTreeRow
                key={portalExternalId(root)}
                depth={0}
                expandedKeys={expandedKeys}
                node={root}
                selectedKey={selectedNodeKey}
                token={token}
                onSelect={setSelectedNodeKey}
                onToggle={toggleKey}
              />
            ))}
          </div>
        ) : (
          <div className="grid shrink-0 place-items-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            {treeTab === "Diagnostik"
              ? "Noch keine Diagnostik-Struktur geladen."
              : "Noch keine Monitoring-Struktur geladen."}
          </div>
        )}

        {linkedExternalId ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs">
            <span className="text-muted-foreground">Verknüpft mit:</span>
            <code className="font-mono text-foreground">
              {linkedExternalId}
            </code>
            <Button
              disabled={!nodeIndex.has(linkedExternalId)}
              label="Im Baum zeigen"
              onPress={showLinkedInTree}
            />
          </div>
        ) : null}

        {lastResult ? (
          <div className="grid shrink-0 gap-1 rounded-lg border border-border/60 bg-card px-3 py-2">
            <span className="text-sm font-medium text-foreground">
              {lastResult.summary}
            </span>
            {lastResult.warnings.map((warning, index) => (
              <span
                key={`${index}-${warning}`}
                className="text-xs text-amber-600 dark:text-amber-400"
              >
                {warning}
              </span>
            ))}
          </div>
        ) : null}
      </PanelShell>

      <div className="grid shrink-0 gap-1.5">
        <p className="px-1 text-[11px] text-muted-foreground">
          Baum-Auswahl:{" "}
          {selectedNode
            ? `${selectedNode.name} (${portalExternalId(selectedNode)})`
            : "keine"}{" "}
          · Editor-Auswahl: {selectedId !== null ? `#${selectedId}` : "keine"}
        </p>
        <Toolbar>
          <ToolbarGroup>
            <Button
              disabled={!canAssign}
              label={busyAction === "assign" ? "Lädt…" : "Auswahl zuordnen"}
              primary
              onPress={handleAssign}
            />
            <Button
              disabled={!canImportChildren}
              label={
                busyAction === "children" ? "Lädt…" : "Kinder importieren"
              }
              onPress={() => void handleImportChildren()}
            />
            <Button
              disabled={!canImportStructure}
              label={
                busyAction === "structure"
                  ? "Lädt…"
                  : "Komplette Struktur importieren"
              }
              onPress={() => void handleImportStructure()}
            />
          </ToolbarGroup>
          {linkedEntityForNode !== null ? (
            <ToolbarGroup>
              <Button
                label={`Element #${linkedEntityForNode} wählen`}
                onPress={() => onSelectEntity(linkedEntityForNode)}
              />
            </ToolbarGroup>
          ) : null}
        </Toolbar>
      </div>
    </PanelShell>
  );
}

function PortalTreeRow({
  depth,
  expandedKeys,
  node,
  selectedKey,
  token,
  onSelect,
  onToggle,
}: {
  depth: number;
  expandedKeys: Set<string>;
  node: PortalNode;
  selectedKey: string | null;
  token: string;
  onSelect(key: string): void;
  onToggle(key: string): void;
}) {
  const key = portalExternalId(node);
  if (token && !nodeMatches(node, token)) {
    return null;
  }
  const hasChildren = node.children.length > 0;
  // Bei aktiver Suche werden Treffer-Pfade immer aufgeklappt.
  const expanded = token ? true : expandedKeys.has(key);
  const selected = selectedKey === key;
  const Icon = NODE_ICONS[node.nodeType] ?? FlaskConical;
  const categoryLabel =
    node.category && node.category !== "Monitoring"
      ? (CATEGORY_LABELS[node.category] ?? node.category)
      : null;

  return (
    <>
      <div
        className="flex min-w-0 items-center gap-1"
        style={{ paddingLeft: depth * 14 }}
      >
        <button
          type="button"
          aria-label={expanded ? "Zuklappen" : "Aufklappen"}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60",
            !hasChildren && "invisible",
          )}
          onClick={() => onToggle(key)}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          title={key}
          onClick={() => onSelect(key)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-foreground hover:bg-muted/50",
            selected && "bg-primary/10 ring-1 ring-primary/40",
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">{node.name}</span>
          {categoryLabel ? <Badge tone="info">{categoryLabel}</Badge> : null}
          {node.abgeschlossen ? (
            <Badge tone="success">Abgeschlossen</Badge>
          ) : null}
          {hasChildren ? (
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {node.children.length}
            </span>
          ) : null}
        </button>
      </div>
      {expanded && hasChildren
        ? node.children.map((child) => (
            <PortalTreeRow
              key={portalExternalId(child)}
              depth={depth + 1}
              expandedKeys={expandedKeys}
              node={child}
              selectedKey={selectedKey}
              token={token}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

function TextField({
  label,
  type,
  value,
  onChangeText,
  onSubmit,
}: {
  label: string;
  type?: "text" | "password";
  value: string;
  onChangeText(value: string): void;
  onSubmit?(): void;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      <Input
        className="text-foreground"
        type={type ?? "text"}
        value={value}
        onChange={(event) => onChangeText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit?.();
          }
        }}
      />
    </label>
  );
}

function AlertMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function nodeMatches(node: PortalNode, token: string): boolean {
  if (node.name.toLowerCase().includes(token)) {
    return true;
  }
  return node.children.some((child) => nodeMatches(child, token));
}

function firstEntityIdOfType(
  document: NativeIfcDocument,
  type: string,
): number | null {
  return document.entitiesByType.get(type)?.[0]?.id ?? null;
}

/**
 * Prüft, ob die Editor-Selektion als Import-Host taugt. Nur Objekt-Entities
 * (räumliche Struktur, Produkte, Gruppen, IfcProject) kommen infrage — ein
 * Pset, Material oder eine Beziehung als Host würde ungültige
 * IfcRelAggregates-/Containment-Beziehungen erzeugen.
 */
function hostCandidateId(
  document: NativeIfcDocument,
  id: number | null,
): number | null {
  if (id === null) {
    return null;
  }
  const type = document.entityById.get(id)?.type;
  if (!type) {
    return null;
  }
  if (type === "IFCPROJECT" || type === "IFCANNOTATION") {
    return id;
  }
  if (type === "IFCTYPEOBJECT" || type.endsWith("TYPE")) {
    return null;
  }
  return isRelationshipTypeAllowedForEndpointTypes(
    "IFCRELAGGREGATES",
    type,
    "IFCBUILDINGELEMENTPROXY",
  )
    ? id
    : null;
}

/** STEP-Wert (z. B. IFCLABEL('ub:1')) in reinen Text auspacken. */
function readIfcValueText(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "$") {
    return "";
  }
  const match = text.match(/^[A-Z0-9_]+\((.*)\)$/i);
  const inner = match ? match[1] : text;
  return inner
    .replace(/^'(.*)'$/s, "$1")
    .replace(/''/g, "'")
    .trim();
}

function errorText(cause: unknown): string {
  if (cause instanceof PortalApiError) {
    return cause.detail ? `${cause.message} ${cause.detail}` : cause.message;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return "Unbekannter Fehler.";
}
