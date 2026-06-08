using System.Collections.ObjectModel;
using System.Numerics;
using System.Runtime.CompilerServices;
using System.Reactive;
using System.Threading;
using Avalonia.Media;
using Dock.Model.Controls;
using Dock.Model.Core;
using IFCnative.NativeWindows.Docking;
using IFCnative.NativeWindows.Models;
using IFCnative.NativeWindows.Services;
using ReactiveUI;

namespace IFCnative.NativeWindows.ViewModels;

public abstract class ReactiveViewModel : ReactiveObject
{
    protected bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        this.RaiseAndSetIfChanged(ref field, value, propertyName);
        return true;
    }
}

public sealed record WorkspacePreset(string Id, string Name, string Description);

public sealed record TreeGuideSegment(bool Continues);

public sealed class IfcFileTreeRowViewModel : ReactiveViewModel
{
    private static readonly Geometry ChevronRight = Geometry.Parse("M 5 3 L 10 8 L 5 13");
    private static readonly Geometry ChevronDown = Geometry.Parse("M 3 5 L 8 10 L 13 5");

    public IfcFileTreeRowViewModel(
        StructurePanelViewModel owner,
        IfcTreeNode node,
        int depth,
        bool isLast,
        IReadOnlyList<TreeGuideSegment> guides,
        bool isExpanded)
    {
        Node = node;
        Depth = depth;
        IsLast = isLast;
        Guides = guides;
        IsExpanded = isExpanded;
        ToggleCommand = ReactiveCommand.Create(() => owner.ToggleRow(this));
    }

    public IfcTreeNode Node { get; }

    public int Depth { get; }

    public bool IsLast { get; }

    public IReadOnlyList<TreeGuideSegment> Guides { get; }

    public bool IsExpanded { get; }

    public bool HasChildren => Node.Children.Count > 0;

    public bool ShowConnector => Depth > 0;

    public bool ShowLowerConnector => !IsLast;

    public Geometry ChevronData => IsExpanded ? ChevronDown : ChevronRight;

    public ReactiveCommand<Unit, Unit> ToggleCommand { get; }

    public string DisplayName => Node.DisplayName;

    public string TypeLabel => Node.TypeLabel;

    public string EntityType => Node.Entity.Type;
}

public sealed class IfcDocumentSessionViewModel : ReactiveViewModel
{
    private IfcDocument document;
    private bool isDirty;

    public IfcDocumentSessionViewModel(IfcDocument document, string? sourcePath)
    {
        Id = $"{document.FileName}:{Guid.NewGuid():N}";
        this.document = document;
        SourcePath = sourcePath;
        DraftSession.Reset(document);
    }

    public string Id { get; }

    public string? SourcePath { get; }

    public IfcDraftSession DraftSession { get; } = new();

    public HashSet<int> Bookmarks { get; } = [];

    public int SelectedEntityId { get; set; }

    public IfcDocument Document
    {
        get => document;
        private set => this.RaiseAndSetIfChanged(ref document, value);
    }

    public bool IsDirty
    {
        get => isDirty;
        set
        {
            if (SetProperty(ref isDirty, value))
            {
                this.RaisePropertyChanged(nameof(Meta));
            }
        }
    }

    public string FileName => Document.FileName;

    public string Schema => Document.Schema;

    public string Meta => $"{Schema} / {Document.Entities.Count:N0} entities{(IsDirty ? " / modified" : string.Empty)}";

    public void SetDocument(IfcDocument nextDocument, bool resetDraft)
    {
        Document = nextDocument;
        if (resetDraft)
        {
            DraftSession.Reset(nextDocument);
        }

        IsDirty = DraftSession.HasDraft;
        this.RaisePropertyChanged(nameof(FileName));
        this.RaisePropertyChanged(nameof(Schema));
        this.RaisePropertyChanged(nameof(Meta));
    }
}

public sealed class MainWindowViewModel : ReactiveViewModel
{
    private readonly IFileDialogService fileDialogs;
    private readonly NativeUserPreferencesStore preferencesStore;
    private readonly RecentFileStore recentFileStore = new();
    private readonly IIfcGeometryBackend geometryBackend = new XbimGeometryBackend();
    private NativeDockFactory? dockFactory;
    private IRootDock? dockLayout;
    private IfcDocumentSessionViewModel? activeSession;
    private WorkspacePreset? selectedWorkspace;
    private string statusText = "Ready.";
    private string activeSchema = "No document";
    private string activeEntityCount = "0 entities";
    private string sessionSummary = "0 files";
    private bool isBusy;
    private NativeUserPreferences currentPreferences;
    private double textScale = 1.0;

    public MainWindowViewModel(IFileDialogService fileDialogs, NativeUserPreferencesStore? preferencesStore = null, bool loadSample = true)
    {
        this.fileDialogs = fileDialogs;
        this.preferencesStore = preferencesStore ?? new NativeUserPreferencesStore();
        currentPreferences = this.preferencesStore.Load();
        textScale = currentPreferences.TextScale;

        Workspaces.Add(new WorkspacePreset("edit", "IFC Editing", "Structure, viewport, inspector"));
        Workspaces.Add(new WorkspacePreset("review", "Review", "Diagnostics, drafts, object data"));
        Workspaces.Add(new WorkspacePreset("graph-builder", "Graph + Builder", "Relationship graph and body builder"));
        selectedWorkspace = Workspaces[0];

        Structure = new StructurePanelViewModel(this);
        Types = new TypesPanelViewModel(this);
        Viewport = new ViewportPanelViewModel(this, geometryBackend);
        Viewport.AntiAliasing = currentPreferences.AntiAliasing;
        Viewport.HideSpaces = currentPreferences.HideSpaces;
        Viewport.ShowFpsCounter = currentPreferences.ShowFpsCounter;
        Viewport.FieldOfView = currentPreferences.FieldOfView;
        Viewport.NearPlane = currentPreferences.NearPlane;
        Viewport.FarPlane = currentPreferences.FarPlane;
        Inspector = new InspectorPanelViewModel(this);
        Draft = new DraftPanelViewModel(this);
        Graph = new GraphPanelViewModel(this);
        Diagnostics = new DiagnosticsPanelViewModel(this);
        Builder = new BuilderPanelViewModel(this);
        Recent = new RecentFilesPanelViewModel(this);
        Notes = new NotesPanelViewModel();
        Console = new ConsolePanelViewModel();
        Settings = new SettingsPanelViewModel(this);

        OpenIfcCommand = ReactiveCommand.CreateFromTask(() => OpenIfcAsync(false));
        AddIfcCommand = ReactiveCommand.CreateFromTask(() => OpenIfcAsync(true));
        LoadSampleCommand = ReactiveCommand.Create(LoadSample);
        ExportIfcCommand = ReactiveCommand.CreateFromTask(ExportIfcAsync);
        ResetLayoutCommand = ReactiveCommand.Create(ResetDockLayout);
        SelectWorkspaceCommand = ReactiveCommand.Create<string>(SelectWorkspace);
        IncreaseTextScaleCommand = ReactiveCommand.Create(IncreaseTextScale);
        DecreaseTextScaleCommand = ReactiveCommand.Create(DecreaseTextScale);
        ResetTextScaleCommand = ReactiveCommand.Create(ResetTextScale);
        OpenLogCommand = ReactiveCommand.Create(OpenLog);

        ResetDockLayout();
        RefreshRecentFiles();
        if (loadSample)
        {
            LoadSample();
        }
    }

    public ObservableCollection<WorkspacePreset> Workspaces { get; } = [];

    public ObservableCollection<IfcDocumentSessionViewModel> Documents { get; } = [];

    public StructurePanelViewModel Structure { get; }

    public TypesPanelViewModel Types { get; }

    public ViewportPanelViewModel Viewport { get; }

    public InspectorPanelViewModel Inspector { get; }

    public DraftPanelViewModel Draft { get; }

    public GraphPanelViewModel Graph { get; }

    public DiagnosticsPanelViewModel Diagnostics { get; }

    public BuilderPanelViewModel Builder { get; }

    public RecentFilesPanelViewModel Recent { get; }

    public NotesPanelViewModel Notes { get; }

    public ConsolePanelViewModel Console { get; }

    public SettingsPanelViewModel Settings { get; }

    public ReactiveCommand<Unit, Unit> OpenIfcCommand { get; }

    public ReactiveCommand<Unit, Unit> AddIfcCommand { get; }

    public ReactiveCommand<Unit, Unit> LoadSampleCommand { get; }

    public ReactiveCommand<Unit, Unit> ExportIfcCommand { get; }

    public ReactiveCommand<Unit, Unit> ResetLayoutCommand { get; }

    public ReactiveCommand<string, Unit> SelectWorkspaceCommand { get; }

    public ReactiveCommand<Unit, Unit> IncreaseTextScaleCommand { get; }

    public ReactiveCommand<Unit, Unit> DecreaseTextScaleCommand { get; }

    public ReactiveCommand<Unit, Unit> ResetTextScaleCommand { get; }

    public ReactiveCommand<Unit, Unit> OpenLogCommand { get; }

    public string WindowTitle => ActiveSession is null ? "IFCnative" : $"IFCnative - {ActiveSession.FileName}";

    public double TextScale
    {
        get => textScale;
        set
        {
            var nextScale = NativeUserPreferencesStore.SanitizeTextScale(value);
            if (SetProperty(ref textScale, nextScale))
            {
                currentPreferences = currentPreferences with { TextScale = nextScale };
                preferencesStore.Save(currentPreferences);
                this.RaisePropertyChanged(nameof(TextScalePercent));
                StatusText = $"UI text zoom: {TextScalePercent}.";
                Log($"ui.zoom({TextScalePercent})");
            }
        }
    }

    public NativeUserPreferences CurrentPreferences => currentPreferences;

    public void UpdateAntiAliasing(AntiAliasingMode mode)
    {
        currentPreferences = currentPreferences with { AntiAliasing = mode };
        preferencesStore.Save(currentPreferences);
        Viewport.AntiAliasing = mode;
        StatusText = $"Anti-aliasing mode set to: {mode}.";
        Log($"ui.antialiasing({mode})");
    }

    public void UpdateHideSpaces(bool hide)
    {
        currentPreferences = currentPreferences with { HideSpaces = hide };
        preferencesStore.Save(currentPreferences);
        Viewport.HideSpaces = hide;
        StatusText = hide ? "IFC Spaces hidden." : "IFC Spaces visible.";
        Log($"ui.hidespaces({hide})");
    }

    public void UpdateShowFpsCounter(bool show)
    {
        currentPreferences = currentPreferences with { ShowFpsCounter = show };
        preferencesStore.Save(currentPreferences);
        Viewport.ShowFpsCounter = show;
        StatusText = show ? "Viewport stats visible." : "Viewport stats hidden.";
        Log($"ui.viewportstats({show})");
    }

    public void UpdateFieldOfView(double fov)
    {
        currentPreferences = currentPreferences with { FieldOfView = fov };
        preferencesStore.Save(currentPreferences);
        Viewport.FieldOfView = fov;
        StatusText = $"Field of View set to: {fov:0}°.";
        Log($"ui.fov({fov:F1})");
    }

    public void UpdateNearPlane(double near)
    {
        currentPreferences = currentPreferences with { NearPlane = near };
        preferencesStore.Save(currentPreferences);
        Viewport.NearPlane = near;
        StatusText = $"Near clipping plane set to: {near:F3}m.";
        Log($"ui.nearplane({near:F3})");
    }

