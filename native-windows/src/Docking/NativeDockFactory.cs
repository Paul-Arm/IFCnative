using Dock.Model.Core;
using Dock.Model.Controls;
using Dock.Model.Mvvm;
using Dock.Model.Mvvm.Controls;
using IFCnative.NativeWindows.ViewModels;
using DockOrientation = Dock.Model.Core.Orientation;

namespace IFCnative.NativeWindows.Docking;

public sealed class NativeDockFactory(MainWindowViewModel workspace) : Factory
{
    public override IRootDock CreateLayout()
    {
        var models = Tool("models", "Models", workspace.Models, 0.24);
        var structure = Tool("structure", "Structure", workspace.Structure, 0.44);
        var types = Tool("types", "Types", workspace.Types, 0.28);
        var notes = Tool("notes", "Notes", workspace.Notes, 0.28);

        var modelDock = CreateToolDock();
        modelDock.Id = "model-tools";
        modelDock.Title = "Model";
        modelDock.Alignment = Alignment.Left;
        modelDock.Proportion = 0.22;
        modelDock.VisibleDockables = CreateList<IDockable>(models, structure, types, notes);
        modelDock.ActiveDockable = structure;
        modelDock.DefaultDockable = structure;
        modelDock.FocusedDockable = structure;

        var viewport = Document("viewport", "Viewport", workspace.Viewport);
        var graph = Document("graph", "Graph", workspace.Graph);
        var builder = Document("builder", "Builder", workspace.Builder);

        var documentDock = CreateDocumentDock();
        documentDock.Id = "workspace-documents";
        documentDock.Title = "Workspace";
        documentDock.Proportion = 0.60;
        documentDock.VisibleDockables = CreateList<IDockable>(viewport, graph, builder);
        var activeDocument = workspace.SelectedWorkspace?.Id == "graph-builder" ? graph : viewport;
        documentDock.ActiveDockable = activeDocument;
        documentDock.DefaultDockable = activeDocument;
        documentDock.FocusedDockable = activeDocument;

        var inspector = Tool("inspector", "Inspector", workspace.Inspector, 0.40);
        var psets = Tool("psets", "Batch Psets", workspace.PsetBatch, 0.30);
        var diagnostics = Tool("diagnostics", "Diagnostics", workspace.Diagnostics, 0.20);
        var draft = Tool("draft", "Draft", workspace.Draft, 0.15);
        var settings = Tool("settings", "Settings", workspace.Settings, 0.15);
        var console = Tool("console", "Console", workspace.Console, 0.10);

        var inspectorDock = CreateToolDock();
        inspectorDock.Id = "review-tools";
        inspectorDock.Title = "Review";
        inspectorDock.Alignment = Alignment.Right;
        inspectorDock.Proportion = 0.28;
        inspectorDock.VisibleDockables = CreateList<IDockable>(inspector, psets, diagnostics, draft, settings, console);
        var activeTool = workspace.SelectedWorkspace?.Id == "review" ? diagnostics : inspector;
        inspectorDock.ActiveDockable = activeTool;
        inspectorDock.DefaultDockable = activeTool;
        inspectorDock.FocusedDockable = activeTool;

        var main = CreateProportionalDock();
        main.Id = "main-dock";
        main.Orientation = DockOrientation.Horizontal;
        main.VisibleDockables = CreateList<IDockable>(
            modelDock,
            Splitter(),
            documentDock,
            Splitter(),
            inspectorDock);
        main.ActiveDockable = documentDock;
        main.DefaultDockable = documentDock;
        main.FocusedDockable = documentDock;

        var root = CreateRootDock();
        root.Id = "root";
        root.Title = "IFCnative";
        root.VisibleDockables = CreateList<IDockable>(main);
        root.ActiveDockable = main;
        root.DefaultDockable = main;
        root.FocusedDockable = main;
        return root;
    }

    private IDocument Document(string id, string title, object context)
    {
        var document = CreateDocument();
        document.Id = id;
        document.Title = title;
        document.Context = context;
        document.CanClose = false;
        document.CanFloat = true;
        document.CanDrag = true;
        return document;
    }

    private ITool Tool(string id, string title, object context, double proportion)
    {
        var tool = CreateTool();
        tool.Id = id;
        tool.Title = title;
        tool.Context = context;
        tool.Proportion = proportion;
        tool.CanClose = false;
        tool.CanFloat = true;
        tool.CanDrag = true;
        return tool;
    }

    private IProportionalDockSplitter Splitter()
    {
        var splitter = CreateProportionalDockSplitter();
        splitter.CanResize = true;
        splitter.ResizePreview = true;
        return splitter;
    }
}
