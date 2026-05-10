import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';

import IfcThreeViewer from './ifc-three-viewer.web';
import { IfcPierreTree, IfcStepDiffPanel } from './ifc-pierre-panels.web';

import {
  type BuilderProductOptions,
  createMinimalIfcProject,
  createMinimalIfcProjectBytes,
  getBuilderProductExpressID,
  IFC_CAPABILITY_MATRIX,
  loadGeometryForSession,
  openIfcModel,
  type IfcModelSession,
} from '@/ifc';

type InspectorTab = 'entity' | 'properties' | 'diagnostics';
type BuilderMetaField = 'projectName' | 'siteName' | 'buildingName' | 'storeyName';
type BuilderProductTextField =
  | 'name'
  | 'tag'
  | 'reference'
  | 'monitoringRole'
  | 'materialName'
  | 'materialCategory'
  | 'classificationCode'
  | 'classificationName'
  | 'classificationUri'
  | 'documentIdentification'
  | 'documentName'
  | 'documentUri';
type BuilderProductNumberField = 'x' | 'y' | 'z' | 'width' | 'depth' | 'height';

interface BuilderProductDraft {
  id: string;
  name: string;
  tag: string;
  reference: string;
  monitoringRole: string;
  materialName: string;
  materialCategory: string;
  classificationCode: string;
  classificationName: string;
  classificationUri: string;
  documentIdentification: string;
  documentName: string;
  documentUri: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
}

interface BuilderDraft {
  projectName: string;
  siteName: string;
  buildingName: string;
  storeyName: string;
  products: BuilderProductDraft[];
}

const INITIAL_BUILDER_DRAFT = createDefaultBuilderDraft();