    public void UpdateFarPlane(double far)
    {
        currentPreferences = currentPreferences with { FarPlane = far };
        preferencesStore.Save(currentPreferences);
        Viewport.FarPlane = far;
        StatusText = $"Far clipping plane set to: {far:0}m.";
        Log($"ui.farplane({far:F1})");
    }

    public string TextScalePercent => $"{TextScale * 100:0}%";

    public string StatusText
    {
        get => statusText;
        private set
        {
            if (SetProperty(ref statusText, value))
            {
                Console.SetCurrentStatus(value);
            }
        }
    }

    public string ActiveSchema
    {
        get => activeSchema;
        private set => this.RaiseAndSetIfChanged(ref activeSchema, value);
    }

    public string ActiveEntityCount
    {
        get => activeEntityCount;
        private set => this.RaiseAndSetIfChanged(ref activeEntityCount, value);
    }

    public string SessionSummary
    {
        get => sessionSummary;
        private set => this.RaiseAndSetIfChanged(ref sessionSummary, value);
    }

    public bool IsBusy
    {
        get => isBusy;
        private set => this.RaiseAndSetIfChanged(ref isBusy, value);
    }

    public WorkspacePreset? SelectedWorkspace
    {
        get => selectedWorkspace;
        set
        {
            if (SetProperty(ref selectedWorkspace, value))
            {
                ResetDockLayout();
            }
        }
    }

    public IfcDocumentSessionViewModel? ActiveSession
    {
        get => activeSession;
        set
        {
            if (SetProperty(ref activeSession, value))
            {
                RefreshForActiveDocument();
                this.RaisePropertyChanged(nameof(WindowTitle));
            }
        }
    }

    public NativeDockFactory? DockFactory
    {
        get => dockFactory;
        private set => this.RaiseAndSetIfChanged(ref dockFactory, value);
    }

    public IRootDock? DockLayout
    {
        get => dockLayout;
        private set => this.RaiseAndSetIfChanged(ref dockLayout, value);
    }

    public void ResetDockLayout()
    {
        var factory = new NativeDockFactory(this);
        var layout = factory.CreateLayout();
        factory.InitLayout(layout);
        DockFactory = factory;
        DockLayout = layout;
        StatusText = $"Workspace layout: {SelectedWorkspace?.Name ?? "IFC Editing"}.";
    }

    public void SelectWorkspace(string id)
    {
        var workspace = Workspaces.FirstOrDefault(value => value.Id == id);
        if (workspace is not null)
        {
            SelectedWorkspace = workspace;
        }
    }

    public void IncreaseTextScale()
    {
        TextScale = Math.Round((TextScale + 0.1) * 10, MidpointRounding.AwayFromZero) / 10;
    }

    public void DecreaseTextScale()
    {
        TextScale = Math.Round((TextScale - 0.1) * 10, MidpointRounding.AwayFromZero) / 10;
    }

    public void ResetTextScale()
    {
        TextScale = 1.0;
    }

    public void OpenLog()
    {
        Console.Add($"status: {StatusText}");
        ActivateDockable("console");
    }

    public async Task OpenPathAsync(string path)
    {
        await OpenPathAsync(path, setBusy: true);
    }

    public void SelectEntityById(int entityId, string source = "selection", bool updateViewport = true)
    {
        var session = ActiveSession;
        var document = session?.Document;
        if (session is null || document is null || !document.EntityById.TryGetValue(entityId, out var entity))
        {
            return;
        }

        session.SelectedEntityId = entity.Id;
        var details = IfcSelectionProjector.Project(document, entity);
        Inspector.SetSelection(document, details, session.Bookmarks.Contains(entity.Id));
        if (updateViewport)
        {
            Viewport.SetSelection(document, entity);
        }

        if (source != "tree")
        {
            Structure.SelectEntity(entityId);
        }

        Graph.SetSelection(document, entity);
        Builder.SetSelection(document, entity);
        StatusText = $"{source}: #{entity.Id} {entity.TypeName()} {entity.DisplayName}";
        this.RaisePropertyChanged(nameof(WindowTitle));
    }

    public void ShowType(IfcTypeCount? typeCount)
    {
        if (ActiveSession is null || typeCount is null)
        {
            return;
        }

        Viewport.SetType(ActiveSession.Document, typeCount);
        StatusText = $"{typeCount.Type}: {typeCount.Count:N0} entities.";
    }

    public void ToggleBookmark()
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        if (!session.Bookmarks.Add(selectedId))
        {
            session.Bookmarks.Remove(selectedId);
        }

