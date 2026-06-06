using System.Numerics;
using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.OpenGL;
using Avalonia.OpenGL.Controls;
using Avalonia.Rendering;
using Avalonia.Threading;
using IFCnative.NativeWindows.Services;
using IFCnative.NativeWindows.Models;
using Silk.NET.OpenGL;
using SilkGL = Silk.NET.OpenGL.GL;

namespace IFCnative.NativeWindows.Views;

public sealed class ViewportPreviewControl : OpenGlControlBase, ICustomHitTest
{
    public static readonly StyledProperty<IfcRenderScene?> SceneProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, IfcRenderScene?>(nameof(Scene));

    public static readonly StyledProperty<int> SelectedProductIdProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, int>(nameof(SelectedProductId));

    public static readonly StyledProperty<ViewportInteractionMode> InteractionModeProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, ViewportInteractionMode>(nameof(InteractionMode), ViewportInteractionMode.Select);

    public static readonly StyledProperty<bool> CanTransformSelectionProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, bool>(nameof(CanTransformSelection), false);

    public static readonly StyledProperty<bool> ShowFpsCounterProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, bool>(nameof(ShowFpsCounter), false);

    public static readonly StyledProperty<AntiAliasingMode> AntiAliasingProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, AntiAliasingMode>(nameof(AntiAliasing), AntiAliasingMode.None);

    public AntiAliasingMode AntiAliasing
    {
        get => GetValue(AntiAliasingProperty);
        set => SetValue(AntiAliasingProperty, value);
    }

    public static readonly StyledProperty<bool> HideSpacesProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, bool>(nameof(HideSpaces), false);

    public bool HideSpaces
    {
        get => GetValue(HideSpacesProperty);
        set => SetValue(HideSpacesProperty, value);
    }

    public static readonly StyledProperty<double> FieldOfViewProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, double>(nameof(FieldOfView), 45.0);

    public double FieldOfView
    {
        get => GetValue(FieldOfViewProperty);
        set => SetValue(FieldOfViewProperty, value);
    }

    public static readonly StyledProperty<double> NearPlaneProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, double>(nameof(NearPlane), 0.01);

    public double NearPlane
    {
        get => GetValue(NearPlaneProperty);
        set => SetValue(NearPlaneProperty, value);
    }

    public static readonly StyledProperty<double> FarPlaneProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, double>(nameof(FarPlane), 1000.0);

    public double FarPlane
    {
        get => GetValue(FarPlaneProperty);
        set => SetValue(FarPlaneProperty, value);
    }

    private const int VertexStride = 11;
    private enum DragMode
    {
        None,
        Orbit,
        Pan,
        Dolly,
    }

    private enum GizmoHandle
    {
        None,
        MoveX,
        MoveY,
        MoveZ,
        RotateZ,
    }

    private sealed class GizmoDragState
    {
        public required int ProductId { get; init; }

        public required GizmoHandle Handle { get; init; }

        public required Vector3 Center { get; init; }

        public required Vector3 Axis { get; init; }

        public float StartAxisParameter { get; set; }

        public float StartAngle { get; set; }

        public Vector3 MoveDeltaWorld { get; set; }

        public float RotateZRadians { get; set; }
    }

    private SilkGL? glApi;
    private uint program;
    private uint vertexArray;
    private uint vertexBuffer;
    private uint indexBuffer;
    private uint transparentIndexBuffer;
    private uint lineVertexArray;
    private uint lineVertexBuffer;
    private uint gizmoVertexArray;
    private uint gizmoVertexBuffer;
    private int opaqueIndexCount;
    private int transparentIndexCount;
    private int lineVertexCount;
    private bool buffersDirty = true;
    private bool renderQueued;
    private float[] vertices = [];
    private uint[] opaqueIndices = [];
    private uint[] transparentIndices = [];
    private float[] lineVertices = [];
    private List<TransparentMeshBatch> transparentMeshBatches = [];
    private NativeViewportCameraState camera = NativeViewportCameraController.DefaultState();
    private Point? lastPointer;
    private Point? clickStart;
    private Point? pendingPickPoint;
    private bool pointerMoved;
    private DragMode dragMode;
    private GizmoDragState? gizmoDrag;
    private Matrix4x4 previewTransform = Matrix4x4.Identity;
    private Vector3 previewMoveDeltaWorld;
    private float previewRotateZRadians;
    private int previewProductId;
    private int renderLogCount;
    private bool suppressNextFraming;
    private int fpsFrameCount;
    private long fpsWindowStartTicks;
    private long previousRenderStartTicks;
    private double accumulatedFrameIntervalMs;
    private double accumulatedCpuFrameMs;
    private int fpsIntervalSampleCount;
    private string lastFpsText = "0 FPS";
    private int visibleMeshCount;
    private int visibleTriangleCount;
    private int visibleVertexCount;

    // MSAA FBO buffers
    private uint msaaFbo;
    private uint msaaColorRb;
    private uint msaaDepthRb;
    private int lastMsaaWidth;
    private int lastMsaaHeight;
    private AntiAliasingMode lastMsaaMode = AntiAliasingMode.None;

    // FXAA FBO and Shader buffers
    private uint postFbo;
    private uint postTexture;
    private uint postDepthRb;
    private uint fxaaProgram;
    private uint quadVao;
    private uint quadVbo;
    private int lastPostWidth;
    private int lastPostHeight;
    private AntiAliasingMode lastPostMode = AntiAliasingMode.None;

    public event EventHandler<IfcProductPickedEventArgs>? ProductPicked;

    public event EventHandler<IfcProductTransformCommittedEventArgs>? ProductTransformCommitted;

    public event EventHandler<ViewportFpsUpdatedEventArgs>? FpsUpdated;

    public ViewportPreviewControl()
    {
        Focusable = true;
    }