export default function IfcWorkspace() {
  const [session, setSession] = useState<IfcModelSession | undefined>();
  const [selectedExpressID, setSelectedExpressID] = useState<number | undefined>();
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Ready');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('entity');
  const [builderDraft, setBuilderDraft] = useState<BuilderDraft>(() => INITIAL_BUILDER_DRAFT);
  const [selectedProductDraftID, setSelectedProductDraftID] = useState(
    () => INITIAL_BUILDER_DRAFT.products[0].id,
  );
  const [sourceStepText, setSourceStepText] = useState(() =>
    createMinimalIfcProject(draftToProjectOptions(INITIAL_BUILDER_DRAFT)),
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const workbenchLayout = useDefaultLayout({
    id: 'ifcnative-workbench',
    panelIds: ['structure', 'viewer', 'inspector'],
  });
  const builderEditorLayout = useDefaultLayout({
    id: 'ifcnative-builder-editor',
    panelIds: ['builder-context', 'product-editor'],
  });
  const utilityLayout = useDefaultLayout({
    id: 'ifcnative-utilities',
    panelIds: ['visibility', 'coverage'],
  });

  useEffect(() => () => session?.close(), [session]);

  const selectedEntity = selectedExpressID
    ? session?.graph.byExpressID.get(selectedExpressID)
    : undefined;
  const selectedProperties = selectedExpressID
    ? [
        ...(session?.properties.byObject.get(selectedExpressID) ?? []),
        ...(session?.properties.byType.get(session?.graph.typeByOccurrence.get(selectedExpressID) ?? -1) ?? []),
      ]
    : [];
  const selectedDraftProduct =
    builderDraft.products.find((product) => product.id === selectedProductDraftID) ?? builderDraft.products[0];

  const metrics = useMemo(() => {
    const totalEntities = session?.graph.entityCounts.reduce((sum, entry) => sum + entry.count, 0) ?? 0;
    const relationshipCount = session?.graph.relationships.length ?? 0;
    const geometryPieces = session?.geometry?.pieces.length ?? 0;
    const diagnostics = session?.diagnostics.length ?? 0;
    return { totalEntities, relationshipCount, geometryPieces, diagnostics };
  }, [session]);

  const savedStepText = useMemo(() => {
    const bytes = session?.save() ?? createMinimalIfcProjectBytes();
    return new TextDecoder().decode(bytes);
  }, [session]);

  useEffect(() => {
    const index = builderDraft.products.findIndex(
      (_product, productIndex) => getBuilderProductExpressID(productIndex) === selectedExpressID,
    );
    if (index >= 0) {
      setSelectedProductDraftID(builderDraft.products[index].id);
    }
  }, [builderDraft.products, selectedExpressID]);

  const replaceSession = (next: IfcModelSession) => {
    session?.close();
    setSession(next);
    setSelectedExpressID(next.graph.spatialTree[0]?.expressID);
    setHiddenTypes(new Set());
    setInspectorTab('entity');
  };

  const openBytes = async (data: Uint8Array, filename: string) => {
    setBusy(true);
    setMessage(`Opening ${filename}...`);
    try {
      const next = await openIfcModel({ data, filename, loadGeometry: true });
      replaceSession(next);
      setSourceStepText(new TextDecoder().decode(data));
      setMessage(`Loaded ${filename}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    await openBytes(new Uint8Array(buffer), file.name);
  };

  const createScaffold = async () => {
    await applyBuilderDraft(builderDraft, selectedProductDraftID);
  };

  const applyBuilderDraft = async (nextDraft = builderDraft, selectProductID = selectedProductDraftID) => {
    setBuilderDraft(nextDraft);
    const text = createMinimalIfcProject(draftToProjectOptions(nextDraft));
    const selectedProductIndex = nextDraft.products.findIndex((product) => product.id === selectProductID);
    await openBytes(new TextEncoder().encode(text), 'IFCnative_Builder_Edit.ifc');
    if (selectedProductIndex >= 0) {
      setSelectedExpressID(getBuilderProductExpressID(selectedProductIndex));
    }
  };

  const exportModel = () => {
    const bytes = session?.save() ?? createMinimalIfcProjectBytes();
    const filename = session?.filename?.replace(/\.ifc$/i, '') ?? 'IFCnative_Builder_Sample';
    downloadBytes(bytes, `${filename}.ifc`);
  };

  const reloadGeometry = () => {
    if (!session) {
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      loadGeometryForSession(session);
      setSession({ ...session });
      setBusy(false);
    }, 0);
  };

  const toggleType = (typeName: string) => {
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(typeName)) {
        next.delete(typeName);
      } else {
        next.add(typeName);
      }
      return next;
    });
  };

  const updateBuilderMeta = (field: BuilderMetaField, value: string) => {
    setBuilderDraft((current) => ({ ...current, [field]: value }));
  };

  const updateSelectedProductText = (field: BuilderProductTextField, value: string) => {
    setBuilderDraft((current) => ({
      ...current,
      products: current.products.map((product) =>
        product.id === selectedProductDraftID ? { ...product, [field]: value } : product,
      ),
    }));
  };

  const updateSelectedProductNumber = (field: BuilderProductNumberField, value: string) => {
    const numericValue = Number(value);
    setBuilderDraft((current) => ({
      ...current,
      products: current.products.map((product) =>
        product.id === selectedProductDraftID
          ? { ...product, [field]: Number.isFinite(numericValue) ? numericValue : 0 }
          : product,
      ),
    }));
  };

  const addProduct = () => {
    const nextProduct = createBuilderProductDraft(builderDraft.products.length);
    const nextDraft = {
      ...builderDraft,
      products: [...builderDraft.products, nextProduct],
    };
    setSelectedProductDraftID(nextProduct.id);
    void applyBuilderDraft(nextDraft, nextProduct.id);
  };

  const duplicateSelectedProduct = () => {
    const selectedProduct = selectedDraftProduct;
    const nextProduct = {
      ...selectedProduct,
      id: createProductID(),
      name: `${selectedProduct.name} Copy`,
      tag: `${selectedProduct.tag}-COPY`,
      x: selectedProduct.x + selectedProduct.width + 1,
    };
    const nextDraft = {
      ...builderDraft,
      products: [...builderDraft.products, nextProduct],
    };
    setSelectedProductDraftID(nextProduct.id);
    void applyBuilderDraft(nextDraft, nextProduct.id);
  };

  const deleteSelectedProduct = () => {
    if (builderDraft.products.length <= 1) {
      return;
    }
    const nextProducts = builderDraft.products.filter((product) => product.id !== selectedProductDraftID);
    const nextSelectedID = nextProducts[0].id;
    const nextDraft = { ...builderDraft, products: nextProducts };
    setSelectedProductDraftID(nextSelectedID);
    void applyBuilderDraft(nextDraft, nextSelectedID);
  };

  return (
    <main className="ifc-shell">
      <header className="ifc-topbar">
        <div>
          <span className="ifc-eyebrow">Native IFC Builder / Viewer</span>
          <h1>IFCnative</h1>
        </div>
        <div className="ifc-actions">
          <input
            accept=".ifc"
            ref={fileInput}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) {
                void handleFile(file);
              }
              event.currentTarget.value = '';
            }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import IFC
          </button>
          <button type="button" onClick={createScaffold} disabled={busy}>
            Builder Scaffold
          </button>
          <button type="button" onClick={exportModel}>
            Export IFC
          </button>
        </div>
      </header>

      <section className="ifc-statusline">
        <span>{message}</span>
        <span>{session?.schema ?? 'No schema loaded'}</span>
        <span>{formatBytes(session?.size ?? 0)}</span>
      </section>

      <section className="ifc-metrics" aria-label="Model summary">
        <Metric label="Entities" value={metrics.totalEntities} />
        <Metric label="Relationships" value={metrics.relationshipCount} />
        <Metric label="Geometry parts" value={metrics.geometryPieces} />
        <Metric label="Diagnostics" value={metrics.diagnostics} />
      </section>

      <section className="ifc-workbench" aria-label="Desktop workspace panels">
        <Group id="ifcnative-workbench" orientation="horizontal" {...workbenchLayout}>
          <Panel className="ifc-panel-frame" defaultSize={31} id="structure" minSize={18}>
            <aside className="ifc-pane ifc-tree-pane">
              <PaneTitle title="Structure" subtitle="Spatial + containment graph" />
              <div className="ifc-tree ifc-tree-pierre">
                {session?.graph.spatialTree.length ? (
                  <IfcPierreTree
                    roots={session.graph.spatialTree}
                    selectedExpressID={selectedExpressID}
                    onSelect={setSelectedExpressID}
                  />
                ) : (
                  <EmptyState text="No model loaded." />
                )}
              </div>
            </aside>
          </Panel>
          <Separator className="ifc-resize-handle" aria-label="Resize structure and viewer panels" />
          <Panel className="ifc-panel-frame" defaultSize={46} id="viewer" minSize={28}>
            <section className="ifc-view-pane">
              <div className="ifc-view-toolbar">
                <PaneTitle title="3D Viewer" subtitle="web-ifc streamed mesh buffers" />
                <div>
                  <button type="button" onClick={reloadGeometry} disabled={!session || busy}>
                    Reload Geometry
                  </button>
                </div>
              </div>
              <IfcThreeViewer
                geometry={session?.geometry}
                hiddenTypes={hiddenTypes}
                selectedExpressID={selectedExpressID}
                onSelect={setSelectedExpressID}
              />
            </section>
          </Panel>
          <Separator className="ifc-resize-handle" aria-label="Resize viewer and inspector panels" />
          <Panel className="ifc-panel-frame" defaultSize={23} id="inspector" minSize={16}>
            <aside className="ifc-pane ifc-inspector-pane">
              <div className="ifc-tabs" role="tablist">
                {(['entity', 'properties', 'diagnostics'] as InspectorTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={inspectorTab === tab ? 'active' : ''}
                    onClick={() => setInspectorTab(tab)}>
                    {tab}
                  </button>
                ))}
              </div>
              {inspectorTab === 'entity' && (
                <EntityInspector
                  session={session}
                  selectedExpressID={selectedExpressID}
                  selectedName={selectedEntity?.name}
                />
              )}
              {inspectorTab === 'properties' && (
                <PropertyInspector selectedProperties={selectedProperties} />
              )}
              {inspectorTab === 'diagnostics' && <DiagnosticsPanel session={session} />}
            </aside>
          </Panel>
        </Group>
      </section>

      <section className="ifc-editor-grid" aria-label="Builder editor panels">
        <Group id="ifcnative-builder-editor" orientation="horizontal" {...builderEditorLayout}>
          <Panel className="ifc-panel-frame" defaultSize={32} id="builder-context" minSize={22}>
            <div className="ifc-pane ifc-builder-pane">
          <PaneTitle title="Builder Edit" subtitle="IFC4X3 project, spatial names, product geometry" />
          <div className="ifc-form-grid">
            <label>
              <span>Project</span>
              <input
                value={builderDraft.projectName}
                onChange={(event) => updateBuilderMeta('projectName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Site</span>
              <input
                value={builderDraft.siteName}
                onChange={(event) => updateBuilderMeta('siteName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Building</span>
              <input
                value={builderDraft.buildingName}
                onChange={(event) => updateBuilderMeta('buildingName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Storey</span>
              <input
                value={builderDraft.storeyName}
                onChange={(event) => updateBuilderMeta('storeyName', event.currentTarget.value)}
              />
            </label>
          </div>
            </div>
          </Panel>
          <Separator className="ifc-resize-handle" aria-label="Resize builder edit and product edit panels" />
          <Panel className="ifc-panel-frame" defaultSize={68} id="product-editor" minSize={42}>
            <div className="ifc-pane ifc-builder-pane">
          <PaneTitle title="Product Edit" subtitle="Selected IfcBuiltElement" />
          <div className="ifc-product-selector">
            {builderDraft.products.map((product, index) => (
              <button
                type="button"
                key={product.id}
                className={product.id === selectedProductDraftID ? 'active' : ''}
                onClick={() => {
                  setSelectedProductDraftID(product.id);
                  setSelectedExpressID(getBuilderProductExpressID(index));
                }}>
                #{getBuilderProductExpressID(index)} {product.name}
              </button>
            ))}
          </div>
          <div className="ifc-form-grid ifc-product-form">
            <label>
              <span>Name</span>
              <input
                value={selectedDraftProduct.name}
                onChange={(event) => updateSelectedProductText('name', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Tag</span>
              <input
                value={selectedDraftProduct.tag}
                onChange={(event) => updateSelectedProductText('tag', event.currentTarget.value)}
              />
            </label>
            {(['x', 'y', 'z', 'width', 'depth', 'height'] as BuilderProductNumberField[]).map((field) => (
              <label key={field}>
                <span>{field}</span>
                <input
                  type="number"
                  step="0.1"
                  value={selectedDraftProduct[field]}
                  onChange={(event) => updateSelectedProductNumber(field, event.currentTarget.value)}
                />
              </label>
            ))}
            <label>
              <span>Reference</span>
              <input
                value={selectedDraftProduct.reference}
                onChange={(event) => updateSelectedProductText('reference', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>MonitoringRole</span>
              <input
                value={selectedDraftProduct.monitoringRole}
                onChange={(event) => updateSelectedProductText('monitoringRole', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Material</span>
              <input
                value={selectedDraftProduct.materialName}
                onChange={(event) => updateSelectedProductText('materialName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Material Category</span>
              <input
                value={selectedDraftProduct.materialCategory}
                onChange={(event) => updateSelectedProductText('materialCategory', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Classification Code</span>
              <input
                value={selectedDraftProduct.classificationCode}
                onChange={(event) => updateSelectedProductText('classificationCode', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Classification Name</span>
              <input
                value={selectedDraftProduct.classificationName}
                onChange={(event) => updateSelectedProductText('classificationName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Classification URI</span>
              <input
                value={selectedDraftProduct.classificationUri}
                onChange={(event) => updateSelectedProductText('classificationUri', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Document ID</span>
              <input
                value={selectedDraftProduct.documentIdentification}
                onChange={(event) => updateSelectedProductText('documentIdentification', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Document Name</span>
              <input
                value={selectedDraftProduct.documentName}
                onChange={(event) => updateSelectedProductText('documentName', event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Document URI</span>
              <input
                value={selectedDraftProduct.documentUri}
                onChange={(event) => updateSelectedProductText('documentUri', event.currentTarget.value)}
              />
            </label>
          </div>
          <div className="ifc-editor-actions">
            <button type="button" onClick={() => void applyBuilderDraft()} disabled={busy}>
              Apply Edits
            </button>
            <button type="button" onClick={addProduct} disabled={busy}>
              Add Block
            </button>
            <button type="button" onClick={duplicateSelectedProduct} disabled={busy}>
              Duplicate
            </button>
            <button type="button" onClick={deleteSelectedProduct} disabled={busy || builderDraft.products.length <= 1}>
              Delete
            </button>
          </div>
            </div>
          </Panel>
        </Group>
      </section>

      <section className="ifc-bottom-grid" aria-label="Model utility panels">
        <Group id="ifcnative-utilities" orientation="horizontal" {...utilityLayout}>
          <Panel className="ifc-panel-frame" defaultSize={32} id="visibility" minSize={20}>
            <div className="ifc-pane">
              <PaneTitle title="Visibility" subtitle="Toggle streamed IFC categories" />
              <div className="ifc-chip-list">
                {session?.geometry?.typeCounts.length ? (
                  session.geometry.typeCounts.map((entry) => (
                    <button
                      type="button"
                      key={entry.typeName}
                      className={hiddenTypes.has(entry.typeName) ? 'ifc-chip muted' : 'ifc-chip'}
                      onClick={() => toggleType(entry.typeName)}>
                      {entry.typeName} <span>{entry.count}</span>
                    </button>
                  ))
                ) : (
                  <EmptyState text="No geometry categories." />
                )}
              </div>
            </div>
          </Panel>
          <Separator className="ifc-resize-handle" aria-label="Resize visibility and coverage panels" />
          <Panel className="ifc-panel-frame" defaultSize={68} id="coverage" minSize={32}>
            <div className="ifc-pane">
              <PaneTitle title="Checklist Coverage" subtitle="Current implementation state" />
              <div className="ifc-capabilities">
                {IFC_CAPABILITY_MATRIX.map((item) => (
                  <div className="ifc-capability" key={item.title}>
                    <span className={`ifc-status ${item.status}`}>{item.status}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </Group>
      </section>

      <section className="ifc-pane ifc-diff-pane">
        <PaneTitle title="STEP Diff" subtitle="Source IFC compared with current SaveModel output" />
        <IfcStepDiffPanel
          filename={session?.filename}
          savedText={savedStepText}
          sourceText={sourceStepText}
        />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="ifc-metric">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function PaneTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="ifc-pane-title">
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

function EntityInspector({
  session,
  selectedExpressID,
  selectedName,
}: {
  session?: IfcModelSession;
  selectedExpressID?: number;
  selectedName?: string;
}) {
  const entity = selectedExpressID ? session?.graph.byExpressID.get(selectedExpressID) : undefined;
  const typeID = selectedExpressID ? session?.graph.typeByOccurrence.get(selectedExpressID) : undefined;
  return (
    <div className="ifc-inspector">
      {entity ? (
        <>
          <h2>{selectedName ?? `#${entity.expressID}`}</h2>
          <dl>
            <dt>Express ID</dt>
            <dd>#{entity.expressID}</dd>
            <dt>Type</dt>
            <dd>{entity.typeName}</dd>
            <dt>GlobalId</dt>
            <dd>{entity.globalId ?? '-'}</dd>
            <dt>Description</dt>
            <dd>{entity.description ?? '-'}</dd>
            <dt>Assigned type</dt>
            <dd>{typeID ? `#${typeID}` : '-'}</dd>
            <dt>Materials</dt>
            <dd>{selectedExpressID ? session?.properties.materials.get(selectedExpressID)?.join(', ') : '-'}</dd>
            <dt>Classifications</dt>
            <dd>
              {selectedExpressID
                ? session?.properties.classifications.get(selectedExpressID)?.join(', ')
                : '-'}
            </dd>
            <dt>Documents</dt>
            <dd>{selectedExpressID ? session?.properties.documents.get(selectedExpressID)?.join(', ') : '-'}</dd>
          </dl>
        </>
      ) : (
        <EmptyState text="Select a tree item or a mesh to inspect the IFC entity." />
      )}
    </div>
  );
}

function PropertyInspector({
  selectedProperties,
}: {
  selectedProperties: NonNullable<IfcModelSession['properties']>['byObject'] extends Map<
    number,
    infer Value
  >
    ? Value
    : never;
}) {
  return (
    <div className="ifc-inspector">
      {selectedProperties.length ? (
        selectedProperties.map((set) => (
          <section className="ifc-property-set" key={`${set.expressID}-${set.name}`}>
            <h2>{set.name}</h2>
            <span>{set.typeName}</span>
            {set.values.map((value) => (
              <div className="ifc-property-row" key={`${set.expressID}-${value.name}`}>
                <strong>{value.name}</strong>
                <span>{value.value || '-'}</span>
              </div>
            ))}
          </section>
        ))
      ) : (
        <EmptyState text="No property or quantity set is linked to the selected entity." />
      )}
    </div>
  );
}

function DiagnosticsPanel({ session }: { session?: IfcModelSession }) {
  return (
    <div className="ifc-inspector">
      {session?.diagnostics.length ? (
        session.diagnostics.map((diagnostic, index) => (
          <div className={`ifc-diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
            <strong>{diagnostic.code}</strong>
            <span>{diagnostic.message}</span>
          </div>
        ))
      ) : (
        <EmptyState text="No diagnostics reported." />
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="ifc-empty">{text}</p>;
}

function createDefaultBuilderDraft(): BuilderDraft {
  return {
    buildingName: 'Sample Building',
    products: [createBuilderProductDraft(0)],
    projectName: 'IFCnative Builder Sample',
    siteName: 'Sample Site',
    storeyName: 'Level 0',
  };
}

function createBuilderProductDraft(index: number): BuilderProductDraft {
  const displayIndex = index + 1;
  return {
    depth: 2,
    height: 1.5,
    id: index === 0 ? 'builder-product-1' : createProductID(),
    classificationCode: `IFCNATIVE-${String(displayIndex).padStart(3, '0')}`,
    classificationName: 'Inspection Target',
    classificationUri: 'https://ifcnative.local/classification/inspection-target',
    documentIdentification: `DOC-${String(displayIndex).padStart(3, '0')}`,
    documentName: 'Inspection Report Placeholder',
    documentUri: 'https://ifcnative.local/documents/inspection-report',
    materialCategory: 'Concrete',
    materialName: 'Inspection Concrete',
    monitoringRole: 'Inspection target',
    name: index === 0 ? 'Sample Inspection Block' : `Inspection Block ${displayIndex}`,
    reference: 'Generated IFCnative block',
    tag: `IFCNATIVE-BLOCK-${String(displayIndex).padStart(3, '0')}`,
    width: 4,
    x: index * 5,
    y: 0,
    z: 0,
  };
}

function draftToProjectOptions(draft: BuilderDraft) {
  const products: BuilderProductOptions[] = draft.products.map((product) => ({
    depth: product.depth,
    classificationCode: product.classificationCode,
    classificationName: product.classificationName,
    classificationUri: product.classificationUri,
    documentIdentification: product.documentIdentification,
    documentName: product.documentName,
    documentUri: product.documentUri,
    height: product.height,
    materialCategory: product.materialCategory,
    materialName: product.materialName,
    name: product.name,
    properties: {
      MonitoringRole: product.monitoringRole,
      Reference: product.reference,
    },
    tag: product.tag,
    width: product.width,
    x: product.x,
    y: product.y,
    z: product.z,
  }));

  return {
    buildingName: draft.buildingName,
    name: draft.projectName,
    products,
    siteName: draft.siteName,
    storeyName: draft.storeyName,
  };
}

function createProductID() {
  return `builder-product-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const blob = new Blob([data], { type: 'application/x-step' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