        Structure.SetBookmarks(session.Document, session.Bookmarks);
        if (session.Document.EntityById.TryGetValue(selectedId, out var entity))
        {
            Inspector.IsBookmarked = session.Bookmarks.Contains(selectedId);
            StatusText = $"{(Inspector.IsBookmarked ? "Pinned" : "Unpinned")} #{selectedId} {entity.TypeName()}.";
        }
    }

    public void SaveEntityEdit(string name, string description, string rawArguments)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(
            XbimDocumentEditor.UpdateEntity(session.Document, selectedId, name, description),
            selectedId,
            $"Staged xBIM entity edit for #{selectedId}.");
    }

    public void SavePlacement(string x, string y, string z)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.UpdatePlacement(session.Document, selectedId, x, y, z), selectedId, $"Staged xBIM placement edit for #{selectedId}.");
    }

    public bool CommitProductTransform(int productId, Vector3 moveDeltaWorld, float rotateZRadians)
    {
        var session = ActiveSession;
        if (session is null || productId == 0)
        {
            return false;
        }

        return StageDraft(
            XbimDocumentEditor.UpdatePlacementTransform(
                session.Document,
                productId,
                moveDeltaWorld.X,
                moveDeltaWorld.Y,
                moveDeltaWorld.Z,
                rotateZRadians),
            productId,
            $"Staged xBIM transform edit for #{productId}.");
    }

    public void SaveSpatialParent(string parentId)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.UpdateSpatialParent(session.Document, selectedId, parentId), selectedId, $"Staged xBIM spatial parent edit for #{selectedId}.");
    }

    public void DetachSpatialParent()
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.RemoveFromSpatialParent(session.Document, selectedId), selectedId, $"Staged xBIM spatial detach for #{selectedId}.");
    }

    public void SaveProperty(IfcPropertyDetails property, string value)
    {
        var session = ActiveSession;
        if (session is null || property.EntityId is null || !property.CanEdit)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.UpdatePropertyValue(session.Document, property.EntityId.Value, value), session.SelectedEntityId, $"Staged xBIM property edit for #{property.EntityId.Value}.");
    }

    public void AddCommonPropertySet()
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0 || !session.Document.EntityById.TryGetValue(selectedId, out var entity))
        {
            return;
        }

        StageDraft(XbimDocumentEditor.AddCommonPropertySet(session.Document, selectedId, entity.DisplayName, "New"), selectedId, $"Staged xBIM common Pset for #{selectedId}.");
    }

    public void AddBaseQuantitySet(string width, string depth, string height)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.AddBaseQuantitySet(session.Document, selectedId, width, depth, height), selectedId, $"Staged xBIM base Qto for #{selectedId}.");
    }

    public void AddResource(string kind, string name, string identification)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.AddResource(session.Document, selectedId, kind, name, identification), selectedId, $"Staged xBIM {kind} assignment for #{selectedId}.");
    }

    public void AssignBody(string width, string depth, string height, string profile)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.AssignBodyRepresentation(session.Document, selectedId, width, depth, height, profile), selectedId, $"Staged xBIM body representation for #{selectedId}.");
    }

    public void CreateProduct(string type, string name, string width, string depth, string height, string profile)
    {
        var session = ActiveSession;
        var selectedId = session?.SelectedEntityId ?? 0;
        if (session is null || selectedId == 0)
        {
            return;
        }

        var before = session.Document.EntityById.Keys.ToHashSet();
        var draft = XbimDocumentEditor.AddProductWithBodyRepresentation(session.Document, selectedId, type, name, width, depth, height, profile);
        var newId = draft.EntityById.Keys.Except(before).OrderBy(id => id).FirstOrDefault();
        StageDraft(draft, newId == 0 ? selectedId : newId, $"Staged new xBIM product under #{selectedId}.");
    }

    public void AddRelationship(string relationshipType, string sourceIds, string targetIds, string name)
    {
        var session = ActiveSession;
        if (session is null)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.AddRelationship(session.Document, relationshipType, sourceIds, targetIds, name), session.SelectedEntityId, "Staged xBIM relationship create.");
    }

    public void SaveRelationship(IfcRelationshipDetails relationship, string sourceIds, string targetIds)
    {
        var session = ActiveSession;
        if (session is null || relationship.RelationshipId is null || !relationship.CanEdit)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.UpdateRelationshipEndpoints(session.Document, relationship.RelationshipId.Value, sourceIds, targetIds), session.SelectedEntityId, $"Staged xBIM relationship edit for #{relationship.RelationshipId.Value}.");
    }

    public void DeleteRelationship(IfcRelationshipDetails relationship)
    {
        var session = ActiveSession;
        if (session is null || relationship.RelationshipId is null)
        {
            return;
        }

        StageDraft(XbimDocumentEditor.DeleteRelationship(session.Document, relationship.RelationshipId.Value), session.SelectedEntityId, $"Staged xBIM relationship delete for #{relationship.RelationshipId.Value}.");
    }

    public async Task RunDiagnosticsAsync()
    {
        var session = ActiveSession;
        if (session is null)
        {
            StatusText = "Open an IFC document before running diagnostics.";
            return;
        }

        var document = session.Document;
        IsBusy = true;
        StatusText = $"Checking diagnostics for {document.FileName}...";
        try
        {
            var result = await Task.Run(() => IfcDocumentDiagnostics.Run(document));
            if (!ReferenceEquals(ActiveSession?.Document, document))
            {
                return;
            }

            Diagnostics.SetDocument(document);
            StatusText = result.Summary;
            Log($"diagnostics.check(errors:{result.Errors},warnings:{result.Warnings})");
        }
        catch (Exception exception)
        {
            StatusText = $"Diagnostics failed: {exception.Message}";
            Log($"diagnostics.error('{exception.Message.Replace("'", string.Empty, StringComparison.Ordinal)}')");
        }
        finally
        {
            IsBusy = false;
        }
    }

    public void RepairDiagnostic(IfcDiagnosticDetails diagnostic)
    {
        var session = ActiveSession;
        if (session is null || !diagnostic.CanRepair)
        {
            return;
        }

        var entityId = diagnostic.EntityId ?? session.SelectedEntityId;
        var draft = diagnostic switch
        {
            { CanRepairDuplicateGlobalId: true } => XbimDocumentEditor.RegenerateDuplicateGlobalIds(session.Document, diagnostic.Message),
            { CanRepairMissingGlobalId: true } when entityId != 0 => XbimDocumentEditor.GenerateMissingGlobalId(session.Document, entityId),
            { CanRepairSpatialContainment: true } when entityId != 0 => XbimDocumentEditor.KeepFirstPrimarySpatialContainment(session.Document, entityId),
            { CanRepairMissingReference: true } => XbimDocumentEditor.RemoveRelationshipFromMissingReferenceDiagnostic(session.Document, diagnostic.Message),
            { CanRepairPlacement: true } when entityId != 0 => XbimDocumentEditor.AssignDefaultPlacement(session.Document, entityId),
            { CanRepairRepresentation: true } when entityId != 0 => XbimDocumentEditor.AssignDefaultBodyRepresentation(session.Document, entityId),
            _ => session.Document,
        };

        StageDraft(draft, entityId, $"Staged xBIM diagnostic repair for #{entityId}.");
    }

    public void ApplyDraft()
    {
        var session = ActiveSession;
        if (session is null)
        {
            return;
        }

        var applied = session.DraftSession.Apply(Draft.ChangesetName);
        if (applied is null)
        {
            return;
        }

        session.SetDocument(applied, resetDraft: false);
        StatusText = "Draft applied.";
        RefreshForActiveDocument(session.SelectedEntityId);
    }

    public void DiscardDraft()
    {
        var session = ActiveSession;
        var discarded = session?.DraftSession.Discard();
        if (session is null || discarded is null)
        {
            return;
        }

        session.SetDocument(discarded, resetDraft: false);
        StatusText = "Draft discarded.";
        RefreshForActiveDocument(session.SelectedEntityId);
    }

    public void UndoDraft()
    {
        var session = ActiveSession;
        var document = session?.DraftSession.Undo();
        if (session is null || document is null)
        {
            return;
        }

        session.SetDocument(document, resetDraft: false);
        StatusText = "Undo applied.";
        RefreshForActiveDocument(session.SelectedEntityId);
    }

    public void RedoDraft()
    {
        var session = ActiveSession;
        var document = session?.DraftSession.Redo();
        if (session is null || document is null)
        {
            return;
        }

        session.SetDocument(document, resetDraft: false);
        StatusText = "Redo applied.";
        RefreshForActiveDocument(session.SelectedEntityId);
    }

    private async Task OpenIfcAsync(bool allowMultiple)
    {
        var paths = await fileDialogs.OpenIfcFilesAsync(allowMultiple);
        foreach (var path in paths)
        {
            await OpenPathAsync(path, setBusy: true);
        }
    }

    private async Task OpenPathAsync(string path, bool setBusy)
    {
        if (setBusy)
        {
            IsBusy = true;
        }

        try
        {
            Viewport.CancelRenderSceneLoad();
            var progress = new Progress<string>(message => StatusText = message);
            var parsed = await Task.Run(() => XbimIfcDocumentService.OpenPath(path, progress));
            AddSession(parsed, Path.GetFullPath(path));
            recentFileStore.Add(path);
            RefreshRecentFiles();
            Log($"xbim.open('{Path.GetFileName(path)}')");
        }
        catch (Exception exception)
        {
            StatusText = $"Open failed: {exception.Message}";
            Log($"file.open.error('{exception.Message.Replace("'", string.Empty, StringComparison.Ordinal)}')");
        }
        finally
        {
            if (setBusy)
            {
                IsBusy = false;
            }
        }
    }

    private async Task ExportIfcAsync()
    {
        var session = ActiveSession;
        if (session is null)
        {
            return;
        }

        if (!session.DraftSession.CanExport)
        {
            StatusText = "Apply or discard the pending draft before exporting.";
            return;
        }

        var validation = IfcExportValidator.Validate(session.Document, geometryBackend);
        if (!validation.CanExport)
        {
            StatusText = validation.Summary;
            return;
        }

        var path = await fileDialogs.SaveIfcFileAsync(session.Document.FileName);
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        var exportedStep = await Task.Run(() => XbimIfcDocumentService.NormalizeForExport(session.Document));
        IfcFileLoader.WriteText(path, exportedStep, session.Document.FileName);
        session.IsDirty = false;
        StatusText = $"Exported {Path.GetFileName(path)}. {validation.Summary}.";
        Log($"xbim.export('{Path.GetFileName(path)}')");
    }

    private void LoadSample()
    {
        var sample = XbimIfcDocumentService.CreateSample();
        AddSession(sample, sourcePath: null);
        StatusText = "Loaded xBIM sample IFC.";
        Log("xbim.sample()");
    }

    private void AddSession(IfcDocument document, string? sourcePath)
    {
        var session = new IfcDocumentSessionViewModel(document, sourcePath);
        Documents.Add(session);
        ActiveSession = session;
        SessionSummary = $"{Documents.Count:N0} {(Documents.Count == 1 ? "file" : "files")}";
    }

    private bool StageDraft(IfcDocument draftDocument, int selectedId, string message)
    {
        var session = ActiveSession;
        if (session is null || ReferenceEquals(session.Document, draftDocument))
        {
            StatusText = "No editable IFC change was produced for the current selection.";
            return false;
        }

        IfcDocument synchronizedDraft;
        try
        {
            synchronizedDraft = draftDocument.XbimStore is not null
                ? draftDocument
                : XbimIfcDocumentService.SynchronizeDocument(draftDocument);
        }
        catch (Exception exception)
        {
            StatusText = $"xBIM rejected the edit: {exception.Message}";
            Log($"xbim.transaction.reject({selectedId})");
            return false;
        }

        session.SetDocument(synchronizedDraft, resetDraft: true);
        session.IsDirty = true;
        StatusText = message.Replace("Staged", "Committed", StringComparison.OrdinalIgnoreCase);
        Log($"xbim.transaction.commit({selectedId})");
        RefreshForActiveDocument(selectedId);
        return true;
    }

    private void RefreshForActiveDocument(int? preferredSelection = null, bool refreshViewport = true)
    {
        var session = ActiveSession;
        if (session is null)
        {
            ActiveSchema = "No document";
            ActiveEntityCount = "0 entities";
            return;
        }

        var document = session.Document;
        ActiveSchema = document.Schema;
        ActiveEntityCount = $"{document.Entities.Count:N0} entities";
        SessionSummary = $"{Documents.Count:N0} {(Documents.Count == 1 ? "file" : "files")}";
        session.Bookmarks.RemoveWhere(id => !document.EntityById.ContainsKey(id));

        int? rememberedSelection = session.SelectedEntityId != 0 ? session.SelectedEntityId : null;
        var selectedId = preferredSelection
            ?? rememberedSelection
            ?? document.SpatialRoots.FirstOrDefault()?.Entity.Id
            ?? document.Entities.FirstOrDefault()?.Id;

        Structure.SetDocument(document, session.Bookmarks);
        Types.SetDocument(document);
        Diagnostics.SetDocument(document);
        Draft.SetSession(session);
        if (refreshViewport)
        {
            Viewport.SetDocument(document, selectedId);
        }

        Graph.SetDocument(document);
        Builder.SetDocument(document);
        if (selectedId is not null)
        {
            SelectEntityById(selectedId.Value, updateViewport: refreshViewport);
        }
        else
        {
            Inspector.Clear();
        }

        this.RaisePropertyChanged(nameof(WindowTitle));
    }

    private void RefreshRecentFiles()
    {
        Recent.SetEntries(recentFileStore.Load());
    }

    private void Log(string line)
    {
        Console.Add(line);
    }

    private void ActivateDockable(string id)
    {
        if (DockLayout is null)
        {
            return;
        }

        if (ActivateDockable(DockLayout, id))
        {
            this.RaisePropertyChanged(nameof(DockLayout));
        }
    }

    private static bool ActivateDockable(IDock dock, string id)
    {
        foreach (var dockable in dock.VisibleDockables ?? [])
        {
            if (string.Equals(dockable.Id, id, StringComparison.OrdinalIgnoreCase))
            {
                dock.ActiveDockable = dockable;
                dock.FocusedDockable = dockable;
                return true;
            }

            if (dockable is IDock childDock && ActivateDockable(childDock, id))
            {
                dock.ActiveDockable = dockable;
                dock.FocusedDockable = dockable;
                return true;
            }
        }

        return false;
    }

    private static void Replace<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        target.Clear();
        foreach (var value in values)
        {
            target.Add(value);
        }
    }

    public static void ReplaceItems<T>(ObservableCollection<T> target, IEnumerable<T> values)
    {
        Replace(target, values);
    }
}

public sealed class StructurePanelViewModel(MainWindowViewModel owner) : ReactiveViewModel
{
    private readonly Dictionary<int, bool> expansionByEntityId = [];
    private IfcDocument? document;
    private IReadOnlyList<IfcTreeNode> currentRoots = [];
    private string searchText = string.Empty;
    private IfcFileTreeRowViewModel? selectedRow;
    private IfcFileTreeRowViewModel? selectedBookmark;
    private bool isSelectingProgrammatically;

    public ObservableCollection<IfcFileTreeRowViewModel> Rows { get; } = [];

    public ObservableCollection<IfcFileTreeRowViewModel> Bookmarks { get; } = [];

    public string SearchText
    {
        get => searchText;
        set
        {
            if (SetProperty(ref searchText, value))
            {
                ApplySearch();
            }
        }
    }

    public IfcFileTreeRowViewModel? SelectedRow
    {
        get => selectedRow;
        set
        {
            if (SetProperty(ref selectedRow, value) && value is not null)
            {
                if (!isSelectingProgrammatically)
                {
                    owner.SelectEntityById(value.Node.Entity.Id, "tree");
                }
            }
        }
    }

    public IfcFileTreeRowViewModel? SelectedBookmark
    {
        get => selectedBookmark;
        set
        {
            if (SetProperty(ref selectedBookmark, value) && value is not null)
            {
                owner.SelectEntityById(value.Node.Entity.Id, "bookmark");
            }
        }
    }

    public void SelectEntity(int entityId)
    {
        if (document is null)
        {
            return;
        }

        var path = new List<int>();
        bool found = false;
        foreach (var root in document.SpatialRoots)
        {
            if (FindPath(root, entityId, path))
            {
                found = true;
                break;
            }
        }

        if (found)
        {
            if (!string.IsNullOrWhiteSpace(searchText))
            {
                searchText = string.Empty;
                this.RaisePropertyChanged(nameof(SearchText));
                currentRoots = document.SpatialRoots;
            }

            foreach (var ancestorId in path)
            {
                expansionByEntityId[ancestorId] = true;
            }

            RebuildRows();
            var rowToSelect = Rows.FirstOrDefault(row => row.Node.Entity.Id == entityId);
            if (rowToSelect is not null)
            {
                SelectRowProgrammatically(rowToSelect);
            }

            return;
        }

        if (document.EntityById.TryGetValue(entityId, out var entity))
        {
            searchText = entityId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            this.RaisePropertyChanged(nameof(SearchText));
            currentRoots = [new IfcTreeNode(entity, "match")];
            RebuildRows();
            var rowToSelect = Rows.FirstOrDefault(row => row.Node.Entity.Id == entityId);
            if (rowToSelect is not null)
            {
                SelectRowProgrammatically(rowToSelect);
            }
        }
    }

    private void SelectRowProgrammatically(IfcFileTreeRowViewModel row)
    {
        isSelectingProgrammatically = true;
        try
        {
            if (ReferenceEquals(selectedRow, row))
            {
                this.RaisePropertyChanged(nameof(SelectedRow));
            }
            else
            {
                SelectedRow = row;
            }
        }
        finally
        {
            isSelectingProgrammatically = false;
        }
    }