    static ViewportPreviewControl()
    {
        AffectsRender<ViewportPreviewControl>(SceneProperty, SelectedProductIdProperty, InteractionModeProperty, CanTransformSelectionProperty, ShowFpsCounterProperty, AntiAliasingProperty, HideSpacesProperty, FieldOfViewProperty, NearPlaneProperty, FarPlaneProperty);
        SceneProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnSceneChanged());
        SelectedProductIdProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnSelectedProductChanged());
        InteractionModeProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnInteractionModeChanged());
        CanTransformSelectionProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnTransformAvailabilityChanged());
        ShowFpsCounterProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnShowFpsCounterChanged());
        AntiAliasingProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnAntiAliasingChanged());
        HideSpacesProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnHideSpacesChanged());
        FieldOfViewProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnCameraPropertyChanged());
        NearPlaneProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnCameraPropertyChanged());
        FarPlaneProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnCameraPropertyChanged());
    }

    public IfcRenderScene? Scene
    {
        get => GetValue(SceneProperty);
        set => SetValue(SceneProperty, value);
    }

    public int SelectedProductId
    {
        get => GetValue(SelectedProductIdProperty);
        set => SetValue(SelectedProductIdProperty, value);
    }

    public ViewportInteractionMode InteractionMode
    {
        get => GetValue(InteractionModeProperty);
        set => SetValue(InteractionModeProperty, value);
    }

    public bool CanTransformSelection
    {
        get => GetValue(CanTransformSelectionProperty);
        set => SetValue(CanTransformSelectionProperty, value);
    }

    public bool ShowFpsCounter
    {
        get => GetValue(ShowFpsCounterProperty);
        set => SetValue(ShowFpsCounterProperty, value);
    }

    public void FitCamera()
    {
        camera = NativeViewportCameraController.FitScene(Scene ?? IfcRenderScene.Empty());
        QueueRender();
    }

    public void FrameSelectedProduct()
    {
        if (!TryFrameProduct(SelectedProductId))
        {
            QueueRender();
        }
    }

    public void SetIsoView()
    {
        SetCameraAngles(-51.633, 25.2);
    }

    public void SetTopView()
    {
        SetCameraAngles(-90, 89);
    }

    public void SetFrontView()
    {
        SetCameraAngles(-90, 0);
    }

    public void SetRightView()
    {
        SetCameraAngles(0, 0);
    }

    public void ClearTransformPreview()
    {
        ResetGizmoPreview();
    }

    protected override void OnOpenGlInit(GlInterface gl)
    {
        try
        {
            base.OnOpenGlInit(gl);
            glApi = SilkGL.GetApi(name => gl.GetProcAddress(name));
            LogViewport($"init context={gl.ContextInfo}");
            LogViewport($"gl version={ReadGlString(glApi, StringName.Version)} renderer={ReadGlString(glApi, StringName.Renderer)} shading={ReadGlString(glApi, StringName.ShadingLanguageVersion)}");
            program = CreateProgram(glApi);
            vertexArray = glApi.GenVertexArray();
            vertexBuffer = glApi.GenBuffer();
            indexBuffer = glApi.GenBuffer();
            transparentIndexBuffer = glApi.GenBuffer();
            lineVertexArray = glApi.GenVertexArray();
            lineVertexBuffer = glApi.GenBuffer();
            gizmoVertexArray = glApi.GenVertexArray();
            gizmoVertexBuffer = glApi.GenBuffer();

            fxaaProgram = CreateProgram(glApi, FxaaVertexShaderSource, FxaaFragmentShaderSource);
            quadVao = glApi.GenVertexArray();
            quadVbo = glApi.GenBuffer();
            glApi.BindVertexArray(quadVao);
            glApi.BindBuffer(BufferTargetARB.ArrayBuffer, quadVbo);
            float[] quadVertices = [
                -1f, -1f,
                 1f, -1f,
                -1f,  1f,
                -1f,  1f,
                 1f, -1f,
                 1f,  1f
            ];
            unsafe
            {
                fixed (float* qPtr = quadVertices)
                {
                    glApi.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(quadVertices.Length * sizeof(float)), qPtr, BufferUsageARB.StaticDraw);
                }
                glApi.EnableVertexAttribArray(0);
                glApi.VertexAttribPointer(0, 2, VertexAttribPointerType.Float, false, 2 * sizeof(float), null);
            }
            glApi.BindVertexArray(0);

            glApi.Enable(EnableCap.DepthTest);
            glApi.Disable(EnableCap.CullFace);
            buffersDirty = true;
            QueueRender();
        }
        catch (Exception exception)
        {
            LogViewport($"init failed: {exception}");
            throw;
        }
    }

    protected override void OnOpenGlDeinit(GlInterface gl)
    {
        if (glApi is not null)
        {
            if (indexBuffer != 0)
            {
                glApi.DeleteBuffer(indexBuffer);
            }

            if (transparentIndexBuffer != 0)
            {
                glApi.DeleteBuffer(transparentIndexBuffer);
            }

            if (vertexBuffer != 0)
            {
                glApi.DeleteBuffer(vertexBuffer);
            }

            if (vertexArray != 0)
            {
                glApi.DeleteVertexArray(vertexArray);
            }

            if (lineVertexBuffer != 0)
            {
                glApi.DeleteBuffer(lineVertexBuffer);
            }

            if (lineVertexArray != 0)
            {
                glApi.DeleteVertexArray(lineVertexArray);
            }

            if (gizmoVertexBuffer != 0)
            {
                glApi.DeleteBuffer(gizmoVertexBuffer);
            }

            if (gizmoVertexArray != 0)
            {
                glApi.DeleteVertexArray(gizmoVertexArray);
            }

            if (program != 0)
            {
                glApi.DeleteProgram(program);
            }

            if (msaaFbo != 0)
            {
                glApi.DeleteFramebuffer(msaaFbo);
                msaaFbo = 0;
            }
            if (msaaColorRb != 0)
            {
                glApi.DeleteRenderbuffer(msaaColorRb);
                msaaColorRb = 0;
            }
            if (msaaDepthRb != 0)
            {
                glApi.DeleteRenderbuffer(msaaDepthRb);
                msaaDepthRb = 0;
            }

            if (postFbo != 0)
            {
                glApi.DeleteFramebuffer(postFbo);
                postFbo = 0;
            }
            if (postTexture != 0)
            {
                glApi.DeleteTexture(postTexture);
                postTexture = 0;
            }
            if (postDepthRb != 0)
            {
                glApi.DeleteRenderbuffer(postDepthRb);
                postDepthRb = 0;
            }
            if (fxaaProgram != 0)
            {
                glApi.DeleteProgram(fxaaProgram);
                fxaaProgram = 0;
            }
            if (quadVao != 0)
            {
                glApi.DeleteVertexArray(quadVao);
                quadVao = 0;
            }
            if (quadVbo != 0)
            {
                glApi.DeleteBuffer(quadVbo);
                quadVbo = 0;
            }
        }

        LogViewport("deinit");
        glApi = null;
        base.OnOpenGlDeinit(gl);
    }

    protected override unsafe void OnOpenGlRender(GlInterface gl, int fb)
    {
        if (glApi is null || program == 0)
        {
            return;
        }

        var renderStartTicks = Stopwatch.GetTimestamp();
        var frameIntervalMs = previousRenderStartTicks == 0
            ? 0d
            : (renderStartTicks - previousRenderStartTicks) * 1000d / Stopwatch.Frequency;
        previousRenderStartTicks = renderStartTicks;
        var drawCalls = 0;

        if (buffersDirty)
        {
            BuildBuffers();
            UploadBuffers(glApi);
            buffersDirty = false;
        }

        var width = Math.Max(1, (int)Bounds.Width);
        var height = Math.Max(1, (int)Bounds.Height);

        var aaMode = AntiAliasing;
        var msaaSamples = aaMode switch
        {
            AntiAliasingMode.Msaa4x => 4,
            AntiAliasingMode.Msaa8x => 8,
            _ => 0
        };
        var isFxaa = aaMode == AntiAliasingMode.Fxaa;

        if (msaaSamples > 0)
        {
            if (msaaFbo == 0 || width != lastMsaaWidth || height != lastMsaaHeight || aaMode != lastMsaaMode)
            {
                if (msaaFbo != 0) glApi.DeleteFramebuffer(msaaFbo);
                if (msaaColorRb != 0) glApi.DeleteRenderbuffer(msaaColorRb);
                if (msaaDepthRb != 0) glApi.DeleteRenderbuffer(msaaDepthRb);

                msaaFbo = glApi.GenFramebuffer();
                glApi.BindFramebuffer(FramebufferTarget.Framebuffer, msaaFbo);

                msaaColorRb = glApi.GenRenderbuffer();
                glApi.BindRenderbuffer(RenderbufferTarget.Renderbuffer, msaaColorRb);
                glApi.RenderbufferStorageMultisample(RenderbufferTarget.Renderbuffer, (uint)msaaSamples, InternalFormat.Rgba8, (uint)width, (uint)height);
                glApi.FramebufferRenderbuffer(FramebufferTarget.Framebuffer, FramebufferAttachment.ColorAttachment0, RenderbufferTarget.Renderbuffer, msaaColorRb);

                msaaDepthRb = glApi.GenRenderbuffer();
                glApi.BindRenderbuffer(RenderbufferTarget.Renderbuffer, msaaDepthRb);
                glApi.RenderbufferStorageMultisample(RenderbufferTarget.Renderbuffer, (uint)msaaSamples, InternalFormat.Depth24Stencil8, (uint)width, (uint)height);
                glApi.FramebufferRenderbuffer(FramebufferTarget.Framebuffer, FramebufferAttachment.DepthAttachment, RenderbufferTarget.Renderbuffer, msaaDepthRb);

                var status = glApi.CheckFramebufferStatus(FramebufferTarget.Framebuffer);
                if ((FramebufferStatus)status != FramebufferStatus.Complete)
                {
                    LogViewport($"MSAA FBO creation failed: {status}");
                    msaaSamples = 0;
                }
                else
                {
                    lastMsaaWidth = width;
                    lastMsaaHeight = height;
                    lastMsaaMode = aaMode;
                }
            }
        }

        if (isFxaa)
        {
            if (postFbo == 0 || width != lastPostWidth || height != lastPostHeight || aaMode != lastPostMode)
            {
                if (postFbo != 0) glApi.DeleteFramebuffer(postFbo);
                if (postTexture != 0) glApi.DeleteTexture(postTexture);
                if (postDepthRb != 0) glApi.DeleteRenderbuffer(postDepthRb);

                postFbo = glApi.GenFramebuffer();
                glApi.BindFramebuffer(FramebufferTarget.Framebuffer, postFbo);

                postTexture = glApi.GenTexture();
                glApi.BindTexture(TextureTarget.Texture2D, postTexture);
                glApi.TexImage2D(TextureTarget.Texture2D, 0, InternalFormat.Rgb8, (uint)width, (uint)height, 0, PixelFormat.Rgb, PixelType.UnsignedByte, null);
                glApi.TexParameter(TextureTarget.Texture2D, TextureParameterName.TextureMinFilter, (int)TextureMinFilter.Linear);
                glApi.TexParameter(TextureTarget.Texture2D, TextureParameterName.TextureMagFilter, (int)TextureMagFilter.Linear);
                glApi.FramebufferTexture2D(FramebufferTarget.Framebuffer, FramebufferAttachment.ColorAttachment0, TextureTarget.Texture2D, postTexture, 0);

                postDepthRb = glApi.GenRenderbuffer();
                glApi.BindRenderbuffer(RenderbufferTarget.Renderbuffer, postDepthRb);
                glApi.RenderbufferStorage(RenderbufferTarget.Renderbuffer, InternalFormat.Depth24Stencil8, (uint)width, (uint)height);
                glApi.FramebufferRenderbuffer(FramebufferTarget.Framebuffer, FramebufferAttachment.DepthAttachment, RenderbufferTarget.Renderbuffer, postDepthRb);

                var status = glApi.CheckFramebufferStatus(FramebufferTarget.Framebuffer);
                if ((FramebufferStatus)status != FramebufferStatus.Complete)
                {
                    LogViewport($"FXAA FBO creation failed: {status}");
                    isFxaa = false;
                }
                else
                {
                    lastPostWidth = width;
                    lastPostHeight = height;
                    lastPostMode = aaMode;
                }
            }
        }

        if (msaaSamples > 0)
        {
            glApi.BindFramebuffer(FramebufferTarget.Framebuffer, msaaFbo);
        }
        else if (isFxaa)
        {
            glApi.BindFramebuffer(FramebufferTarget.Framebuffer, postFbo);
        }
        else
        {
            glApi.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)fb);
        }

        glApi.Viewport(0, 0, (uint)width, (uint)height);
        glApi.ClearColor(0.055f, 0.07f, 0.06f, 1f);
        glApi.Clear(ClearBufferMask.ColorBufferBit | ClearBufferMask.DepthBufferBit);

        var viewProjection = CreateViewProjection(width, height);
        var uniformMatrix = viewProjection;
        glApi.UseProgram(program);
        var matrix = &uniformMatrix.M11;
        glApi.UniformMatrix4(glApi.GetUniformLocation(program, "uMvp"), 1, false, matrix);

        glApi.Uniform1(glApi.GetUniformLocation(program, "uSelectedProductId"), SelectedProductId);
        glApi.Uniform1(glApi.GetUniformLocation(program, "uPreviewProductId"), previewProductId);
        var previewMatrix = previewTransform;
        glApi.UniformMatrix4(glApi.GetUniformLocation(program, "uPreviewTransform"), 1, false, &previewMatrix.M11);

        if (lineVertexCount > 0)
        {
            glApi.Disable(EnableCap.Blend);
            glApi.DepthMask(true);
            glApi.BindVertexArray(lineVertexArray);
            glApi.LineWidth(1f);
            glApi.DrawArrays(PrimitiveType.Lines, 0, (uint)lineVertexCount);
            drawCalls++;
        }

        if (opaqueIndexCount > 0)
        {
            glApi.Disable(EnableCap.Blend);
            glApi.DepthMask(true);
            glApi.BindVertexArray(vertexArray);
            glApi.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
            glApi.DrawElements(PrimitiveType.Triangles, (uint)opaqueIndexCount, DrawElementsType.UnsignedInt, null);
            drawCalls++;
        }

        if (transparentMeshBatches.Count > 0)
        {
            UpdateTransparentIndexBuffer(glApi, ToVector(camera.ToPose().Position));
            if (transparentIndexCount > 0)
            {
                glApi.BindVertexArray(vertexArray);
                glApi.BindBuffer(BufferTargetARB.ElementArrayBuffer, transparentIndexBuffer);
                glApi.Enable(EnableCap.Blend);
                glApi.BlendFunc(BlendingFactor.SrcAlpha, BlendingFactor.OneMinusSrcAlpha);
                glApi.DepthMask(false);
                glApi.DrawElements(PrimitiveType.Triangles, (uint)transparentIndexCount, DrawElementsType.UnsignedInt, null);
                glApi.DepthMask(true);
                glApi.Disable(EnableCap.Blend);
                drawCalls++;
            }
        }

        drawCalls += DrawGizmo(glApi, viewProjection);

        glApi.BindVertexArray(0);
        if (renderLogCount < 8)
        {
            renderLogCount++;
            LogViewport($"render {renderLogCount}: fb={fb} size={width}x{height} scene='{Scene?.Status}' vertices={vertices.Length / VertexStride} opaqueIndices={opaqueIndexCount} transparentIndices={transparentIndexCount} lines={lineVertexCount} glError={glApi.GetError()}");
        }

        if (msaaSamples > 0)
        {
            glApi.BindFramebuffer(FramebufferTarget.ReadFramebuffer, msaaFbo);
            glApi.BindFramebuffer(FramebufferTarget.DrawFramebuffer, (uint)fb);
            glApi.BlitFramebuffer(0, 0, width, height, 0, 0, width, height, ClearBufferMask.ColorBufferBit, BlitFramebufferFilter.Nearest);
            glApi.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)fb);
        }
        else if (isFxaa && fxaaProgram != 0)
        {
            glApi.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)fb);
            glApi.Viewport(0, 0, (uint)width, (uint)height);
            glApi.ClearColor(0.055f, 0.07f, 0.06f, 1f);
            glApi.Clear(ClearBufferMask.ColorBufferBit | ClearBufferMask.DepthBufferBit);
            
            glApi.UseProgram(fxaaProgram);
            glApi.ActiveTexture(TextureUnit.Texture0);
            glApi.BindTexture(TextureTarget.Texture2D, postTexture);
            glApi.Uniform1(glApi.GetUniformLocation(fxaaProgram, "uTexture"), 0);
            glApi.Uniform2(glApi.GetUniformLocation(fxaaProgram, "uTexelSize"), 1.0f / width, 1.0f / height);
            
            glApi.BindVertexArray(quadVao);
            glApi.DrawArrays(PrimitiveType.Triangles, 0, 6);
            glApi.BindVertexArray(0);
            glApi.UseProgram(0);
            drawCalls++;
        }

        if (pendingPickPoint is { } pickPoint)
        {
            pendingPickPoint = null;
            var pickedProductId = PickProduct(pickPoint);
            if (pickedProductId > 0)
            {
                suppressNextFraming = true;
                Dispatcher.UIThread.Post(() => ProductPicked?.Invoke(this, new IfcProductPickedEventArgs(pickedProductId)));
            }
        }

        var cpuFrameMs = (Stopwatch.GetTimestamp() - renderStartTicks) * 1000d / Stopwatch.Frequency;
        UpdateFpsCounter(frameIntervalMs, cpuFrameMs, drawCalls, aaMode, isFxaa);
        if (ShowFpsCounter)
        {
            QueueRender();
        }
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        Focus();
        var point = e.GetCurrentPoint(this);
        lastPointer = point.Position;
        clickStart = point.Position;
        pointerMoved = false;
        if (point.Properties.PointerUpdateKind == PointerUpdateKind.LeftButtonPressed
            && e.KeyModifiers == KeyModifiers.None
            && TryBeginGizmoDrag(point.Position))
        {
            dragMode = DragMode.None;
            LogViewport($"OnPointerPressed: gizmo={gizmoDrag?.Handle}");
            e.Pointer.Capture(this);
            e.Handled = true;
            return;
        }

        dragMode = GetDragMode(point, e.KeyModifiers);
        LogViewport($"OnPointerPressed: button={point.Properties.PointerUpdateKind} Left={point.Properties.IsLeftButtonPressed} Middle={point.Properties.IsMiddleButtonPressed} Right={point.Properties.IsRightButtonPressed} dragMode={dragMode}");
        e.Pointer.Capture(this);
        if (dragMode != DragMode.None)
        {
            e.Handled = true;
        }
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (lastPointer is not { } previous)
        {
            return;
        }

        var current = e.GetPosition(this);
        var deltaX = current.X - previous.X;
        var deltaY = current.Y - previous.Y;
        if (Math.Abs(deltaX) + Math.Abs(deltaY) > 1)
        {
            pointerMoved = true;
        }

        if (gizmoDrag is not null)
        {
            UpdateGizmoDrag(current);
            lastPointer = current;
            e.Handled = true;
            return;
        }

        camera = dragMode switch
        {
            DragMode.Orbit => NativeViewportCameraController.Orbit(camera, deltaX, deltaY),
            DragMode.Pan => NativeViewportCameraController.Pan(camera, deltaX, deltaY, Bounds.Width, Bounds.Height),
            DragMode.Dolly => NativeViewportCameraController.Dolly(camera, deltaY),
            _ => camera,
        };
        if (dragMode != DragMode.None)
        {
            LogViewport($"OnPointerMoved: dragMode={dragMode} delta={deltaX:F2},{deltaY:F2} Yaw={camera.YawDegrees:F2} Pitch={camera.PitchDegrees:F2} Target={camera.Target.X:F2},{camera.Target.Y:F2},{camera.Target.Z:F2}");
        }
        lastPointer = current;
        if (dragMode != DragMode.None)
        {
            QueueRender();
            e.Handled = true;
        }
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        var point = e.GetPosition(this);
        e.Pointer.Capture(null);
        lastPointer = null;

        var pointProperties = e.GetCurrentPoint(this).Properties;
        LogViewport($"OnPointerReleased: button={pointProperties.PointerUpdateKind} pointerMoved={pointerMoved} dragMode={dragMode}");
        if (gizmoDrag is not null)
        {
            CommitGizmoDrag();
            dragMode = DragMode.None;
            clickStart = null;
            e.Handled = true;
            return;
        }

        if (pointProperties.PointerUpdateKind == PointerUpdateKind.LeftButtonReleased && !pointerMoved && clickStart is not null)
        {
            pendingPickPoint = point;
            QueueRender();
        }

        if (dragMode != DragMode.None)
        {
            e.Handled = true;
        }
        dragMode = DragMode.None;
        clickStart = null;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        camera = NativeViewportCameraController.Zoom(camera, (int)(e.Delta.Y * 120));
        QueueRender();
        e.Handled = true;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        switch (e.Key)
        {
            case Key.Escape when gizmoDrag is not null || previewProductId != 0:
                CancelGizmoDrag();
                e.Handled = true;
                break;
            case Key.F:
                FrameSelectedProduct();
                e.Handled = true;
                break;
            case Key.Home:
                FitCamera();
                e.Handled = true;
                break;
            case Key.NumPad1:
                SetFrontView();
                e.Handled = true;
                break;
            case Key.NumPad3:
                SetRightView();
                e.Handled = true;
                break;
            case Key.NumPad7:
                SetTopView();
                e.Handled = true;
                break;
        }
    }

    private void OnSceneChanged()
    {
        ClearCommittedTransformPreview();
        buffersDirty = true;
        if (SelectedProductId > 0 && TryFrameProduct(SelectedProductId))
        {
            return;
        }

        FitCamera();
    }

    private void OnSelectedProductChanged()
    {
        CancelGizmoDrag();
        if (suppressNextFraming)
        {
            suppressNextFraming = false;
            QueueRender();
            return;
        }

        if (SelectedProductId > 0 && TryFrameProduct(SelectedProductId))
        {
            return;
        }

        QueueRender();
    }

    private void OnAntiAliasingChanged()
    {
        QueueRender();
    }

    private void OnInteractionModeChanged()
    {
        CancelGizmoDrag();
        QueueRender();
    }

    private void OnTransformAvailabilityChanged()
    {
        if (!CanTransformSelection)
        {
            CancelGizmoDrag();
        }

        QueueRender();
    }

    private void OnShowFpsCounterChanged()
    {
        fpsFrameCount = 0;
        fpsWindowStartTicks = Stopwatch.GetTimestamp();
        previousRenderStartTicks = 0;
        accumulatedFrameIntervalMs = 0d;
        accumulatedCpuFrameMs = 0d;
        fpsIntervalSampleCount = 0;
        lastFpsText = "0 FPS";
        FpsUpdated?.Invoke(this, new ViewportFpsUpdatedEventArgs(lastFpsText));
        if (ShowFpsCounter)
        {
            QueueRender();
        }
    }

    private void OnHideSpacesChanged()
    {
        buffersDirty = true;
        QueueRender();
    }

    private void OnCameraPropertyChanged()
    {
        QueueRender();
    }

    private void SetCameraAngles(double yawDegrees, double pitchDegrees)
    {
        var framed = TryGetSelectedProductBounds(SelectedProductId, out var selectedBounds)
            ? NativeViewportCameraController.FitBounds(selectedBounds, yawDegrees, pitchDegrees)
            : NativeViewportCameraController.FitScene(Scene ?? IfcRenderScene.Empty()) with
            {
                YawDegrees = yawDegrees,
                PitchDegrees = pitchDegrees,
            };
        camera = framed with
        {
            YawDegrees = yawDegrees,
            PitchDegrees = pitchDegrees,
        };
        QueueRender();
    }

    private bool TryFrameProduct(int productId)
    {
        if (!TryGetSelectedProductBounds(productId, out var bounds))
        {
            return false;
        }

        camera = NativeViewportCameraController.FitBounds(bounds, camera.YawDegrees, camera.PitchDegrees);
        QueueRender();
        return true;
    }

    private bool TryGetSelectedProductBounds(int productId, out IfcRenderBounds bounds)
    {
        bounds = IfcRenderBounds.Empty;
        var scene = Scene;
        if (productId <= 0 || scene is null || scene.IsEmpty)
        {
            return false;
        }

        var hideSpaces = HideSpaces;
        foreach (var mesh in scene.Meshes.Where(mesh => mesh.ProductId == productId && mesh.IsRenderable))
        {
            if (hideSpaces && mesh.IsSpace)
            {
                continue;
            }

            foreach (var vertex in mesh.Vertices)
            {
                bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
            }
        }

        return !bounds.IsEmpty;
    }

    private unsafe int DrawGizmo(SilkGL gl, Matrix4x4 viewProjection)
    {
        if (!TryGetGizmoMetrics(out var center, out var size))
        {
            return 0;
        }

        var values = BuildGizmoVertices(center, size);
        if (values.Count == 0)
        {
            return 0;
        }

        BindArray(gl, gizmoVertexArray, gizmoVertexBuffer);
        var gizmoVertices = values.ToArray();
        fixed (float* pointer = gizmoVertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(gizmoVertices.Length * sizeof(float)), pointer, BufferUsageARB.DynamicDraw);
        }

        ConfigureAttributes(gl);
        gl.Disable(EnableCap.DepthTest);
        gl.Enable(EnableCap.Blend);
        gl.BlendFunc(BlendingFactor.SrcAlpha, BlendingFactor.OneMinusSrcAlpha);
        gl.DepthMask(false);
        gl.LineWidth(3f);
        gl.DrawArrays(PrimitiveType.Lines, 0, (uint)(gizmoVertices.Length / VertexStride));
        gl.LineWidth(1f);
        gl.DepthMask(true);
        gl.Disable(EnableCap.Blend);
        gl.Enable(EnableCap.DepthTest);
        return 1;
    }

    private bool TryGetGizmoMetrics(out Vector3 center, out float size)
    {
        center = Vector3.Zero;
        size = 1f;
        if (!CanTransformSelection || InteractionMode == ViewportInteractionMode.Select)
        {
            return false;
        }

        if (!TryGetSelectedProductBounds(SelectedProductId, out var bounds))
        {
            return false;
        }

        center = ToVector(bounds.Center) + previewMoveDeltaWorld;
        var objectScale = Math.Max(0.15d, bounds.Radius * 1.2d);
        var cameraScale = Math.Max(0.15d, camera.Distance * 0.16d);
        var sceneScale = Math.Max(0.4d, camera.SceneRadius * 0.35d);
        size = (float)Math.Clamp(Math.Max(objectScale, cameraScale), 0.15d, sceneScale);
        return true;
    }

    private List<float> BuildGizmoVertices(Vector3 center, float size)
    {
        var values = new List<float>();
        var active = gizmoDrag?.Handle ?? GizmoHandle.None;

        if (InteractionMode == ViewportInteractionMode.Move)
        {
            AddMoveHandle(values, center, Vector3.UnitX, size, active == GizmoHandle.MoveX, new IfcRenderColor(0.96f, 0.22f, 0.16f, 1f));
            AddMoveHandle(values, center, Vector3.UnitY, size, active == GizmoHandle.MoveY, new IfcRenderColor(0.24f, 0.78f, 0.34f, 1f));
            AddMoveHandle(values, center, Vector3.UnitZ, size, active == GizmoHandle.MoveZ, new IfcRenderColor(0.24f, 0.50f, 1.00f, 1f));
        }
        else if (InteractionMode == ViewportInteractionMode.Rotate)
        {
            var color = active == GizmoHandle.RotateZ
                ? new IfcRenderColor(1.00f, 0.82f, 0.20f, 1f)
                : new IfcRenderColor(0.28f, 0.72f, 1.00f, 0.96f);
            AddRotationRing(values, center, size * 0.85f, color);
        }

        return values;
    }

    private static void AddMoveHandle(List<float> values, Vector3 center, Vector3 axis, float size, bool active, IfcRenderColor baseColor)
    {
        var color = active
            ? new IfcRenderColor(1f, 0.84f, 0.20f, 1f)
            : baseColor;
        var end = center + axis * size;
        AddLine(values, center, end, color);

        var headLength = size * 0.16f;
        var headWidth = size * 0.07f;
        var side = Math.Abs(Vector3.Dot(axis, Vector3.UnitX)) > 0.9f
            ? Vector3.UnitY
            : Vector3.UnitX;
        AddLine(values, end, end - axis * headLength + side * headWidth, color);
        AddLine(values, end, end - axis * headLength - side * headWidth, color);
        if (Math.Abs(Vector3.Dot(axis, Vector3.UnitZ)) > 0.9f)
        {
            AddLine(values, end, end - axis * headLength + Vector3.UnitY * headWidth, color);
            AddLine(values, end, end - axis * headLength - Vector3.UnitY * headWidth, color);
        }
    }

    private static void AddRotationRing(List<float> values, Vector3 center, float radius, IfcRenderColor color)
    {
        const int segments = 96;
        var previous = center + new Vector3(radius, 0, 0);
        for (var i = 1; i <= segments; i++)
        {
            var angle = i * MathF.Tau / segments;
            var next = center + new Vector3(MathF.Cos(angle) * radius, MathF.Sin(angle) * radius, 0);
            AddLine(values, previous, next, color);
            previous = next;
        }
    }

    private bool TryBeginGizmoDrag(Point point)
    {
        if (!TryHitGizmo(point, out var handle) || !TryGetGizmoMetrics(out var center, out _))
        {
            return false;
        }

        if (!TryCreateRay(point, out var rayOrigin, out var rayDirection))
        {
            return false;
        }

        var axis = HandleAxis(handle);
        var state = new GizmoDragState
        {
            ProductId = SelectedProductId,
            Handle = handle,
            Center = center,
            Axis = axis,
        };

        if (handle == GizmoHandle.RotateZ)
        {
            if (!TryIntersectPlane(rayOrigin, rayDirection, center, Vector3.UnitZ, out var hit))
            {
                return false;
            }

            state.StartAngle = MathF.Atan2(hit.Y - center.Y, hit.X - center.X);
        }
        else if (!TryClosestParameterOnAxis(rayOrigin, rayDirection, center, axis, out var parameter))
        {
            return false;
        }
        else
        {
            state.StartAxisParameter = parameter;
        }

        gizmoDrag = state;
        previewProductId = SelectedProductId;
        previewTransform = Matrix4x4.Identity;
        previewMoveDeltaWorld = Vector3.Zero;
        previewRotateZRadians = 0f;
        QueueRender();
        return true;
    }

    private void UpdateGizmoDrag(Point point)
    {
        if (gizmoDrag is null || !TryCreateRay(point, out var rayOrigin, out var rayDirection))
        {
            return;
        }

        if (gizmoDrag.Handle == GizmoHandle.RotateZ)
        {
            if (!TryIntersectPlane(rayOrigin, rayDirection, gizmoDrag.Center, Vector3.UnitZ, out var hit))
            {
                return;
            }

            var currentAngle = MathF.Atan2(hit.Y - gizmoDrag.Center.Y, hit.X - gizmoDrag.Center.X);
            gizmoDrag.RotateZRadians = NormalizeRadians(currentAngle - gizmoDrag.StartAngle);
            gizmoDrag.MoveDeltaWorld = Vector3.Zero;
        }
        else if (TryClosestParameterOnAxis(rayOrigin, rayDirection, gizmoDrag.Center, gizmoDrag.Axis, out var parameter))
        {
            gizmoDrag.MoveDeltaWorld = gizmoDrag.Axis * (parameter - gizmoDrag.StartAxisParameter);
            gizmoDrag.RotateZRadians = 0f;
        }

        previewProductId = gizmoDrag.ProductId;
        previewMoveDeltaWorld = gizmoDrag.MoveDeltaWorld;
        previewRotateZRadians = gizmoDrag.RotateZRadians;
        previewTransform = CreatePreviewTransform(gizmoDrag.Center, previewMoveDeltaWorld, previewRotateZRadians);
        QueueRender();
    }

    private void CommitGizmoDrag()
    {
        if (gizmoDrag is { } state)
        {
            var shouldCommit = state.MoveDeltaWorld.LengthSquared() > 0.0000001f || Math.Abs(state.RotateZRadians) > 0.0000001f;
            var productId = state.ProductId;
            var moveDelta = state.MoveDeltaWorld;
            var rotateZ = state.RotateZRadians;
            gizmoDrag = null;
            if (shouldCommit)
            {
                previewProductId = productId;
                previewMoveDeltaWorld = moveDelta;
                previewRotateZRadians = rotateZ;
                previewTransform = CreatePreviewTransform(state.Center, moveDelta, rotateZ);
                QueueRender();
                Dispatcher.UIThread.Post(() => ProductTransformCommitted?.Invoke(this, new IfcProductTransformCommittedEventArgs(productId, moveDelta, rotateZ)));
            }
            else
            {
                ResetGizmoPreview();
            }

            return;
        }

        ResetGizmoPreview();
    }

    private void CancelGizmoDrag()
    {
        if (gizmoDrag is null && previewProductId == 0)
        {
            return;
        }

        ResetGizmoPreview();
    }

    private void ResetGizmoPreview()
    {
        gizmoDrag = null;
        previewProductId = 0;
        previewMoveDeltaWorld = Vector3.Zero;
        previewRotateZRadians = 0f;
        previewTransform = Matrix4x4.Identity;
        QueueRender();
    }

    private void ClearCommittedTransformPreview()
    {
        if (gizmoDrag is not null || previewProductId == 0)
        {
            return;
        }

        previewProductId = 0;
        previewMoveDeltaWorld = Vector3.Zero;
        previewRotateZRadians = 0f;
        previewTransform = Matrix4x4.Identity;
    }

    private bool TryHitGizmo(Point point, out GizmoHandle handle)
    {
        handle = GizmoHandle.None;
        if (!TryGetGizmoMetrics(out var center, out var size))
        {
            return false;
        }

        var width = Math.Max(1d, Bounds.Width);
        var height = Math.Max(1d, Bounds.Height);
        var viewProjection = CreateViewProjection(width, height);
        var bestDistance = 12d;

        if (InteractionMode == ViewportInteractionMode.Move)
        {
            TryAxisHit(GizmoHandle.MoveX, center, Vector3.UnitX, size, point, viewProjection, width, height, ref bestDistance, ref handle);
            TryAxisHit(GizmoHandle.MoveY, center, Vector3.UnitY, size, point, viewProjection, width, height, ref bestDistance, ref handle);
            TryAxisHit(GizmoHandle.MoveZ, center, Vector3.UnitZ, size, point, viewProjection, width, height, ref bestDistance, ref handle);
        }
        else if (InteractionMode == ViewportInteractionMode.Rotate)
        {
            TryRingHit(center, size * 0.85f, point, viewProjection, width, height, ref bestDistance, ref handle);
        }

        return handle != GizmoHandle.None;
    }

    private static void TryAxisHit(
        GizmoHandle candidate,
        Vector3 center,
        Vector3 axis,
        float size,
        Point point,
        Matrix4x4 viewProjection,
        double width,
        double height,
        ref double bestDistance,
        ref GizmoHandle handle)
    {
        if (!TryProjectPoint(center, viewProjection, width, height, out var start)
            || !TryProjectPoint(center + axis * size, viewProjection, width, height, out var end))
        {
            return;
        }

        var distance = DistanceToSegment(point, start, end);
        if (distance < bestDistance)
        {
            bestDistance = distance;
            handle = candidate;
        }
    }

    private static void TryRingHit(
        Vector3 center,
        float radius,
        Point point,
        Matrix4x4 viewProjection,
        double width,
        double height,
        ref double bestDistance,
        ref GizmoHandle handle)
    {
        const int segments = 64;
        var previous = center + new Vector3(radius, 0, 0);
        if (!TryProjectPoint(previous, viewProjection, width, height, out var previousScreen))
        {
            return;
        }

        for (var i = 1; i <= segments; i++)
        {
            var angle = i * MathF.Tau / segments;
            var next = center + new Vector3(MathF.Cos(angle) * radius, MathF.Sin(angle) * radius, 0);
            if (TryProjectPoint(next, viewProjection, width, height, out var nextScreen))
            {
                var distance = DistanceToSegment(point, previousScreen, nextScreen);
                if (distance < bestDistance)
                {
                    bestDistance = distance;
                    handle = GizmoHandle.RotateZ;
                }

                previousScreen = nextScreen;
            }
        }
    }

    private bool TryCreateRay(Point point, out Vector3 origin, out Vector3 direction)
    {
        origin = Vector3.Zero;
        direction = Vector3.UnitZ;
        var width = Math.Max(1d, Bounds.Width);
        var height = Math.Max(1d, Bounds.Height);
        var ndcX = (float)((2d * point.X / width) - 1d);
        var ndcY = (float)(1d - (2d * point.Y / height));
        var viewProjection = CreateViewProjection(width, height);
        if (!Matrix4x4.Invert(viewProjection, out var inverse))
        {
            return false;
        }

        var near = Unproject(new Vector3(ndcX, ndcY, 0f), inverse);
        var far = Unproject(new Vector3(ndcX, ndcY, 1f), inverse);
        var rayDirection = far - near;
        if (rayDirection.LengthSquared() < 0.0000001f)
        {
            return false;
        }

        origin = near;
        direction = Vector3.Normalize(rayDirection);
        return true;
    }

    private static bool TryClosestParameterOnAxis(Vector3 rayOrigin, Vector3 rayDirection, Vector3 axisOrigin, Vector3 axisDirection, out float parameter)
    {
        parameter = 0f;
        if (axisDirection.LengthSquared() < 0.0000001f)
        {
            return false;
        }

        var axis = Vector3.Normalize(axisDirection);
        var ray = Vector3.Normalize(rayDirection);
        var w0 = rayOrigin - axisOrigin;
        var a = Vector3.Dot(ray, ray);
        var b = Vector3.Dot(ray, axis);
        var c = Vector3.Dot(axis, axis);
        var d = Vector3.Dot(ray, w0);
        var e = Vector3.Dot(axis, w0);
        var denominator = a * c - b * b;
        parameter = Math.Abs(denominator) < 0.000001f
            ? e
            : (a * e - b * d) / denominator;
        return !float.IsNaN(parameter) && !float.IsInfinity(parameter);
    }

    private static bool TryIntersectPlane(Vector3 rayOrigin, Vector3 rayDirection, Vector3 planePoint, Vector3 planeNormal, out Vector3 hit)
    {
        hit = Vector3.Zero;
        var denominator = Vector3.Dot(rayDirection, planeNormal);
        if (Math.Abs(denominator) < 0.000001f)
        {
            return false;
        }

        var distance = Vector3.Dot(planePoint - rayOrigin, planeNormal) / denominator;
        if (distance < 0)
        {
            return false;
        }

        hit = rayOrigin + rayDirection * distance;
        return true;
    }

    private static Matrix4x4 CreatePreviewTransform(Vector3 center, Vector3 moveDelta, float rotateZRadians)
    {
        if (Math.Abs(rotateZRadians) > 0.0000001f)
        {
            return Matrix4x4.CreateTranslation(-center)
                * Matrix4x4.CreateRotationZ(rotateZRadians)
                * Matrix4x4.CreateTranslation(center);
        }

        return moveDelta.LengthSquared() > 0.0000001f
            ? Matrix4x4.CreateTranslation(moveDelta)
            : Matrix4x4.Identity;
    }

    private static Vector3 HandleAxis(GizmoHandle handle)
    {
        return handle switch
        {
            GizmoHandle.MoveX => Vector3.UnitX,
            GizmoHandle.MoveY => Vector3.UnitY,
            GizmoHandle.MoveZ => Vector3.UnitZ,
            _ => Vector3.UnitZ,
        };
    }

    private static bool TryProjectPoint(Vector3 world, Matrix4x4 viewProjection, double width, double height, out Point screen)
    {
        screen = default;
        var clip = Vector4.Transform(new Vector4(world, 1f), viewProjection);
        if (Math.Abs(clip.W) < 0.000001f)
        {
            return false;
        }

        var ndcX = clip.X / clip.W;
        var ndcY = clip.Y / clip.W;
        if (float.IsNaN(ndcX) || float.IsNaN(ndcY) || float.IsInfinity(ndcX) || float.IsInfinity(ndcY))
        {
            return false;
        }

        screen = new Point((ndcX + 1f) * 0.5f * width, (1f - ndcY) * 0.5f * height);
        return true;
    }

    private static double DistanceToSegment(Point point, Point start, Point end)
    {
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.000001d)
        {
            return Math.Sqrt(Math.Pow(point.X - start.X, 2) + Math.Pow(point.Y - start.Y, 2));
        }

        var t = Math.Clamp(((point.X - start.X) * dx + (point.Y - start.Y) * dy) / lengthSquared, 0d, 1d);
        var x = start.X + t * dx;
        var y = start.Y + t * dy;
        return Math.Sqrt(Math.Pow(point.X - x, 2) + Math.Pow(point.Y - y, 2));
    }

    public bool HitTest(Point point)
    {
        return new Rect(Bounds.Size).Contains(point);
    }

    private static DragMode GetDragMode(PointerPoint point, KeyModifiers modifiers)
    {
        if (point.Properties.IsLeftButtonPressed)
        {
            if (modifiers.HasFlag(KeyModifiers.Control))
            {
                return DragMode.Dolly;
            }

            return modifiers.HasFlag(KeyModifiers.Shift)
                ? DragMode.Pan
                : DragMode.Orbit;
        }

        if (point.Properties.IsMiddleButtonPressed)
        {
            if (modifiers.HasFlag(KeyModifiers.Control))
            {
                return DragMode.Dolly;
            }

            return modifiers.HasFlag(KeyModifiers.Shift)
                ? DragMode.Pan
                : DragMode.Orbit;
        }

        if (point.Properties.IsRightButtonPressed)
        {
            return modifiers.HasFlag(KeyModifiers.Shift)
                ? DragMode.Orbit
                : DragMode.Pan;
        }

        return DragMode.None;
    }

    private void QueueRender()
    {
        if (renderQueued)
        {
            return;
        }

        renderQueued = true;
        Dispatcher.UIThread.Post(() =>
        {
            renderQueued = false;
            RequestNextFrameRendering();
        });
    }

    private void UpdateFpsCounter(
        double frameIntervalMs,
        double cpuFrameMs,
        int drawCalls,
        AntiAliasingMode aaMode,
        bool isFxaa)
    {
        if (!ShowFpsCounter)
        {
            return;
        }

        var now = Stopwatch.GetTimestamp();
        if (fpsWindowStartTicks == 0)
        {
            fpsWindowStartTicks = now;
        }

        fpsFrameCount++;
        if (frameIntervalMs > 0d)
        {
            accumulatedFrameIntervalMs += frameIntervalMs;
            fpsIntervalSampleCount++;
        }

        accumulatedCpuFrameMs += cpuFrameMs;
        var elapsedSeconds = (now - fpsWindowStartTicks) / (double)Stopwatch.Frequency;
        if (elapsedSeconds < 0.5)
        {
            return;
        }

        var averageIntervalMs = fpsIntervalSampleCount > 0
            ? accumulatedFrameIntervalMs / fpsIntervalSampleCount
            : elapsedSeconds * 1000d / Math.Max(1, fpsFrameCount);
        var averageCpuMs = accumulatedCpuFrameMs / Math.Max(1, fpsFrameCount);
        var fps = fpsFrameCount / elapsedSeconds;
        var nextText = FormatViewportStats(
            fps,
            averageIntervalMs,
            averageCpuMs,
            drawCalls,
            aaMode,
            isFxaa);
        fpsFrameCount = 0;
        fpsWindowStartTicks = now;
        accumulatedFrameIntervalMs = 0d;
        accumulatedCpuFrameMs = 0d;
        fpsIntervalSampleCount = 0;
        if (string.Equals(nextText, lastFpsText, StringComparison.Ordinal))
        {
            return;
        }

        lastFpsText = nextText;
        Dispatcher.UIThread.Post(() => FpsUpdated?.Invoke(this, new ViewportFpsUpdatedEventArgs(nextText)));
    }

    private string FormatViewportStats(
        double fps,
        double frameIntervalMs,
        double cpuFrameMs,
        int drawCalls,
        AntiAliasingMode aaMode,
        bool isFxaa)
    {
        var scene = Scene;
        var instanceCount = scene?.ShapeInstanceCount ?? 0;
        var aaLabel = isFxaa ? "FXAA" : aaMode.ToString();
        return string.Join(
            Environment.NewLine,
            $"{fps:0} FPS  interval {frameIntervalMs:0.0} ms",
            $"CPU {cpuFrameMs:0.0} ms  draws {drawCalls:N0}",
            $"meshes {visibleMeshCount:N0}  tris {visibleTriangleCount:N0}",
            $"verts {visibleVertexCount:N0}  inst {instanceCount:N0}",
            $"loop continuous  AA {aaLabel}");
    }

    private void BuildBuffers()
    {
        var scene = Scene;
        if (scene is null || scene.IsEmpty)
        {
            vertices = [];
            opaqueIndices = [];
            transparentIndices = [];
            lineVertices = [];
            transparentMeshBatches = [];
            opaqueIndexCount = 0;
            transparentIndexCount = 0;
            lineVertexCount = 0;
            visibleMeshCount = 0;
            visibleTriangleCount = 0;
            visibleVertexCount = 0;
            return;
        }

        var hideSpaces = HideSpaces;
        var vertexValues = new List<float>();
        var opaqueIndexValues = new List<uint>();
        var batches = new List<TransparentMeshBatch>();
        var meshCount = 0;
        var triangleCount = 0;
        foreach (var mesh in scene.Meshes.Where(mesh => mesh.IsRenderable))
        {
            if (hideSpaces && mesh.IsSpace)
            {
                continue;
            }

            meshCount++;
            var baseIndex = (uint)(vertexValues.Count / VertexStride);
            foreach (var vertex in mesh.Vertices)
            {
                AddVertex(vertexValues, vertex, mesh.Color, mesh.ProductId);
            }

            var meshIndexValues = IsTransparent(mesh)
                ? new List<uint>(mesh.Indices.Count)
                : opaqueIndexValues;
            foreach (var index in mesh.Indices)
            {
                if (index >= 0 && index < mesh.Vertices.Count)
                {
                    meshIndexValues.Add(baseIndex + (uint)index);
                }
            }

            triangleCount += meshIndexValues.Count / 3;
            if (meshIndexValues != opaqueIndexValues && meshIndexValues.Count > 0)
            {
                batches.Add(new TransparentMeshBatch(MeshCenter(mesh), meshIndexValues.ToArray()));
            }
        }

        vertices = vertexValues.ToArray();
        opaqueIndices = opaqueIndexValues.ToArray();
        transparentMeshBatches = batches;
        transparentIndices = [];
        opaqueIndexCount = opaqueIndices.Length;
        transparentIndexCount = 0;
        lineVertices = BuildGridAndAxes(scene).ToArray();
        lineVertexCount = lineVertices.Length / VertexStride;
        visibleMeshCount = meshCount;
        visibleTriangleCount = triangleCount;
        visibleVertexCount = vertices.Length / VertexStride;
    }

    private unsafe void UploadBuffers(SilkGL gl)
    {
        BindArray(gl, vertexArray, vertexBuffer);
        fixed (float* vertexPointer = vertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(vertices.Length * sizeof(float)), vertexPointer, BufferUsageARB.StaticDraw);
        }

        gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
        fixed (uint* indexPointer = opaqueIndices)
        {
            gl.BufferData(BufferTargetARB.ElementArrayBuffer, (nuint)(opaqueIndices.Length * sizeof(uint)), indexPointer, BufferUsageARB.StaticDraw);
        }

        ConfigureAttributes(gl);

        BindArray(gl, lineVertexArray, lineVertexBuffer);
        fixed (float* linePointer = lineVertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(lineVertices.Length * sizeof(float)), linePointer, BufferUsageARB.StaticDraw);
        }

        ConfigureAttributes(gl);
        gl.BindVertexArray(0);
    }

    private unsafe void UpdateTransparentIndexBuffer(SilkGL gl, Vector3 cameraPosition)
    {
        var totalIndexCount = 0;
        foreach (var batch in transparentMeshBatches)
        {
            totalIndexCount += batch.Indices.Length;
        }

        if (totalIndexCount == 0)
        {
            transparentIndexCount = 0;
            return;
        }

        transparentMeshBatches.Sort((left, right) =>
            Vector3.DistanceSquared(right.Center, cameraPosition)
                .CompareTo(Vector3.DistanceSquared(left.Center, cameraPosition)));

        if (transparentIndices.Length != totalIndexCount)
        {
            transparentIndices = new uint[totalIndexCount];
        }

        var offset = 0;
        foreach (var batch in transparentMeshBatches)
        {
            Array.Copy(batch.Indices, 0, transparentIndices, offset, batch.Indices.Length);
            offset += batch.Indices.Length;
        }

        transparentIndexCount = totalIndexCount;
        gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, transparentIndexBuffer);
        fixed (uint* indexPointer = transparentIndices)
        {
            gl.BufferData(BufferTargetARB.ElementArrayBuffer, (nuint)(transparentIndices.Length * sizeof(uint)), indexPointer, BufferUsageARB.DynamicDraw);
        }
    }

    private static void BindArray(SilkGL gl, uint array, uint buffer)
    {
        gl.BindVertexArray(array);
        gl.BindBuffer(BufferTargetARB.ArrayBuffer, buffer);
    }

    private static unsafe void ConfigureAttributes(SilkGL gl)
    {
        const uint stride = VertexStride * sizeof(float);
        gl.EnableVertexAttribArray(0);
        gl.VertexAttribPointer(0, 3, VertexAttribPointerType.Float, false, stride, null);
        gl.EnableVertexAttribArray(1);
        gl.VertexAttribPointer(1, 3, VertexAttribPointerType.Float, false, stride, (void*)(3 * sizeof(float)));
        gl.EnableVertexAttribArray(2);
        gl.VertexAttribPointer(2, 4, VertexAttribPointerType.Float, false, stride, (void*)(6 * sizeof(float)));
        gl.EnableVertexAttribArray(3);
        gl.VertexAttribPointer(3, 1, VertexAttribPointerType.Float, false, stride, (void*)(10 * sizeof(float)));
    }

    private static void AddVertex(List<float> values, IfcRenderVertex vertex, IfcRenderColor color, int productId)
    {
        values.Add(vertex.X);
        values.Add(vertex.Y);
        values.Add(vertex.Z);
        values.Add(vertex.NormalX);
        values.Add(vertex.NormalY);
        values.Add(vertex.NormalZ);
        values.Add(color.R);
        values.Add(color.G);
        values.Add(color.B);
        values.Add(color.A);
        values.Add(productId);
    }

    private static bool IsTransparent(IfcRenderMesh mesh)
    {
        return mesh.Color.A < 0.99f;
    }

    private static Vector3 MeshCenter(IfcRenderMesh mesh)
    {
        var bounds = IfcRenderBounds.Empty;
        foreach (var vertex in mesh.Vertices)
        {
            bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
        }

        var center = bounds.Center;
        return new Vector3((float)center.X, (float)center.Y, (float)center.Z);
    }

    private static IEnumerable<float> BuildGridAndAxes(IfcRenderScene scene)
    {
        var values = new List<float>();
        var radius = Math.Max(1d, scene.Bounds.Radius);
        var center = scene.Bounds.Center;
        var step = NiceStep(radius / 6d);
        var extent = Math.Max(step * 6d, radius * 1.25d);
        var minX = Math.Floor((center.X - extent) / step) * step;
        var maxX = Math.Ceiling((center.X + extent) / step) * step;
        var minY = Math.Floor((center.Y - extent) / step) * step;
        var maxY = Math.Ceiling((center.Y + extent) / step) * step;
        var z = scene.Bounds.IsEmpty ? 0f : scene.Bounds.MinZ - (float)(radius * 0.015d);
        var grid = new IfcRenderColor(0.17f, 0.22f, 0.19f, 1f);
        var axisX = new IfcRenderColor(0.88f, 0.34f, 0.28f, 1f);
        var axisY = new IfcRenderColor(0.34f, 0.68f, 0.42f, 1f);
        var axisZ = new IfcRenderColor(0.32f, 0.54f, 0.86f, 1f);

        for (var x = minX; x <= maxX + step / 2d; x += step)
        {
            AddLine(values, (float)x, (float)minY, z, (float)x, (float)maxY, z, grid);
        }

        for (var y = minY; y <= maxY + step / 2d; y += step)
        {
            AddLine(values, (float)minX, (float)y, z, (float)maxX, (float)y, z, grid);
        }

        AddLine(values, (float)(center.X - extent), (float)center.Y, z, (float)(center.X + extent), (float)center.Y, z, axisX);
        AddLine(values, (float)center.X, (float)(center.Y - extent), z, (float)center.X, (float)(center.Y + extent), z, axisY);
        AddLine(values, (float)center.X, (float)center.Y, z, (float)center.X, (float)center.Y, (float)(z + extent), axisZ);
        return values;
    }

    private static void AddLine(List<float> values, float x1, float y1, float z1, float x2, float y2, float z2, IfcRenderColor color)
    {
        AddVertex(values, new IfcRenderVertex(x1, y1, z1, 0, 0, 1), color, 0);
        AddVertex(values, new IfcRenderVertex(x2, y2, z2, 0, 0, 1), color, 0);
    }

    private static void AddLine(List<float> values, Vector3 start, Vector3 end, IfcRenderColor color)
    {
        AddLine(values, start.X, start.Y, start.Z, end.X, end.Y, end.Z, color);
    }

    private static double NiceStep(double value)
    {
        if (value <= 0 || double.IsNaN(value) || double.IsInfinity(value))
        {
            return 1;
        }

        var exponent = Math.Floor(Math.Log10(value));
        var fraction = value / Math.Pow(10, exponent);
        var niceFraction = fraction switch
        {
            <= 1 => 1,
            <= 2 => 2,
            <= 5 => 5,
            _ => 10,
        };
        return niceFraction * Math.Pow(10, exponent);
    }

    private Matrix4x4 CreateViewProjection(double width, double height)
    {
        camera = camera with
        {
            FieldOfViewDegrees = FieldOfView,
            NearPlane = NearPlane,
            FarPlane = FarPlane
        };
        var pose = camera.ToPose();
        var position = ToVector(pose.Position);
        var target = position + ToVector(pose.LookDirection);
        var up = ToVector(pose.UpDirection);
        var view = Matrix4x4.CreateLookAt(position, target, up);
        var aspect = Math.Max(0.1f, (float)(width / Math.Max(1d, height)));
        var projection = Matrix4x4.CreatePerspectiveFieldOfView(
            DegreesToRadians((float)pose.FieldOfViewDegrees),
            aspect,
            (float)pose.NearPlaneDistance,
            (float)pose.FarPlaneDistance);
        return view * projection;
    }

    private int PickProduct(Point point)
    {
        var scene = Scene;
        if (scene is null || scene.IsEmpty)
        {
            return 0;
        }

        var width = Math.Max(1d, Bounds.Width);
        var height = Math.Max(1d, Bounds.Height);
        var ndcX = (float)((2d * point.X / width) - 1d);
        var ndcY = (float)(1d - (2d * point.Y / height));
        var viewProjection = CreateViewProjection(width, height);
        if (!Matrix4x4.Invert(viewProjection, out var inverse))
        {
            return 0;
        }

        var near = Unproject(new Vector3(ndcX, ndcY, 0f), inverse);
        var far = Unproject(new Vector3(ndcX, ndcY, 1f), inverse);
        var direction = Vector3.Normalize(far - near);
        var bestDistance = float.PositiveInfinity;
        var hideSpaces = HideSpaces;
        var picked = 0;
        foreach (var mesh in scene.Meshes)
        {
            if (!mesh.IsRenderable)
            {
                continue;
            }

            if (hideSpaces && mesh.IsSpace)
            {
                continue;
            }

            for (var i = 0; i + 2 < mesh.Indices.Count; i += 3)
            {
                var first = mesh.Indices[i];
                var second = mesh.Indices[i + 1];
                var third = mesh.Indices[i + 2];
                if (first < 0 || second < 0 || third < 0
                    || first >= mesh.Vertices.Count || second >= mesh.Vertices.Count || third >= mesh.Vertices.Count)
                {
                    continue;
                }

                if (IntersectTriangle(
                    near,
                    direction,
                    ToVector(mesh.Vertices[first]),
                    ToVector(mesh.Vertices[second]),
                    ToVector(mesh.Vertices[third]),
                    out var distance)
                    && distance < bestDistance)
                {
                    bestDistance = distance;
                    picked = mesh.ProductId;
                }
            }
        }

        return picked;
    }

    private static Vector3 Unproject(Vector3 source, Matrix4x4 inverse)
    {
        var point = Vector4.Transform(new Vector4(source, 1f), inverse);
        return point.W == 0f ? new Vector3(point.X, point.Y, point.Z) : new Vector3(point.X, point.Y, point.Z) / point.W;
    }

    private static bool IntersectTriangle(Vector3 origin, Vector3 direction, Vector3 a, Vector3 b, Vector3 c, out float distance)
    {
        const float epsilon = 0.000001f;
        distance = 0;
        var edge1 = b - a;
        var edge2 = c - a;
        var h = Vector3.Cross(direction, edge2);
        var determinant = Vector3.Dot(edge1, h);
        if (determinant is > -epsilon and < epsilon)
        {
            return false;
        }

        var inverseDeterminant = 1f / determinant;
        var s = origin - a;
        var u = inverseDeterminant * Vector3.Dot(s, h);
        if (u is < 0f or > 1f)
        {
            return false;
        }

        var q = Vector3.Cross(s, edge1);
        var v = inverseDeterminant * Vector3.Dot(direction, q);
        if (v < 0f || u + v > 1f)
        {
            return false;
        }

        distance = inverseDeterminant * Vector3.Dot(edge2, q);
        return distance > epsilon;
    }

    private static Vector3 ToVector(IfcPreviewVertex vertex)
    {
        return new Vector3((float)vertex.X, (float)vertex.Y, (float)vertex.Z);
    }

    private static Vector3 ToVector(IfcRenderVertex vertex)
    {
        return new Vector3(vertex.X, vertex.Y, vertex.Z);
    }

    private static float DegreesToRadians(float degrees)
    {
        return degrees * MathF.PI / 180f;
    }

    private static float NormalizeRadians(float radians)
    {
        var normalized = radians % MathF.Tau;
        return normalized <= -MathF.PI
            ? normalized + MathF.Tau
            : normalized > MathF.PI
                ? normalized - MathF.Tau
                : normalized;
    }

    private static uint CreateProgram(SilkGL gl)
    {
        var vertexShader = CompileShader(gl, ShaderType.VertexShader, VertexShaderSource);
        var fragmentShader = CompileShader(gl, ShaderType.FragmentShader, FragmentShaderSource);
        var shaderProgram = gl.CreateProgram();
        gl.AttachShader(shaderProgram, vertexShader);
        gl.AttachShader(shaderProgram, fragmentShader);
        gl.BindAttribLocation(shaderProgram, 0, "aPosition");
        gl.BindAttribLocation(shaderProgram, 1, "aNormal");
        gl.BindAttribLocation(shaderProgram, 2, "aColor");
        gl.BindAttribLocation(shaderProgram, 3, "aProductId");
        gl.LinkProgram(shaderProgram);
        gl.GetProgram(shaderProgram, ProgramPropertyARB.LinkStatus, out var status);
        if (status == 0)
        {
            throw new InvalidOperationException(gl.GetProgramInfoLog(shaderProgram));
        }

        gl.DetachShader(shaderProgram, vertexShader);
        gl.DetachShader(shaderProgram, fragmentShader);
        gl.DeleteShader(vertexShader);
        gl.DeleteShader(fragmentShader);
        return shaderProgram;
    }

    private static uint CompileShader(SilkGL gl, ShaderType type, string source)
    {
        var shader = gl.CreateShader(type);
        gl.ShaderSource(shader, source);
        gl.CompileShader(shader);
        gl.GetShader(shader, ShaderParameterName.CompileStatus, out var status);
        if (status == 0)
        {
            throw new InvalidOperationException(gl.GetShaderInfoLog(shader));
        }

        return shader;
    }

    private static string ReadGlString(SilkGL gl, StringName name)
    {
        try
        {
            return gl.GetStringS(name);
        }
        catch (Exception exception)
        {
            return $"unavailable ({exception.Message})";
        }
    }

    private static void LogViewport(string message)
    {
        try
        {
            var path = Path.Combine(Path.GetTempPath(), "IFCnative.viewport.log");
            File.AppendAllText(path, $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
        }
    }

    private const string VertexShaderSource = """
#version 120
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec4 aColor;
attribute float aProductId;

uniform mat4 uMvp;
uniform mat4 uPreviewTransform;
uniform int uPreviewProductId;

varying vec3 vNormal;
varying vec4 vColor;
varying float vProductId;

void main()
{
    vec4 worldPosition = vec4(aPosition, 1.0);
    if (uPreviewProductId > 0 && abs(aProductId - float(uPreviewProductId)) < 0.5)
    {
        worldPosition = uPreviewTransform * worldPosition;
    }

    gl_Position = uMvp * worldPosition;
    vNormal = aNormal;
    vColor = aColor;
    vProductId = aProductId;
}
""";

    private const string FragmentShaderSource = """
#version 120
varying vec3 vNormal;
varying vec4 vColor;
varying float vProductId;

uniform int uSelectedProductId;

void main()
{
    vec3 normal = normalize(vNormal);
    float light = max(dot(normal, normalize(vec3(0.35, 0.55, 0.75))), 0.0);
    vec3 color = vColor.rgb * (0.38 + light * 0.62);
    if (uSelectedProductId > 0 && abs(vProductId - float(uSelectedProductId)) < 0.5)
    {
        color = mix(color, vec3(1.0, 0.78, 0.22), 0.68);
    }

    gl_FragColor = vec4(color, vColor.a);
}
""";

    private static uint CreateProgram(SilkGL gl, string vertexShaderSource, string fragmentShaderSource)
    {
        var vertexShader = CompileShader(gl, ShaderType.VertexShader, vertexShaderSource);
        var fragmentShader = CompileShader(gl, ShaderType.FragmentShader, fragmentShaderSource);
        var shaderProgram = gl.CreateProgram();
        gl.AttachShader(shaderProgram, vertexShader);
        gl.AttachShader(shaderProgram, fragmentShader);
        gl.BindAttribLocation(shaderProgram, 0, "aPosition");
        gl.LinkProgram(shaderProgram);
        gl.GetProgram(shaderProgram, ProgramPropertyARB.LinkStatus, out var status);
        if (status == 0)
        {
            throw new InvalidOperationException(gl.GetProgramInfoLog(shaderProgram));
        }

        gl.DetachShader(shaderProgram, vertexShader);
        gl.DetachShader(shaderProgram, fragmentShader);
        gl.DeleteShader(vertexShader);
        gl.DeleteShader(fragmentShader);
        return shaderProgram;
    }

    private const string FxaaVertexShaderSource = """
#version 120
attribute vec2 aPosition;
varying vec2 vTexCoord;

void main()
{
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vTexCoord = aPosition * 0.5 + 0.5;
}
""";

    private const string FxaaFragmentShaderSource = """
#version 120
varying vec2 vTexCoord;
uniform sampler2D uTexture;
uniform vec2 uTexelSize;

// Simple FXAA implementation
void main()
{
    float FXAA_SPAN_MAX = 8.0;
    float FXAA_REDUCE_MUL = 1.0 / 8.0;
    float FXAA_REDUCE_MIN = 1.0 / 128.0;

    vec3 rgbNW = texture2D(uTexture, vTexCoord + (vec2(-1.0, -1.0) * uTexelSize)).xyz;
    vec3 rgbNE = texture2D(uTexture, vTexCoord + (vec2(1.0, -1.0) * uTexelSize)).xyz;
    vec3 rgbSW = texture2D(uTexture, vTexCoord + (vec2(-1.0, 1.0) * uTexelSize)).xyz;
    vec3 rgbSE = texture2D(uTexture, vTexCoord + (vec2(1.0, 1.0) * uTexelSize)).xyz;
    vec3 rgbM  = texture2D(uTexture, vTexCoord).xyz;

    vec3 luma = vec3(0.299, 0.587, 0.114);
    float lumaNW = dot(rgbNW, luma);
    float lumaNE = dot(rgbNE, luma);
    float lumaSW = dot(rgbSW, luma);
    float lumaSE = dot(rgbSE, luma);
    float lumaM  = dot(rgbM,  luma);

    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

    float dirReduce = max(
        (lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL),
        FXAA_REDUCE_MIN
    );

    float rcpDirMin = 1.0 / (min(abs(dir.x), dir.y) + dirReduce);

    dir = min(vec2(FXAA_SPAN_MAX,  FXAA_SPAN_MAX),
          max(vec2(-FXAA_SPAN_MAX, -FXAA_SPAN_MAX),
          dir * rcpDirMin)) * uTexelSize;

    vec3 rgbA = (1.0 / 2.0) * (
        texture2D(uTexture, vTexCoord.xy + dir * (1.0 / 3.0 - 0.5)).xyz +
        texture2D(uTexture, vTexCoord.xy + dir * (2.0 / 3.0 - 0.5)).xyz
    );
    vec3 rgbB = rgbA * (1.0 / 2.0) + (1.0 / 4.0) * (
        texture2D(uTexture, vTexCoord.xy + dir * (0.0 / 3.0 - 0.5)).xyz +
        texture2D(uTexture, vTexCoord.xy + dir * (3.0 / 3.0 - 0.5)).xyz
    );
    float lumaB = dot(rgbB, luma);

    if ((lumaB < lumaMin) || (lumaB > lumaMax)) {
        gl_FragColor = vec4(rgbA, 1.0);
    } else {
        gl_FragColor = vec4(rgbB, 1.0);
    }
}
""";

    private sealed record TransparentMeshBatch(Vector3 Center, uint[] Indices);

}

public sealed class IfcProductPickedEventArgs(int productId) : EventArgs
{
    public int ProductId { get; } = productId;
}

public sealed class IfcProductTransformCommittedEventArgs(int productId, Vector3 moveDeltaWorld, float rotateZRadians) : EventArgs
{
    public int ProductId { get; } = productId;

    public Vector3 MoveDeltaWorld { get; } = moveDeltaWorld;

    public float RotateZRadians { get; } = rotateZRadians;
}

public sealed class ViewportFpsUpdatedEventArgs(string text) : EventArgs
{
    public string Text { get; } = text;
}