    private bool FindPath(IfcTreeNode current, int targetId, List<int> path)
    {
        if (current.Entity.Id == targetId)
        {
            return true;
        }

        foreach (var child in current.Children)
        {
            path.Add(current.Entity.Id);
            if (FindPath(child, targetId, path))
            {
                return true;
            }
            path.RemoveAt(path.Count - 1);
        }

        return false;
    }

    public void SetDocument(IfcDocument nextDocument, IEnumerable<int> bookmarkedEntityIds)
    {
        document = nextDocument;
        ApplySearch();
        SetBookmarks(nextDocument, bookmarkedEntityIds);
    }

    public void SetBookmarks(IfcDocument nextDocument, IEnumerable<int> bookmarkedEntityIds)
    {
        var rows = IfcNavigationProjector.GetBookmarks(nextDocument, bookmarkedEntityIds)
            .Select((node, index) => new IfcFileTreeRowViewModel(
                this,
                node,
                depth: 0,
                isLast: index == 0,
                guides: [],
                isExpanded: false));
        MainWindowViewModel.ReplaceItems(Bookmarks, rows);
    }

    public void ToggleRow(IfcFileTreeRowViewModel row)
    {
        if (!row.HasChildren)
        {
            return;
        }

        expansionByEntityId[row.Node.Entity.Id] = !row.IsExpanded;
        RebuildRows();
    }

    private void ApplySearch()
    {
        if (document is null)
        {
            Rows.Clear();
            currentRoots = [];
            return;
        }

        currentRoots = IfcNavigationProjector.Search(document, SearchText);
        RebuildRows();
    }

    private void RebuildRows()
    {
        var rows = new List<IfcFileTreeRowViewModel>();
        for (var index = 0; index < currentRoots.Count; index++)
        {
            AddRows(rows, currentRoots[index], depth: 0, isLast: index == currentRoots.Count - 1, ancestorContinues: []);
        }

        MainWindowViewModel.ReplaceItems(Rows, rows);
    }

    private void AddRows(
        List<IfcFileTreeRowViewModel> rows,
        IfcTreeNode node,
        int depth,
        bool isLast,
        IReadOnlyList<bool> ancestorContinues)
    {
        var isExpanded = IsExpanded(node, depth);
        rows.Add(new IfcFileTreeRowViewModel(
            this,
            node,
            depth,
            isLast,
            ancestorContinues.Select(continues => new TreeGuideSegment(continues)).ToList(),
            isExpanded));

        if (!isExpanded)
        {
            return;
        }

        var nextAncestorContinues = ancestorContinues.Concat([!isLast]).ToList();
        for (var index = 0; index < node.Children.Count; index++)
        {
            AddRows(rows, node.Children[index], depth + 1, index == node.Children.Count - 1, nextAncestorContinues);
        }
    }

    private bool IsExpanded(IfcTreeNode node, int depth)
    {
        if (node.Children.Count == 0)
        {
            return false;
        }

        if (expansionByEntityId.TryGetValue(node.Entity.Id, out var expanded))
        {
            return expanded;
        }

        return string.IsNullOrWhiteSpace(SearchText) && depth < 4;
    }
}

public sealed class TypesPanelViewModel(MainWindowViewModel owner) : ReactiveViewModel
{
    private IfcTypeCount? selectedType;

    public ObservableCollection<IfcTypeCount> TypeCounts { get; } = [];

    public IfcTypeCount? SelectedType
    {
        get => selectedType;
        set
        {
            if (SetProperty(ref selectedType, value))
            {
                owner.ShowType(value);
            }
        }
    }

    public void SetDocument(IfcDocument document)
    {
        MainWindowViewModel.ReplaceItems(TypeCounts, IfcNavigationProjector.GetTypeCounts(document));
    }
}

public sealed class ViewportPanelViewModel(MainWindowViewModel owner, IIfcGeometryBackend geometryBackend) : ReactiveViewModel
{
    private string title = "Viewport";
    private string summary = "No model.";
    private IfcViewportItem? selectedItem;
    private IfcRenderScene renderScene = IfcRenderScene.Empty();
    private int selectedProductId;
    private ViewportInteractionMode interactionMode = ViewportInteractionMode.Select;
    private bool canTransformSelection;
    private AntiAliasingMode antiAliasing;
    private bool hideSpaces;
    private bool showFpsCounter;
    private string fpsText = "0 FPS";
    private double fieldOfView;
    private double nearPlane;
    private double farPlane;
    private CancellationTokenSource? renderSceneCancellation;
    private long renderSceneLoadVersion;
    private object? lastRenderStore;
    private object? lastGeometryContext;

    public ObservableCollection<IfcViewportItem> Items { get; } = [];

    public ObservableCollection<IfcPreviewMesh> Meshes { get; } = [];

    public string BackendName => geometryBackend.Name;

    public string Title
    {
        get => title;
        private set => this.RaiseAndSetIfChanged(ref title, value);
    }

    public string Summary
    {
        get => summary;
        private set => this.RaiseAndSetIfChanged(ref summary, value);
    }

    public IfcRenderScene RenderScene
    {
        get => renderScene;
        private set => this.RaiseAndSetIfChanged(ref renderScene, value);
    }

    public int SelectedProductId
    {
        get => selectedProductId;
        private set => this.RaiseAndSetIfChanged(ref selectedProductId, value);
    }

    public ViewportInteractionMode InteractionMode
    {
        get => interactionMode;
        set => this.RaiseAndSetIfChanged(ref interactionMode, value);
    }

    public bool CanTransformSelection
    {
        get => canTransformSelection;
        private set => this.RaiseAndSetIfChanged(ref canTransformSelection, value);
    }

    public AntiAliasingMode AntiAliasing
    {
        get => antiAliasing;
        set => this.RaiseAndSetIfChanged(ref antiAliasing, value);
    }

    public bool HideSpaces
    {
        get => hideSpaces;
        set => this.RaiseAndSetIfChanged(ref hideSpaces, value);
    }

    public bool ShowFpsCounter
    {
        get => showFpsCounter;
        set => this.RaiseAndSetIfChanged(ref showFpsCounter, value);
    }

    public string FpsText
    {
        get => fpsText;
        set => this.RaiseAndSetIfChanged(ref fpsText, value);
    }

    public double FieldOfView
    {
        get => fieldOfView;
        set => this.RaiseAndSetIfChanged(ref fieldOfView, value);
    }

    public double NearPlane
    {
        get => nearPlane;
        set => this.RaiseAndSetIfChanged(ref nearPlane, value);
    }

    public double FarPlane
    {
        get => farPlane;
        set => this.RaiseAndSetIfChanged(ref farPlane, value);
    }

    public IfcViewportItem? SelectedItem
    {
        get => selectedItem;
        set
        {
            if (SetProperty(ref selectedItem, value) && value?.EntityId is int entityId)
            {
                owner.SelectEntityById(entityId, "viewport");
            }
        }
    }

    public void SetDocument(IfcDocument document, int? selectedProductId = null)
    {
        Title = "Viewport";
        Summary = IfcNavigationProjector.GetDocumentViewportSummary(document);
        var items = geometryBackend.ProjectDocument(document);
        MainWindowViewModel.ReplaceItems(Items, items);
        Meshes.Clear();
        var retainedSelection = selectedProductId is int id && document.EntityById.ContainsKey(id)
            ? id
            : 0;
        SelectedProductId = retainedSelection;
        CanTransformSelection = retainedSelection > 0 && document.PlacementsByEntity.ContainsKey(retainedSelection);
        var geometryContext = XbimIfcDocumentService.TryGetGeometryContext(document);
        if (!RenderScene.IsEmpty
            && document.XbimStore is not null
            && geometryContext is not null
            && ReferenceEquals(document.XbimStore, lastRenderStore)
            && ReferenceEquals(geometryContext, lastGeometryContext))
        {
            Summary = RenderScene.Status;
            return;
        }

        BeginLoadRenderScene(document, IfcRenderSceneRequest.FullModel);
    }

    public void SetSelection(IfcDocument document, IfcEntity entity)
    {
        Title = entity.DisplayName;
        Summary = RenderScene.IsEmpty
            ? $"Selected #{entity.Id}. {geometryBackend.Status}"
            : $"Selected #{entity.Id}. {RenderScene.Status}";
        SelectedProductId = entity.Id;
        CanTransformSelection = document.PlacementsByEntity.ContainsKey(entity.Id);
        var items = geometryBackend.ProjectSelection(document, entity.Id);
        MainWindowViewModel.ReplaceItems(Items, items);
        Meshes.Clear();
    }

    public void SetType(IfcDocument document, IfcTypeCount typeCount)
    {
        Title = typeCount.Type;
        Summary = IfcNavigationProjector.GetTypeViewportSummary(typeCount);
        SelectedProductId = 0;
        CanTransformSelection = false;
        var items = document.EntitiesByType.TryGetValue(typeCount.Type, out var entities)
            ? entities.Take(120).Select(entity => new IfcViewportItem(entity.Id, $"#{entity.Id} {entity.DisplayName}"))
            : [];
        MainWindowViewModel.ReplaceItems(Items, items);
        Meshes.Clear();
    }

    public void SelectProduct(int productId)
    {
        owner.SelectEntityById(productId, "viewport");
    }

    public void SetInteractionMode(ViewportInteractionMode mode)
    {
        InteractionMode = mode;
    }

    public bool CommitProductTransform(int productId, Vector3 moveDeltaWorld, float rotateZRadians)
    {
        CancelRenderSceneLoad();
        return owner.CommitProductTransform(productId, moveDeltaWorld, rotateZRadians);
    }

    public void CancelRenderSceneLoad()
    {
        renderSceneCancellation?.Cancel();
    }

    private void BeginLoadRenderScene(IfcDocument document, IfcRenderSceneRequest request)
    {
        CancelRenderSceneLoad();
        renderSceneCancellation?.Dispose();
        renderSceneCancellation = new CancellationTokenSource();
        var token = renderSceneCancellation.Token;
        var version = Interlocked.Increment(ref renderSceneLoadVersion);
        if (RenderScene.IsEmpty)
        {
            RenderScene = IfcRenderScene.Empty("Generating xBIM render scene...");
        }
        else
        {
            Summary = $"Generating xBIM render scene... keeping {RenderScene.Meshes.Count:N0} current mesh(es) visible.";
        }

        var progress = new Progress<string>(message => Summary = message);
        _ = LoadRenderSceneAsync(document, request, token, version, progress);
    }

    private async Task LoadRenderSceneAsync(
        IfcDocument document,
        IfcRenderSceneRequest request,
        CancellationToken cancellationToken,
        long version,
        IProgress<string> progress)
    {
        try
        {
            var scene = await geometryBackend.BuildRenderSceneAsync(document, request, cancellationToken, progress);
            if (cancellationToken.IsCancellationRequested || version != renderSceneLoadVersion)
            {
                return;
            }

            RenderScene = scene;
            lastRenderStore = document.XbimStore;
            lastGeometryContext = XbimIfcDocumentService.TryGetGeometryContext(document);
            Summary = scene.Status;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            if (!cancellationToken.IsCancellationRequested && version == renderSceneLoadVersion)
            {
                RenderScene = IfcRenderScene.Empty($"xBIM render scene failed: {exception.Message}");
                Summary = $"xBIM render scene failed: {exception.Message}";
            }
        }
    }
}

public sealed class InspectorPanelViewModel : ReactiveViewModel
{
    private readonly MainWindowViewModel owner;
    private string title = "Inspector";
    private string entityId = "-";
    private string entityType = "-";
    private string globalId = "-";
    private string spatialPath = "-";
    private string nameDraft = string.Empty;
    private string descriptionDraft = string.Empty;
    private string rawArguments = string.Empty;
    private string placementX = string.Empty;
    private string placementY = string.Empty;
    private string placementZ = string.Empty;
    private string spatialParentId = string.Empty;
    private bool canEditPlacement;
    private bool canEditSpatialParent;
    private bool isBookmarked;
    private IfcPropertyDetails selectedProperty = IfcPropertyDetails.Empty;
    private IfcRelationshipDetails selectedRelationship = IfcRelationshipDetails.Empty;
    private string propertyValue = string.Empty;
    private string relationshipType = "IFCRELDEFINESBYPROPERTIES";
    private string relationshipName = "Native relationship";
    private string relationshipSourceIds = string.Empty;
    private string relationshipTargetIds = string.Empty;
    private string resourceName = "Native material";
    private string resourceIdentification = "NATIVE-REF";
    private string psetSummary = "Keine Psets.";

    public InspectorPanelViewModel(MainWindowViewModel owner)
    {
        this.owner = owner;
        SaveEntityCommand = ReactiveCommand.Create(() => owner.SaveEntityEdit(NameDraft, DescriptionDraft, RawArguments));
        ToggleBookmarkCommand = ReactiveCommand.Create(owner.ToggleBookmark);
        SavePlacementCommand = ReactiveCommand.Create(() => owner.SavePlacement(PlacementX, PlacementY, PlacementZ));
        SaveSpatialParentCommand = ReactiveCommand.Create(() => owner.SaveSpatialParent(SpatialParentId));
        DetachSpatialParentCommand = ReactiveCommand.Create(owner.DetachSpatialParent);
        AddCommonPsetCommand = ReactiveCommand.Create(owner.AddCommonPropertySet);
        AddBaseQtoCommand = ReactiveCommand.Create(() => owner.AddBaseQuantitySet("1", "1", "1"));
        SavePropertyCommand = ReactiveCommand.Create(() => owner.SaveProperty(SelectedProperty, PropertyValue));
        AddMaterialCommand = ReactiveCommand.Create(() => owner.AddResource("material", ResourceName, ResourceIdentification));
        AddClassificationCommand = ReactiveCommand.Create(() => owner.AddResource("classification", ResourceName, ResourceIdentification));
        AddDocumentCommand = ReactiveCommand.Create(() => owner.AddResource("document", ResourceName, ResourceIdentification));
        AddLibraryCommand = ReactiveCommand.Create(() => owner.AddResource("library", ResourceName, ResourceIdentification));
        AddRelationshipCommand = ReactiveCommand.Create(() => owner.AddRelationship(RelationshipType, RelationshipSourceIds, RelationshipTargetIds, RelationshipName));
        SaveRelationshipCommand = ReactiveCommand.Create(() => owner.SaveRelationship(SelectedRelationship, RelationshipSourceIds, RelationshipTargetIds));
        DeleteRelationshipCommand = ReactiveCommand.Create(() => owner.DeleteRelationship(SelectedRelationship));
    }

    public ObservableCollection<string> IncomingReferences { get; } = [];

    public ObservableCollection<IfcRelationshipDetails> Relationships { get; } = [];

    public ObservableCollection<string> Representations { get; } = [];

    public ObservableCollection<IfcPropertyDetails> PropertySets { get; } = [];

    public ObservableCollection<IfcPropertySetTableViewModel> PropertySetTables { get; } = [];

    public ObservableCollection<string> TypeAssignments { get; } = [];

    public ObservableCollection<string> Resources { get; } = [];

    public ObservableCollection<string> Units { get; } = [];

    public ReactiveCommand<Unit, Unit> SaveEntityCommand { get; }

    public ReactiveCommand<Unit, Unit> ToggleBookmarkCommand { get; }

    public ReactiveCommand<Unit, Unit> SavePlacementCommand { get; }

    public ReactiveCommand<Unit, Unit> SaveSpatialParentCommand { get; }

    public ReactiveCommand<Unit, Unit> DetachSpatialParentCommand { get; }

    public ReactiveCommand<Unit, Unit> AddCommonPsetCommand { get; }

    public ReactiveCommand<Unit, Unit> AddBaseQtoCommand { get; }

    public ReactiveCommand<Unit, Unit> SavePropertyCommand { get; }

    public ReactiveCommand<Unit, Unit> AddMaterialCommand { get; }

    public ReactiveCommand<Unit, Unit> AddClassificationCommand { get; }

    public ReactiveCommand<Unit, Unit> AddDocumentCommand { get; }

    public ReactiveCommand<Unit, Unit> AddLibraryCommand { get; }

    public ReactiveCommand<Unit, Unit> AddRelationshipCommand { get; }

    public ReactiveCommand<Unit, Unit> SaveRelationshipCommand { get; }

    public ReactiveCommand<Unit, Unit> DeleteRelationshipCommand { get; }

    public string Title { get => title; private set => this.RaiseAndSetIfChanged(ref title, value); }

    public string EntityId { get => entityId; private set => this.RaiseAndSetIfChanged(ref entityId, value); }

    public string EntityType { get => entityType; private set => this.RaiseAndSetIfChanged(ref entityType, value); }

    public string GlobalId { get => globalId; private set => this.RaiseAndSetIfChanged(ref globalId, value); }

    public string SpatialPath { get => spatialPath; private set => this.RaiseAndSetIfChanged(ref spatialPath, value); }

    public string NameDraft { get => nameDraft; set => this.RaiseAndSetIfChanged(ref nameDraft, value); }

    public string DescriptionDraft { get => descriptionDraft; set => this.RaiseAndSetIfChanged(ref descriptionDraft, value); }

    public string RawArguments { get => rawArguments; set => this.RaiseAndSetIfChanged(ref rawArguments, value); }

    public string PlacementX { get => placementX; set => this.RaiseAndSetIfChanged(ref placementX, value); }

    public string PlacementY { get => placementY; set => this.RaiseAndSetIfChanged(ref placementY, value); }

    public string PlacementZ { get => placementZ; set => this.RaiseAndSetIfChanged(ref placementZ, value); }

    public string SpatialParentId { get => spatialParentId; set => this.RaiseAndSetIfChanged(ref spatialParentId, value); }

    public bool CanEditPlacement { get => canEditPlacement; private set => this.RaiseAndSetIfChanged(ref canEditPlacement, value); }

    public bool CanEditSpatialParent { get => canEditSpatialParent; private set => this.RaiseAndSetIfChanged(ref canEditSpatialParent, value); }

    public bool IsBookmarked { get => isBookmarked; set => this.RaiseAndSetIfChanged(ref isBookmarked, value); }

    public string BookmarkLabel => IsBookmarked ? "Unpin" : "Pin";

    public IfcPropertyDetails SelectedProperty
    {
        get => selectedProperty;
        set
        {
            if (SetProperty(ref selectedProperty, value ?? IfcPropertyDetails.Empty))
            {
                PropertyValue = SelectedProperty.Value;
            }
        }
    }

    public string PropertyValue { get => propertyValue; set => this.RaiseAndSetIfChanged(ref propertyValue, value); }

    public IfcRelationshipDetails SelectedRelationship
    {
        get => selectedRelationship;
        set
        {
            if (SetProperty(ref selectedRelationship, value ?? IfcRelationshipDetails.Empty))
            {
                RelationshipSourceIds = SelectedRelationship.SourceIds;
                RelationshipTargetIds = SelectedRelationship.TargetIds;
            }
        }
    }

    public string RelationshipType { get => relationshipType; set => this.RaiseAndSetIfChanged(ref relationshipType, value); }

    public string RelationshipName { get => relationshipName; set => this.RaiseAndSetIfChanged(ref relationshipName, value); }

    public string RelationshipSourceIds { get => relationshipSourceIds; set => this.RaiseAndSetIfChanged(ref relationshipSourceIds, value); }

    public string RelationshipTargetIds { get => relationshipTargetIds; set => this.RaiseAndSetIfChanged(ref relationshipTargetIds, value); }

    public string ResourceName { get => resourceName; set => this.RaiseAndSetIfChanged(ref resourceName, value); }

    public string ResourceIdentification { get => resourceIdentification; set => this.RaiseAndSetIfChanged(ref resourceIdentification, value); }

    public string PsetSummary { get => psetSummary; private set => this.RaiseAndSetIfChanged(ref psetSummary, value); }

    public void SavePropertyRow(IfcPropertyTableRowViewModel row)
    {
        owner.SaveProperty(row.ToPropertyDetails(), row.ValueDraft);
    }

    public void SetSelection(IfcDocument document, IfcSelectionDetails details, bool bookmarked)
    {
        var entity = details.Entity;
        Title = entity.DisplayName;
        EntityId = $"#{entity.Id}";
        EntityType = entity.Type;
        GlobalId = string.IsNullOrWhiteSpace(entity.GlobalId) ? "-" : entity.GlobalId;
        SpatialPath = details.SpatialPath;
        NameDraft = entity.Name;
        DescriptionDraft = entity.Description;
        RawArguments = string.Join(",", entity.Arguments);
        IsBookmarked = bookmarked;
        this.RaisePropertyChanged(nameof(BookmarkLabel));

        SpatialParentId = details.Spatial.ParentId;
        CanEditSpatialParent = details.Spatial.CanEdit;
        PlacementX = details.Placement.X;
        PlacementY = details.Placement.Y;
        PlacementZ = details.Placement.Z;
        CanEditPlacement = details.Placement.CanEdit;

        MainWindowViewModel.ReplaceItems(IncomingReferences, details.IncomingReferences);
        MainWindowViewModel.ReplaceItems(Relationships, details.Relationships);
        MainWindowViewModel.ReplaceItems(Representations, details.Representations);
        MainWindowViewModel.ReplaceItems(PropertySets, details.PropertySets);
        MainWindowViewModel.ReplaceItems(PropertySetTables, details.PropertySetTables.Select(table => new IfcPropertySetTableViewModel(this, table)));
        MainWindowViewModel.ReplaceItems(TypeAssignments, details.TypeAssignments);
        MainWindowViewModel.ReplaceItems(Resources, details.Resources);
        MainWindowViewModel.ReplaceItems(Units, details.Units);
        PsetSummary = details.PropertySetTables.Count == 0
            ? "Keine Psets."
            : $"{details.PropertySetTables.Count:N0} Pset/Qto, {details.PropertySetTables.Sum(table => table.Rows.Count):N0} Werte.";

        SelectedProperty = IfcPropertyDetails.Empty;
        SelectedRelationship = IfcRelationshipDetails.Empty;
        RelationshipSourceIds = $"#{entity.Id}";
        RelationshipTargetIds = string.Empty;
        RelationshipType = "IFCRELDEFINESBYPROPERTIES";
        RelationshipName = "Native relationship";
    }

    public void Clear()
    {
        Title = "Inspector";
        EntityId = "-";
        EntityType = "-";
        GlobalId = "-";
        SpatialPath = "-";
        NameDraft = string.Empty;
        DescriptionDraft = string.Empty;
        RawArguments = string.Empty;
        MainWindowViewModel.ReplaceItems(IncomingReferences, []);
        MainWindowViewModel.ReplaceItems(Relationships, []);
        MainWindowViewModel.ReplaceItems(Representations, []);
        MainWindowViewModel.ReplaceItems(PropertySets, []);
        MainWindowViewModel.ReplaceItems(PropertySetTables, []);
        MainWindowViewModel.ReplaceItems(TypeAssignments, []);
        MainWindowViewModel.ReplaceItems(Resources, []);
        MainWindowViewModel.ReplaceItems(Units, []);
        PsetSummary = "Keine Psets.";
    }
}

public sealed class IfcPropertySetTableViewModel
{
    public IfcPropertySetTableViewModel(InspectorPanelViewModel owner, IfcPropertySetTableDetails details)
    {
        Id = details.Id;
        Kind = details.Kind;
        Name = details.Name;
        Meta = details.Meta;
        Rows = new ObservableCollection<IfcPropertyTableRowViewModel>(
            details.Rows.Select(row => new IfcPropertyTableRowViewModel(owner, row)));
    }

    public int Id { get; }

    public string Kind { get; }

    public string Name { get; }

    public string Meta { get; }

    public ObservableCollection<IfcPropertyTableRowViewModel> Rows { get; }
}

public sealed class IfcPropertyTableRowViewModel : ReactiveViewModel
{
    private readonly IfcPropertyTableRowDetails details;
    private string valueDraft;

    public IfcPropertyTableRowViewModel(InspectorPanelViewModel owner, IfcPropertyTableRowDetails details)
    {
        this.details = details;
        valueDraft = details.Value;
        SaveCommand = ReactiveCommand.Create(() => owner.SavePropertyRow(this));
    }

    public string StepId => details.StepId;

    public string Name => details.Name;

    public string Type => details.Type;

    public bool CanEdit => details.CanEdit;

    public string ValueDraft
    {
        get => valueDraft;
        set => this.RaiseAndSetIfChanged(ref valueDraft, value);
    }

    public ReactiveCommand<Unit, Unit> SaveCommand { get; }

    public IfcPropertyDetails ToPropertyDetails()
    {
        return details.ToPropertyDetails();
    }
}

public sealed class DraftPanelViewModel(MainWindowViewModel owner) : ReactiveViewModel
{
    private string changesetName = string.Empty;
    private bool canApply;
    private bool canUndo;
    private bool canRedo;

    public ObservableCollection<string> Lines { get; } = [];

    public ReactiveCommand<Unit, Unit> ApplyCommand { get; } = ReactiveCommand.Create(owner.ApplyDraft);

    public ReactiveCommand<Unit, Unit> DiscardCommand { get; } = ReactiveCommand.Create(owner.DiscardDraft);

    public ReactiveCommand<Unit, Unit> UndoCommand { get; } = ReactiveCommand.Create(owner.UndoDraft);

    public ReactiveCommand<Unit, Unit> RedoCommand { get; } = ReactiveCommand.Create(owner.RedoDraft);

    public string ChangesetName { get => changesetName; set => this.RaiseAndSetIfChanged(ref changesetName, value); }

    public bool CanApply { get => canApply; private set => this.RaiseAndSetIfChanged(ref canApply, value); }

    public bool CanUndo { get => canUndo; private set => this.RaiseAndSetIfChanged(ref canUndo, value); }

    public bool CanRedo { get => canRedo; private set => this.RaiseAndSetIfChanged(ref canRedo, value); }

    public void SetSession(IfcDocumentSessionViewModel session)
    {
        CanApply = session.DraftSession.HasDraft;
        CanUndo = session.DraftSession.CanUndo;
        CanRedo = session.DraftSession.CanRedo;
        var lines = session.DraftSession.Summarize().Concat(session.DraftSession.GetHistoryLines());
        MainWindowViewModel.ReplaceItems(Lines, lines);
    }
}

public sealed class GraphPanelViewModel(MainWindowViewModel owner) : ReactiveViewModel
{
    private IfcDocument? document;
    private IfcEntity? entity;
    private string filterText = string.Empty;
    private int depth = 3;
    private string centerTitle = "No selection";
    private string centerSubtitle = "Select an IFC entity to inspect local relationships.";
    private string centerMeta = string.Empty;
    private string graphSummary = "0 Nachbarn";
    private IfcRelationshipGraphItem? selectedItem;

    public ObservableCollection<IfcRelationshipGraphItem> Items { get; } = [];

    public ObservableCollection<IfcRelationshipGraphVisualNode> VisualNodes { get; } = [];

    public ObservableCollection<IfcRelationshipGraphVisualEdge> VisualEdges { get; } = [];

    public ReactiveCommand<IfcRelationshipGraphVisualNode, Unit> SelectVisualNodeCommand { get; } = ReactiveCommand.Create<IfcRelationshipGraphVisualNode>(node =>
    {
        if (node.EntityId > 0)
        {
            owner.SelectEntityById(node.EntityId, "graph");
        }
    });

    public string CenterTitle
    {
        get => centerTitle;
        private set => this.RaiseAndSetIfChanged(ref centerTitle, value);
    }

    public string CenterSubtitle
    {
        get => centerSubtitle;
        private set => this.RaiseAndSetIfChanged(ref centerSubtitle, value);
    }

    public string CenterMeta
    {
        get => centerMeta;
        private set => this.RaiseAndSetIfChanged(ref centerMeta, value);
    }

    public string GraphSummary
    {
        get => graphSummary;
        private set => this.RaiseAndSetIfChanged(ref graphSummary, value);
    }

    public string FilterText
    {
        get => filterText;
        set
        {
            if (SetProperty(ref filterText, value))
            {
                Refresh();
            }
        }
    }

    public int Depth
    {
        get => depth;
        set
        {
            if (SetProperty(ref depth, Math.Clamp(value, 1, 3)))
            {
                Refresh();
            }
        }
    }

    public IfcRelationshipGraphItem? SelectedItem
    {
        get => selectedItem;
        set
        {
            if (SetProperty(ref selectedItem, value) && value?.EntityId is int entityId)
            {
                owner.SelectEntityById(entityId, "graph");
            }
        }
    }

    public void SetDocument(IfcDocument nextDocument)
    {
        document = nextDocument;
        Refresh();
    }

    public void SetSelection(IfcDocument nextDocument, IfcEntity selectedEntity)
    {
        document = nextDocument;
        entity = selectedEntity;
        CenterTitle = selectedEntity.TypeName();
        CenterSubtitle = $"#{selectedEntity.Id} {selectedEntity.DisplayName}";
        CenterMeta = string.IsNullOrWhiteSpace(selectedEntity.GlobalId)
            ? "No GlobalId"
            : $"GUID: {selectedEntity.GlobalId}";
        Refresh();
    }

    private void Refresh()
    {
        if (document is null || entity is null)
        {
            Items.Clear();
            VisualNodes.Clear();
            VisualEdges.Clear();
            CenterTitle = "No selection";
            CenterSubtitle = "Select an IFC entity to inspect local relationships.";
            CenterMeta = string.Empty;
            GraphSummary = "0 Nachbarn";
            return;
        }

        MainWindowViewModel.ReplaceItems(Items, IfcSelectionProjector.ProjectRelationshipGraph(document, entity, FilterText, Depth));
        BuildVisualGraph(document, entity);
    }

    private void BuildVisualGraph(IfcDocument currentDocument, IfcEntity selectedEntity)
    {
        var filter = FilterText.Trim();
        var relationships = currentDocument.RelationshipsByEntity.TryGetValue(selectedEntity.Id, out var indexedRelationships)
            ? indexedRelationships
                .Where(relationship => MatchesVisualFilter(currentDocument, selectedEntity.Id, relationship, filter))
                .OrderBy(relationship => relationship.Type)
                .ThenBy(relationship => relationship.Id)
                .ToList()
            : [];

        const double centerX = 660;
        const double centerY = 620;
        var nodes = new List<IfcRelationshipGraphVisualNode>
        {
            CreateVisualNode(selectedEntity, centerX, centerY, true),
        };

        var upstreamCandidates = CollectUpstreamCandidates(currentDocument, selectedEntity.Id, filter);
        var upstreamNodeIds = upstreamCandidates.Select(candidate => candidate.NodeId).ToHashSet();
        var upstreamGroupsByLevel = upstreamCandidates
            .GroupBy(candidate => candidate.Level)
            .ToDictionary(
                group => group.Key,
                group => group
                    .GroupBy(candidate => candidate.NodeId)
                    .Select(nodeGroup => nodeGroup
                        .OrderBy(candidate => candidate.Relationship.Type)
                        .ThenBy(candidate => candidate.Relationship.Id)
                        .First())
                    .OrderBy(candidate => currentDocument.EntityById[candidate.NodeId].Type)
                    .ThenBy(candidate => currentDocument.EntityById[candidate.NodeId].DisplayName)
                    .ThenBy(candidate => candidate.NodeId)
                    .ToList());
        var upstreamNodeByLevel = new Dictionary<int, IfcRelationshipGraphVisualNode>();

        for (var level = Depth; level >= 1; level--)
        {
            if (!upstreamGroupsByLevel.TryGetValue(level, out var levelCandidates) || levelCandidates.Count == 0)
            {
                continue;
            }

            var y = UpstreamY(level);
            var node = levelCandidates.Count == 1
                ? CreateVisualNode(currentDocument.EntityById[levelCandidates[0].NodeId], centerX, y, false)
                : CreateSummaryNode(
                    -1000 - level,
                    UpstreamSummaryTitle(currentDocument, levelCandidates, level),
                    $"{levelCandidates.Count:N0} Knoten",
                    TypeSummaryMeta(currentDocument, levelCandidates),
                    SummaryTone(currentDocument, levelCandidates),
                    SummaryGlyph(currentDocument, levelCandidates),
                    centerX,
                    y);

            nodes.Add(node);
            upstreamNodeByLevel[level] = node;
        }

        var psetSummary = GetPsetSummary(currentDocument, selectedEntity.Id);
        IfcRelationshipGraphVisualNode? psetNode = null;
        if (psetSummary.SetCount > 0)
        {
            psetNode = new IfcRelationshipGraphVisualNode(
                -1,
                "Psets",
                $"{psetSummary.SetCount:N0} Pset/Qto",
                $"{psetSummary.ValueCount:N0} Werte",
                "#2F9E44",
                "P",
                170,
                centerY,
                false);
            nodes.Add(psetNode);
        }

        var directCandidates = relationships
            .Where(relationship => !IsPropertySetRelationship(relationship))
            .Where(relationship => !relationship.TargetIds.Contains(selectedEntity.Id))
            .SelectMany(relationship => DirectCandidatesFor(currentDocument, selectedEntity.Id, relationship))
            .Where(candidate => !upstreamNodeIds.Contains(candidate.NodeId))
            .GroupBy(candidate => candidate.NodeId)
            .Select(group => group.OrderBy(candidate => candidate.Relationship.Type).ThenBy(candidate => candidate.Relationship.Id).First())
            .ToList();

        var directGroups = directCandidates
            .GroupBy(candidate => currentDocument.EntityById[candidate.NodeId].Type)
            .OrderBy(group => group.Key)
            .Select(group => group
                .OrderBy(candidate => currentDocument.EntityById[candidate.NodeId].DisplayName)
                .ThenBy(candidate => candidate.NodeId)
                .ToList())
            .ToList();
        var directPositions = LayoutDirectNodes(directGroups.Count, psetNode is not null);
        var directVisualGroups = new List<(IfcRelationshipGraphVisualNode Node, IReadOnlyList<VisualRelationshipCandidate> Candidates)>();
        var nextSummaryId = -10;

        for (var index = 0; index < directGroups.Count; index++)
        {
            var group = directGroups[index];
            var position = directPositions[index];
            var node = group.Count == 1
                ? CreateVisualNode(currentDocument.EntityById[group[0].NodeId], position.X, position.Y, false)
                : CreateSummaryNode(
                    nextSummaryId--,
                    ShortType(currentDocument.EntityById[group[0].NodeId].Type),
                    $"{group.Count:N0} zusammengefasst",
                    RelationshipSummaryMeta(group),
                    EntityTone(currentDocument.EntityById[group[0].NodeId].Type),
                    SummaryGlyph(currentDocument, group),
                    position.X,
                    position.Y);

            nodes.Add(node);
            directVisualGroups.Add((node, group));
        }

        var nodeById = nodes.ToDictionary(node => node.EntityId);
        var edges = new List<IfcRelationshipGraphVisualEdge>();
        var emittedEdges = new HashSet<(int SourceId, int TargetId, string Label)>();

        for (var level = Depth; level >= 1; level--)
        {
            if (!upstreamNodeByLevel.TryGetValue(level, out var sourceNode) ||
                !upstreamGroupsByLevel.TryGetValue(level, out var levelCandidates))
            {
                continue;
            }

            var targetNode = level == 1
                ? nodeById[selectedEntity.Id]
                : upstreamNodeByLevel.GetValueOrDefault(level - 1);
            if (targetNode is null)
            {
                continue;
            }

            var edgeRelationship = levelCandidates[0].Relationship;
            var label = RelationshipSummaryLabel(levelCandidates);
            if (emittedEdges.Add((sourceNode.EntityId, targetNode.EntityId, label)))
            {
                edges.Add(CreateVisualEdge(edgeRelationship, sourceNode, targetNode, label));
            }
        }

        if (psetNode is not null)
        {
            var psetRelationship = relationships.FirstOrDefault(IsPropertySetRelationship);
            edges.Add(CreateVisualEdge(
                psetRelationship ?? new IfcRelationship { Id = -1, Type = "IFCRELDEFINESBYPROPERTIES" },
                psetNode,
                nodeById[selectedEntity.Id],
                "Psets"));
        }

        foreach (var visualGroup in directVisualGroups)
        {
            var candidates = visualGroup.Candidates;
            if (candidates.Count == 1)
            {
                var candidate = candidates[0];
                if (!nodeById.TryGetValue(candidate.SourceId, out var sourceNode) ||
                    !nodeById.TryGetValue(candidate.TargetId, out var targetNode))
                {
                    continue;
                }

                var label = ShortRelationship(candidate.Relationship.Type);
                if (emittedEdges.Add((candidate.SourceId, candidate.TargetId, label)))
                {
                    edges.Add(CreateVisualEdge(candidate.Relationship, sourceNode, targetNode, label));
                }
            }
            else
            {
                var first = candidates[0];
                var label = RelationshipSummaryLabel(candidates);
                if (emittedEdges.Add((selectedEntity.Id, visualGroup.Node.EntityId, label)))
                {
                    edges.Add(CreateVisualEdge(first.Relationship, nodeById[selectedEntity.Id], visualGroup.Node, label));
                }
            }
        }

        MainWindowViewModel.ReplaceItems(VisualNodes, nodes);
        MainWindowViewModel.ReplaceItems(VisualEdges, edges);
        GraphSummary = $"{nodes.Count - 1:N0} Knoten / {edges.Count:N0} Beziehungen / ab 2 zusammengefasst";
    }

    private static double UpstreamY(int level)
    {
        return level switch
        {
            1 => 440d,
            2 => 260d,
            _ => 80d,
        };
    }

    private static IfcRelationshipGraphVisualNode CreateSummaryNode(
        int entityId,
        string title,
        string subtitle,
        string meta,
        string tone,
        string glyph,
        double centerX,
        double centerY)
    {
        return new IfcRelationshipGraphVisualNode(
            entityId,
            title,
            subtitle,
            meta,
            tone,
            glyph,
            centerX,
            centerY,
            false);
    }

    private static string UpstreamSummaryTitle(IfcDocument document, IReadOnlyList<VisualRelationshipCandidate> candidates, int level)
    {
        var types = CandidateTypes(document, candidates);
        return types.Count == 1 ? ShortType(types[0]) : $"Ebene {level}";
    }

    private static string TypeSummaryMeta(IfcDocument document, IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        var types = CandidateTypes(document, candidates).Select(ShortType).ToList();
        return types.Count == 1
            ? $"{types[0]} x {candidates.Count:N0}"
            : $"{string.Join(", ", types.Take(3))}{(types.Count > 3 ? " ..." : string.Empty)}";
    }

    private static string SummaryTone(IfcDocument document, IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        var types = CandidateTypes(document, candidates);
        return types.Count == 1 ? EntityTone(types[0]) : "#64748B";
    }

    private static string SummaryGlyph(IfcDocument document, IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        var types = CandidateTypes(document, candidates);
        if (types.Count == 1)
        {
            return EntityGlyph(types[0]);
        }

        return candidates.Count > 9 ? "+" : candidates.Count.ToString();
    }

    private static string RelationshipSummaryMeta(IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        var relationships = candidates
            .Select(candidate => ShortRelationship(candidate.Relationship.Type))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        return relationships.Count == 1
            ? $"{candidates.Count:N0} Beziehungen"
            : $"{string.Join(", ", relationships.Take(2))}{(relationships.Count > 2 ? " ..." : string.Empty)}";
    }

    private static string RelationshipSummaryLabel(IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        var relationships = candidates
            .Select(candidate => ShortRelationship(candidate.Relationship.Type))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (relationships.Count == 1)
        {
            return candidates.Count == 1 ? relationships[0] : $"{candidates.Count:N0}x {relationships[0]}";
        }

        return $"{candidates.Count:N0} Bez.";
    }

    private static List<string> CandidateTypes(IfcDocument document, IReadOnlyList<VisualRelationshipCandidate> candidates)
    {
        return candidates
            .Select(candidate => document.EntityById[candidate.NodeId].Type)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(type => type)
            .ToList();
    }

    private List<VisualRelationshipCandidate> CollectUpstreamCandidates(IfcDocument currentDocument, int selectedId, string filter)
    {
        var candidates = new List<VisualRelationshipCandidate>();
        var seenNodes = new HashSet<int> { selectedId };
        var frontier = new List<int> { selectedId };

        for (var level = 1; level <= Depth && frontier.Count > 0; level++)
        {
            var nextFrontier = new List<int>();
            foreach (var focusId in frontier)
            {
                if (!currentDocument.RelationshipsByEntity.TryGetValue(focusId, out var focusRelationships))
                {
                    continue;
                }

                foreach (var relationship in focusRelationships
                    .Where(relationship => !IsPropertySetRelationship(relationship))
                    .Where(relationship => relationship.TargetIds.Contains(focusId))
                    .OrderBy(relationship => relationship.Type)
                    .ThenBy(relationship => relationship.Id))
                {
                    foreach (var sourceId in relationship.SourceIds.Where(id => id != focusId).Distinct().OrderBy(id => id))
                    {
                        if (!currentDocument.EntityById.TryGetValue(sourceId, out var sourceEntity) ||
                            IsPropertyLikeEntity(sourceEntity) ||
                            !MatchesVisualFilterForPair(currentDocument, focusId, sourceId, relationship, filter))
                        {
                            continue;
                        }

                        candidates.Add(new VisualRelationshipCandidate(relationship, sourceId, focusId, sourceId, level));
                        if (seenNodes.Add(sourceId))
                        {
                            nextFrontier.Add(sourceId);
                        }
                    }
                }
            }

            frontier = nextFrontier;
        }

        return candidates;
    }

    private static IEnumerable<VisualRelationshipCandidate> DirectCandidatesFor(IfcDocument document, int selectedId, IfcRelationship relationship)
    {
        foreach (var neighborId in NeighborIdsFor(selectedId, relationship).Distinct().OrderBy(id => id))
        {
            if (!document.EntityById.TryGetValue(neighborId, out var neighbor) || IsPropertyLikeEntity(neighbor))
            {
                continue;
            }

            if (relationship.SourceIds.Contains(selectedId))
            {
                yield return new VisualRelationshipCandidate(relationship, selectedId, neighborId, neighborId, 0);
            }
            else if (relationship.TargetIds.Contains(selectedId))
            {
                yield return new VisualRelationshipCandidate(relationship, neighborId, selectedId, neighborId, 0);
            }
            else
            {
                yield return new VisualRelationshipCandidate(relationship, selectedId, neighborId, neighborId, 0);
            }
        }
    }

    private static IfcRelationshipGraphVisualEdge CreateVisualEdge(
        IfcRelationship relationship,
        IfcRelationshipGraphVisualNode sourceNode,
        IfcRelationshipGraphVisualNode targetNode,
        string label)
    {
        return new IfcRelationshipGraphVisualEdge(
            relationship.Id,
            sourceNode.EntityId,
            targetNode.EntityId,
            label,
            RelationshipTone(relationship.Type),
            sourceNode.CenterX,
            sourceNode.CenterY,
            targetNode.CenterX,
            targetNode.CenterY,
            (sourceNode.CenterX + targetNode.CenterX) / 2,
            (sourceNode.CenterY + targetNode.CenterY) / 2);
    }

    private static (int SetCount, int ValueCount) GetPsetSummary(IfcDocument document, int entityId)
    {
        return document.PropertySetsByEntity.TryGetValue(entityId, out var propertySets)
            ? (propertySets.Count, propertySets.Sum(set => set.Values.Count))
            : (0, 0);
    }

    private static double SpreadX(int index, int count, double minX, double maxX)
    {
        if (count <= 1)
        {
            return (minX + maxX) / 2;
        }

        return minX + ((maxX - minX) * index / (count - 1));
    }

    private static IReadOnlyList<(double X, double Y)> LayoutDirectNodes(int count, bool reservePsetSlot)
    {
        var preferred = new List<(double X, double Y)>
        {
            (1150, 620),
            (360, 720),
            (960, 720),
            (360, 500),
            (960, 500),
            (120, 720),
            (1200, 720),
            (120, 500),
            (1200, 500),
            (560, 790),
            (760, 790),
            (560, 450),
            (760, 450),
        };

        if (!reservePsetSlot)
        {
            preferred.Insert(0, (170, 525));
        }

        while (preferred.Count < count)
        {
            var index = preferred.Count;
            var row = (index - 13) / 4;
            var column = (index - 13) % 4;
            preferred.Add((180 + (column * 300), 835 + (row * 95)));
        }

        return preferred.Take(count).ToList();
    }

    private static IfcRelationshipGraphVisualNode CreateVisualNode(IfcEntity entity, double centerX, double centerY, bool isCenter)
    {
        return new IfcRelationshipGraphVisualNode(
            entity.Id,
            ShortType(entity.Type),
            entity.DisplayName,
            string.IsNullOrWhiteSpace(entity.GlobalId) ? $"#{entity.Id}" : entity.GlobalId,
            EntityTone(entity.Type),
            EntityGlyph(entity.Type),
            centerX,
            centerY,
            isCenter);
    }

    private static IEnumerable<int> NeighborIdsFor(int selectedId, IfcRelationship relationship)
    {
        if (relationship.SourceIds.Contains(selectedId))
        {
            return relationship.TargetIds.Where(id => id != selectedId);
        }

        if (relationship.TargetIds.Contains(selectedId))
        {
            return relationship.SourceIds.Where(id => id != selectedId);
        }

        return relationship.SourceIds.Concat(relationship.TargetIds).Where(id => id != selectedId);
    }

    private static bool MatchesVisualFilter(IfcDocument document, int selectedId, IfcRelationship relationship, string filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        if ($"#{relationship.Id} {relationship.Type} {relationship.Label}".Contains(filter, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return NeighborIdsFor(selectedId, relationship).Any(id =>
            document.EntityById.TryGetValue(id, out var entity) &&
            $"#{entity.Id} {entity.Type} {entity.TypeName()} {entity.DisplayName} {entity.GlobalId}".Contains(filter, StringComparison.OrdinalIgnoreCase));
    }

    private static bool MatchesVisualFilterForPair(IfcDocument document, int focusId, int neighborId, IfcRelationship relationship, string filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        if ($"#{relationship.Id} {relationship.Type} {relationship.Label}".Contains(filter, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return EntityMatchesFilter(document, focusId, filter) || EntityMatchesFilter(document, neighborId, filter);
    }

    private static bool EntityMatchesFilter(IfcDocument document, int entityId, string filter)
    {
        return document.EntityById.TryGetValue(entityId, out var entity) &&
            $"#{entity.Id} {entity.Type} {entity.TypeName()} {entity.DisplayName} {entity.GlobalId}".Contains(filter, StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPropertySetRelationship(IfcRelationship relationship)
    {
        return relationship.Type.Equals("IFCRELDEFINESBYPROPERTIES", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPropertyLikeEntity(IfcEntity entity)
    {
        var normalized = entity.Type.ToUpperInvariant();
        return normalized.Contains("PROPERTYSET") || normalized.Contains("ELEMENTQUANTITY");
    }

    private static string ShortType(string type)
    {
        return type.StartsWith("IFC", StringComparison.OrdinalIgnoreCase) ? type[3..] : type;
    }

    private static string ShortRelationship(string type)
    {
        return type
            .Replace("IFCREL", string.Empty, StringComparison.OrdinalIgnoreCase)
            .Replace("IFC", string.Empty, StringComparison.OrdinalIgnoreCase);
    }

    private static string EntityTone(string type)
    {
        var normalized = type.ToUpperInvariant();
        if (normalized == "IFCPROJECT") return "#2F80ED";
        if (normalized == "IFCSITE") return "#2F9E44";
        if (normalized == "IFCBUILDING") return "#E39B16";
        if (normalized == "IFCBUILDINGSTOREY") return "#8E5AD7";
        if (normalized.Contains("SPACE") || normalized.Contains("DOOR") || normalized.Contains("WINDOW")) return "#22A6A1";
        if (normalized.Contains("WALL")) return "#DC4F45";
        if (normalized.Contains("SLAB") || normalized.Contains("ROOF")) return "#F97316";
        if (normalized.Contains("MATERIAL")) return "#8E5AD7";
        if (normalized.Contains("PROPERTY") || normalized.Contains("QUANTITY")) return "#2F9E44";
        if (normalized.Contains("TYPE")) return "#E39B16";
        return "#64748B";
    }

    private static string RelationshipTone(string type)
    {
        var normalized = type.ToUpperInvariant();
        if (normalized.Contains("PROPERT")) return "#2F9E44";
        if (normalized.Contains("MATERIAL")) return "#8E5AD7";
        if (normalized.Contains("TYPE")) return "#E39B16";
        if (normalized.Contains("FILL") || normalized.Contains("VOID")) return "#22A6A1";
        return "#73849A";
    }

    private static string EntityGlyph(string type)
    {
        var normalized = type.ToUpperInvariant();
        if (normalized.Contains("WALL")) return "W";
        if (normalized.Contains("DOOR")) return "D";
        if (normalized.Contains("BUILDING")) return "B";
        if (normalized.Contains("SITE")) return "S";
        if (normalized.Contains("MATERIAL")) return "M";
        if (normalized.Contains("PROPERTY") || normalized.Contains("QUANTITY")) return "P";
        if (normalized.Contains("TYPE")) return "T";
        if (normalized.Contains("WALL")) return "▦";
        if (normalized.Contains("DOOR")) return "▯";
        if (normalized.Contains("BUILDING")) return "▥";
        if (normalized.Contains("SITE")) return "⌂";
        if (normalized.Contains("MATERIAL")) return "▱";
        if (normalized.Contains("PROPERTY") || normalized.Contains("QUANTITY")) return "☷";
        if (normalized.Contains("TYPE")) return "◫";
        return "#";
    }

    private sealed record VisualRelationshipCandidate(
        IfcRelationship Relationship,
        int SourceId,
        int TargetId,
        int NodeId,
        int Level);
}

public sealed record IfcRelationshipGraphVisualNode(
    int EntityId,
    string Title,
    string Subtitle,
    string Meta,
    string Tone,
    string Glyph,
    double CenterX,
    double CenterY,
    bool IsCenter);

public sealed record IfcRelationshipGraphVisualEdge(
    int RelationshipId,
    int SourceId,
    int TargetId,
    string Label,
    string Tone,
    double X1,
    double Y1,
    double X2,
    double Y2,
    double LabelX,
    double LabelY);

public sealed class DiagnosticsPanelViewModel : ReactiveViewModel
{
    private readonly MainWindowViewModel owner;
    private IfcDocument? document;
    private string filterText = string.Empty;
    private IfcDiagnosticDetails? selectedDiagnostic;

    public ObservableCollection<IfcDiagnosticDetails> Items { get; } = [];

    public DiagnosticsPanelViewModel(MainWindowViewModel owner)
    {
        this.owner = owner;
        CheckCommand = ReactiveCommand.CreateFromTask(owner.RunDiagnosticsAsync);
        RepairCommand = ReactiveCommand.Create(() =>
        {
            if (SelectedDiagnostic is not null)
            {
                owner.RepairDiagnostic(SelectedDiagnostic);
            }
        });
    }

    public ReactiveCommand<Unit, Unit> CheckCommand { get; }

    public ReactiveCommand<Unit, Unit> RepairCommand { get; }

    public bool CanRepairSelected => SelectedDiagnostic?.CanRepair == true;

    public string FilterText
    {
        get => filterText;
        set
        {
            if (SetProperty(ref filterText, value))
            {
                Refresh();
            }
        }
    }

    public IfcDiagnosticDetails? SelectedDiagnostic
    {
        get => selectedDiagnostic;
        set
        {
            if (SetProperty(ref selectedDiagnostic, value) && value?.EntityId is int entityId)
            {
                owner.SelectEntityById(entityId, "diagnostic");
            }

            this.RaisePropertyChanged(nameof(CanRepairSelected));
        }
    }

    public void SetDocument(IfcDocument nextDocument)
    {
        document = nextDocument;
        Refresh();
    }

    private void Refresh()
    {
        if (document is null)
        {
            MainWindowViewModel.ReplaceItems(Items, []);
            return;
        }

        if (!document.Diagnostics.HasBeenChecked)
        {
            MainWindowViewModel.ReplaceItems(Items, [
                new IfcDiagnosticDetails(
                    "Info",
                    "Diagnostics have not been checked yet.",
                    "Click Check to validate model references, GlobalIds, containment, placements, and representations."),
            ]);
            return;
        }

        MainWindowViewModel.ReplaceItems(Items, IfcDiagnosticsProjector.Project(document.Diagnostics.CheckMessages, FilterText));
    }
}

public sealed class BuilderPanelViewModel : ReactiveViewModel
{
    private readonly MainWindowViewModel owner;
    private string selectedLabel = "No selection";
    private string productType = "IFCBUILDINGELEMENTPROXY";
    private string productName = "New native product";
    private string width = "2";
    private string depth = "1";
    private string height = "1";
    private string profile = "rectangle";

    public BuilderPanelViewModel(MainWindowViewModel owner)
    {
        this.owner = owner;
        CreateProductCommand = ReactiveCommand.Create(() => owner.CreateProduct(ProductType, ProductName, Width, Depth, Height, Profile));
        AssignBodyCommand = ReactiveCommand.Create(() => owner.AssignBody(Width, Depth, Height, Profile));
    }

    public ObservableCollection<string> Profiles { get; } = ["rectangle", "cylinder"];

    public ReactiveCommand<Unit, Unit> CreateProductCommand { get; }

    public ReactiveCommand<Unit, Unit> AssignBodyCommand { get; }

    public string SelectedLabel { get => selectedLabel; private set => this.RaiseAndSetIfChanged(ref selectedLabel, value); }

    public string ProductType { get => productType; set => this.RaiseAndSetIfChanged(ref productType, value); }

    public string ProductName { get => productName; set => this.RaiseAndSetIfChanged(ref productName, value); }

    public string Width { get => width; set => this.RaiseAndSetIfChanged(ref width, value); }

    public string Depth { get => depth; set => this.RaiseAndSetIfChanged(ref depth, value); }

    public string Height { get => height; set => this.RaiseAndSetIfChanged(ref height, value); }

    public string Profile { get => profile; set => this.RaiseAndSetIfChanged(ref profile, value); }

    public void SetDocument(IfcDocument document)
    {
        SelectedLabel = $"{document.FileName}: {document.Entities.Count:N0} entities";
    }

    public void SetSelection(IfcDocument document, IfcEntity entity)
    {
        SelectedLabel = $"#{entity.Id} {entity.TypeName()} {entity.DisplayName}";
    }
}

public sealed class RecentFilesPanelViewModel(MainWindowViewModel owner) : ReactiveViewModel
{
    private RecentIfcFile? selectedEntry;

    public ObservableCollection<RecentIfcFile> Entries { get; } = [];

    public RecentIfcFile? SelectedEntry
    {
        get => selectedEntry;
        set
        {
            if (SetProperty(ref selectedEntry, value) && value is not null)
            {
                _ = owner.OpenPathAsync(value.Path);
            }
        }
    }

    public void SetEntries(IEnumerable<RecentIfcFile> entries)
    {
        MainWindowViewModel.ReplaceItems(Entries, entries);
    }
}

public sealed class NotesPanelViewModel : ReactiveViewModel
{
    private string notes = string.Empty;

    public string Notes
    {
        get => notes;
        set => this.RaiseAndSetIfChanged(ref notes, value);
    }
}

public sealed class ConsolePanelViewModel : ReactiveViewModel
{
    private string currentStatus = "Ready.";
    private string logText = string.Empty;

    public ObservableCollection<string> Lines { get; } = [];

    public string CurrentStatus
    {
        get => currentStatus;
        private set => this.RaiseAndSetIfChanged(ref currentStatus, value);
    }

    public string LogText
    {
        get => logText;
        private set => this.RaiseAndSetIfChanged(ref logText, value);
    }

    public void Add(string message)
    {
        Lines.Add($"{DateTime.Now:T}  {message}");
        while (Lines.Count > 200)
        {
            Lines.RemoveAt(0);
        }

        LogText = string.Join(Environment.NewLine, Lines);
    }

    public void SetCurrentStatus(string message)
    {
        CurrentStatus = message;
    }
}
