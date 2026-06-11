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

    public static readonly StyledProperty<bool> IsPointPickingActiveProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, bool>(nameof(IsPointPickingActive), false, defaultBindingMode: Avalonia.Data.BindingMode.TwoWay);

    /// <summary>
    /// One-shot coordinate picking: while true, the next left click raycasts the
    /// scene (ground plane fallback) and raises <see cref="PointPicked"/> with
    /// world coordinates instead of selecting a product.
    /// </summary>
    public bool IsPointPickingActive
    {
        get => GetValue(IsPointPickingActiveProperty);
        set => SetValue(IsPointPickingActiveProperty, value);
    }

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

    public static readonly DirectProperty<ViewportPreviewControl, double> CameraYawDegreesProperty =
        AvaloniaProperty.RegisterDirect<ViewportPreviewControl, double>(nameof(CameraYawDegrees), control => control.cameraYawDegrees);

    public static readonly DirectProperty<ViewportPreviewControl, double> CameraPitchDegreesProperty =
        AvaloniaProperty.RegisterDirect<ViewportPreviewControl, double>(nameof(CameraPitchDegrees), control => control.cameraPitchDegrees);

    private double cameraYawDegrees = -51.633;
    private double cameraPitchDegrees = 25.2;

    public double CameraYawDegrees => cameraYawDegrees;

    public double CameraPitchDegrees => cameraPitchDegrees;

    // Compact interleaved layout, 6 uints (24 bytes) per vertex:
    // position float3 | normal sbyte4 normalized | color rgba8 | product id float bits.
    private const int VertexStride = 6;
    private const int InfiniteGridTargetLineCount = 160;
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
    private uint[] vertices = [];
    private uint[] opaqueIndices = [];
    private uint[] transparentIndices = [];
    private uint[] lineVertices = [];
    private IfcPreviewVertex renderOrigin = new(0, 0, 0);
    private InfiniteGridSignature? currentGridSignature;
    private List<TransparentMeshBatch> transparentMeshBatches = [];
    private MeshDrawRange[] opaqueDrawRanges = [];
    private readonly List<(int Offset, int Count)> opaqueSpans = [];
    private readonly List<TransparentMeshBatch> visibleTransparentScratch = [];
    private readonly List<TransparentMeshBatch> uploadedTransparentBatches = [];
    private Vector3 lastTransparentSortCamera;
    private bool transparentOrderDirty = true;
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
    private int totalMeshCount;
    private int totalTriangleCount;
    private bool hadRenderableScene;

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

    // Fullscreen gradient sky: gives the viewport a horizon so far-out zooms
    // read as "empty world" instead of a broken flat color.
    private uint backgroundProgram;

    // GPU picking FBO: product ids are rendered as colors and read back under
    // the cursor, replacing the O(triangles) CPU raycast on every click.
    private uint pickFbo;
    private uint pickColorRb;
    private uint pickDepthRb;
    private uint pickProgram;
    private int lastPickWidth;
    private int lastPickHeight;

    public event EventHandler<IfcProductPickedEventArgs>? ProductPicked;

    public event EventHandler<IfcProductTransformCommittedEventArgs>? ProductTransformCommitted;

    public event EventHandler<ViewportFpsUpdatedEventArgs>? FpsUpdated;

    public event EventHandler<ViewportPointPickedEventArgs>? PointPicked;

    public ViewportPreviewControl()
    {
        Focusable = true;
    }

    static ViewportPreviewControl()
    {
        AffectsRender<ViewportPreviewControl>(SceneProperty, SelectedProductIdProperty, InteractionModeProperty, CanTransformSelectionProperty, ShowFpsCounterProperty, AntiAliasingProperty, HideSpacesProperty, FieldOfViewProperty, NearPlaneProperty, FarPlaneProperty);
        IsPointPickingActiveProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnPointPickingChanged());
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
        RebaseRenderOrigin(camera.Target);
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

    /// <summary>
    /// Orients the camera; a null yaw keeps the current heading (used by the
    /// navigation cube's top/bottom faces).
    /// </summary>
    public void SetViewOrientation(double? yawDegrees, double pitchDegrees)
    {
        SetCameraAngles(yawDegrees ?? camera.YawDegrees, pitchDegrees);
    }

    /// <summary>Orbits the camera by screen-pixel deltas (navigation cube drag).</summary>
    public void OrbitCamera(double deltaX, double deltaY)
    {
        camera = NativeViewportCameraController.Orbit(camera, deltaX, deltaY);
        QueueRender();
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
            var isGles = GlVersion.Type == GlProfileType.OpenGLES;
            LogViewport($"init context={gl.ContextInfo} profile={GlVersion.Type} {GlVersion.Major}.{GlVersion.Minor}");
            LogViewport($"gl version={ReadGlString(glApi, StringName.Version)} renderer={ReadGlString(glApi, StringName.Renderer)} shading={ReadGlString(glApi, StringName.ShadingLanguageVersion)}");
            program = CreateProgramWithFallback(
                glApi,
                isGles,
                "scene",
                SceneVertexShaderSource330,
                SceneFragmentShaderSource330,
                SceneVertexShaderSource120,
                SceneFragmentShaderSource120,
                "aPosition",
                "aNormal",
                "aColor",
                "aProductId");
            vertexArray = glApi.GenVertexArray();
            vertexBuffer = glApi.GenBuffer();
            indexBuffer = glApi.GenBuffer();
            transparentIndexBuffer = glApi.GenBuffer();
            lineVertexArray = glApi.GenVertexArray();
            lineVertexBuffer = glApi.GenBuffer();
            gizmoVertexArray = glApi.GenVertexArray();
            gizmoVertexBuffer = glApi.GenBuffer();

            fxaaProgram = CreateProgramWithFallback(
                glApi,
                isGles,
                "fxaa",
                FxaaVertexShaderSource330,
                FxaaFragmentShaderSource330,
                FxaaVertexShaderSource120,
                FxaaFragmentShaderSource120,
                "aPosition");

            try
            {
                backgroundProgram = CreateProgramWithFallback(
                    glApi,
                    isGles,
                    "background",
                    BackgroundVertexShaderSource330,
                    BackgroundFragmentShaderSource330,
                    BackgroundVertexShaderSource120,
                    BackgroundFragmentShaderSource120,
                    "aPosition");
            }
            catch (Exception exception)
            {
                LogViewport($"background shader unavailable, keeping flat clear color: {exception.Message}");
                backgroundProgram = 0;
            }

            try
            {
                pickProgram = CreateProgramWithFallback(
                    glApi,
                    isGles,
                    "pick",
                    PickVertexShaderSource330,
                    PickFragmentShaderSource330,
                    PickVertexShaderSource120,
                    PickFragmentShaderSource120,
                    "aPosition",
                    "aNormal",
                    "aColor",
                    "aProductId");
            }
            catch (Exception exception)
            {
                LogViewport($"pick shader unavailable, falling back to CPU picking: {exception.Message}");
                pickProgram = 0;
            }
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
            currentGridSignature = null;
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
            if (pickFbo != 0)
            {
                glApi.DeleteFramebuffer(pickFbo);
                pickFbo = 0;
            }
            if (pickColorRb != 0)
            {
                glApi.DeleteRenderbuffer(pickColorRb);
                pickColorRb = 0;
            }
            if (pickDepthRb != 0)
            {
                glApi.DeleteRenderbuffer(pickDepthRb);
                pickDepthRb = 0;
            }
            if (pickProgram != 0)
            {
                glApi.DeleteProgram(pickProgram);
                pickProgram = 0;
            }
            if (backgroundProgram != 0)
            {
                glApi.DeleteProgram(backgroundProgram);
                backgroundProgram = 0;
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

        // The Avalonia swapchain framebuffer is sized in physical pixels
        // (Bounds * RenderScaling); the GL viewport must match or the image
        // renders into a smaller corner of the control on scaled displays.
        var renderScaling = VisualRoot?.RenderScaling ?? 1.0;
        var width = Math.Max(1, (int)(Bounds.Width * renderScaling));
        var height = Math.Max(1, (int)(Bounds.Height * renderScaling));

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

        // Gradient sky: drawn as a fullscreen quad before anything else; the
        // per-pixel view ray gives a horizon that rotates with the camera.
        if (backgroundProgram != 0 && quadVao != 0 && Matrix4x4.Invert(viewProjection, out var inverseViewProjection))
        {
            glApi.Disable(EnableCap.DepthTest);
            glApi.DepthMask(false);
            glApi.UseProgram(backgroundProgram);
            glApi.UniformMatrix4(glApi.GetUniformLocation(backgroundProgram, "uInverseViewProjection"), 1, false, &inverseViewProjection.M11);
            glApi.BindVertexArray(quadVao);
            glApi.DrawArrays(PrimitiveType.Triangles, 0, 6);
            glApi.BindVertexArray(0);
            glApi.DepthMask(true);
            glApi.Enable(EnableCap.DepthTest);
            drawCalls++;
        }

        var uniformMatrix = viewProjection;
        glApi.UseProgram(program);
        var matrix = &uniformMatrix.M11;
        glApi.UniformMatrix4(glApi.GetUniformLocation(program, "uMvp"), 1, false, matrix);

        glApi.Uniform1(glApi.GetUniformLocation(program, "uSelectedProductId"), SelectedProductId);
        glApi.Uniform1(glApi.GetUniformLocation(program, "uPreviewProductId"), previewProductId);
        var previewMatrix = previewTransform;
        glApi.UniformMatrix4(glApi.GetUniformLocation(program, "uPreviewTransform"), 1, false, &previewMatrix.M11);
        var cameraRenderPosition = ToRenderVector(camera.ToPose().Position, renderOrigin);
        glApi.Uniform3(glApi.GetUniformLocation(program, "uCameraPosition"), cameraRenderPosition.X, cameraRenderPosition.Y, cameraRenderPosition.Z);
        var unlitLocation = glApi.GetUniformLocation(program, "uUnlit");

        UpdateGridBuffer(glApi, width, height);
        if (lineVertexCount > 0)
        {
            glApi.Uniform1(unlitLocation, 1);
            glApi.Enable(EnableCap.Blend);
            glApi.BlendFunc(BlendingFactor.SrcAlpha, BlendingFactor.OneMinusSrcAlpha);
            glApi.DepthMask(false);
            glApi.BindVertexArray(lineVertexArray);
            glApi.LineWidth(1f);
            glApi.DrawArrays(PrimitiveType.Lines, 0, (uint)lineVertexCount);
            glApi.DepthMask(true);
            glApi.Disable(EnableCap.Blend);
            drawCalls++;
        }

        glApi.Uniform1(unlitLocation, 0);
        var frustum = new FrustumPlanes(viewProjection);
        BuildVisibleOpaqueSpans(frustum);
        if (opaqueSpans.Count > 0)
        {
            glApi.Disable(EnableCap.Blend);
            glApi.DepthMask(true);
            glApi.BindVertexArray(vertexArray);
            glApi.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
            foreach (var (offset, count) in opaqueSpans)
            {
                glApi.DrawElements(PrimitiveType.Triangles, (uint)count, DrawElementsType.UnsignedInt, (void*)((long)offset * sizeof(uint)));
            }

            drawCalls += opaqueSpans.Count;
        }

        if (transparentMeshBatches.Count > 0)
        {
            UpdateTransparentIndexBuffer(glApi, ToRenderVector(camera.ToPose().Position, renderOrigin), frustum);
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
            var pickWatch = Stopwatch.GetTimestamp();
            var pickedProductId = PickProductGpu(glApi, pickPoint, width, height, fb, viewProjection);
            var usedGpu = pickedProductId >= 0;
            if (!usedGpu)
            {
                pickedProductId = PickProduct(pickPoint);
            }

            LogViewport($"pick: product=#{pickedProductId} via {(usedGpu ? "gpu" : "cpu")} in {(Stopwatch.GetTimestamp() - pickWatch) * 1000d / Stopwatch.Frequency:0.0}ms");
            if (pickedProductId > 0)
            {
                suppressNextFraming = true;
                Dispatcher.UIThread.Post(() => ProductPicked?.Invoke(this, new IfcProductPickedEventArgs(pickedProductId)));
            }
        }

        PublishCameraOrientation();

        var cpuFrameMs = (Stopwatch.GetTimestamp() - renderStartTicks) * 1000d / Stopwatch.Frequency;
        UpdateFpsCounter(frameIntervalMs, cpuFrameMs, drawCalls, aaMode, isFxaa);
        if (ShowFpsCounter)
        {
            QueueRender();
        }
    }

    /// <summary>
    /// Mirrors the camera orientation into bindable properties (navigation
    /// cube). Render may run off the UI thread, so changes are posted.
    /// </summary>
    private void PublishCameraOrientation()
    {
        var yaw = camera.YawDegrees;
        var pitch = camera.PitchDegrees;
        if (Math.Abs(yaw - cameraYawDegrees) < 0.01 && Math.Abs(pitch - cameraPitchDegrees) < 0.01)
        {
            return;
        }

        Dispatcher.UIThread.Post(() =>
        {
            var previousYaw = cameraYawDegrees;
            var previousPitch = cameraPitchDegrees;
            cameraYawDegrees = yaw;
            cameraPitchDegrees = pitch;
            RaisePropertyChanged(CameraYawDegreesProperty, previousYaw, yaw);
            RaisePropertyChanged(CameraPitchDegreesProperty, previousPitch, pitch);
        });
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
            if (IsPointPickingActive)
            {
                if (TryPickWorldPoint(point, out var worldX, out var worldY, out var worldZ))
                {
                    SetCurrentValue(IsPointPickingActiveProperty, false);
                    var pickedArgs = new ViewportPointPickedEventArgs(worldX, worldY, worldZ);
                    Dispatcher.UIThread.Post(() => PointPicked?.Invoke(this, pickedArgs));
                }

                dragMode = DragMode.None;
                clickStart = null;
                e.Handled = true;
                return;
            }

            pendingPickPoint = point;
            QueueRender();
        }

        if (dragMode != DragMode.None)
        {
            MaybeRebaseNavigationOrigin();
            e.Handled = true;
        }
        dragMode = DragMode.None;
        clickStart = null;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        camera = NativeViewportCameraController.Zoom(camera, (int)(e.Delta.Y * 120));
        MaybeRebaseNavigationOrigin();
        QueueRender();
        e.Handled = true;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        switch (e.Key)
        {
            case Key.Escape when IsPointPickingActive:
                SetCurrentValue(IsPointPickingActiveProperty, false);
                e.Handled = true;
                break;
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
        var scene = Scene;
        var sceneIsRenderable = scene is not null && !scene.IsEmpty;
        if (hadRenderableScene && sceneIsRenderable && IsCameraCompatibleWithScene(scene!))
        {
            // Incremental update of the same model (e.g. a committed move/rotate):
            // keep the camera and render origin instead of re-framing.
            camera = camera with { SceneRadius = Math.Max(0.1, scene!.Bounds.Radius) };
            QueueRender();
            return;
        }

        hadRenderableScene = sceneIsRenderable;
        renderOrigin = GetDefaultRenderOrigin(scene);
        if (SelectedProductId > 0 && TryFrameProduct(SelectedProductId))
        {
            return;
        }

        FitCamera();
    }

    private bool IsCameraCompatibleWithScene(IfcRenderScene scene)
    {
        var bounds = scene.Bounds;
        if (bounds.IsEmpty || !IsFinite(camera.Target) || !IsFinite(camera.Distance))
        {
            return false;
        }

        var radius = Math.Max(1d, bounds.Radius);
        var center = bounds.Center;
        var dx = camera.Target.X - center.X;
        var dy = camera.Target.Y - center.Y;
        var dz = camera.Target.Z - center.Z;
        var targetOffset = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        return targetOffset <= radius * 4d
            && camera.Distance <= radius * 64d
            && camera.Distance >= radius * 0.00005d;
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

    private void OnPointPickingChanged()
    {
        Cursor = IsPointPickingActive
            ? new Cursor(StandardCursorType.Cross)
            : Cursor.Default;
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
        RebaseRenderOrigin(camera.Target);
        QueueRender();
    }

    private bool TryFrameProduct(int productId)
    {
        if (!TryGetSelectedProductBounds(productId, out var bounds))
        {
            return false;
        }

        camera = NativeViewportCameraController.FitBounds(bounds, camera.YawDegrees, camera.PitchDegrees);
        RebaseRenderOrigin(camera.Target);
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

            bounds = bounds.Include(mesh.Bounds);
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
        fixed (uint* pointer = gizmoVertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(gizmoVertices.Length * sizeof(uint)), pointer, BufferUsageARB.DynamicDraw);
        }

        ConfigureAttributes(gl);
        gl.Uniform1(gl.GetUniformLocation(program, "uUnlit"), 1);
        gl.Disable(EnableCap.DepthTest);
        gl.Enable(EnableCap.Blend);
        gl.BlendFunc(BlendingFactor.SrcAlpha, BlendingFactor.OneMinusSrcAlpha);
        gl.DepthMask(false);
        gl.DrawArrays(PrimitiveType.Triangles, 0, (uint)(gizmoVertices.Length / VertexStride));
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

        // Anchor both gizmos at the object's bounds center: placement origins can
        // sit arbitrarily far from the geometry (identity placements with absolute
        // coordinates are common), which would put the gizmo out of view. The
        // rotate commit compensates so the STEP edit still matches this pivot.
        var pivot = bounds.Center;
        center = ToRenderVector(pivot, renderOrigin) + previewMoveDeltaWorld;

        // Constant screen-space size: the gizmo always spans ~GizmoScreenPixels
        // on screen, independent of object size, scene radius or zoom level.
        const double GizmoScreenPixels = 92d;
        var cameraPosition = ToRenderVector(camera.ToPose().Position, renderOrigin);
        var distance = Vector3.Distance(cameraPosition, center);
        if (!float.IsFinite(distance) || distance < 0.0001f)
        {
            distance = (float)Math.Max(0.25d, camera.Distance);
        }

        var fovRadians = Math.Clamp(camera.FieldOfViewDegrees, 5d, 140d) * Math.PI / 180d;
        var viewportHeight = Math.Max(64d, Bounds.Height);
        size = (float)(distance * Math.Tan(fovRadians / 2d) * 2d * (GizmoScreenPixels / viewportHeight));
        return float.IsFinite(size) && size > 0;
    }

    private bool TryGetProductPlacementOrigin(int productId, out IfcPreviewVertex origin)
    {
        origin = new IfcPreviewVertex(0, 0, 0);
        var placements = Scene?.ProductPlacements;
        if (placements is null || !placements.TryGetValue(productId, out var value) || !IsFinite(value))
        {
            return false;
        }

        origin = value;
        return true;
    }

    private List<uint> BuildGizmoVertices(Vector3 center, float size)
    {
        var values = new List<uint>();
        var active = gizmoDrag?.Handle ?? GizmoHandle.None;

        if (InteractionMode == ViewportInteractionMode.Move)
        {
            AddMoveHandle(values, center, Vector3.UnitX, size, active == GizmoHandle.MoveX, new IfcRenderColor(0.93f, 0.26f, 0.21f, 0.96f));
            AddMoveHandle(values, center, Vector3.UnitY, size, active == GizmoHandle.MoveY, new IfcRenderColor(0.33f, 0.78f, 0.36f, 0.96f));
            AddMoveHandle(values, center, Vector3.UnitZ, size, active == GizmoHandle.MoveZ, new IfcRenderColor(0.27f, 0.52f, 0.96f, 0.96f));
            AddSphere(values, center, size * 0.045f, new IfcRenderColor(0.92f, 0.93f, 0.90f, 0.95f));
        }
        else if (InteractionMode == ViewportInteractionMode.Rotate)
        {
            var isActive = active == GizmoHandle.RotateZ;
            var color = isActive
                ? new IfcRenderColor(1.00f, 0.82f, 0.20f, 0.98f)
                : new IfcRenderColor(0.30f, 0.66f, 0.95f, 0.92f);
            var ringRadius = size * 0.85f;
            var halfWidth = size * (isActive ? 0.035f : 0.025f);
            AddAnnulus(values, center, ringRadius - halfWidth, ringRadius + halfWidth, color);
            // Thin vertical wall keeps the ring visible when viewed edge-on.
            AddRingBand(values, center, ringRadius, size * 0.012f, color);
            AddSphere(values, center, size * 0.04f, new IfcRenderColor(0.92f, 0.93f, 0.90f, 0.95f));
        }

        return values;
    }

    private static void AddMoveHandle(List<uint> values, Vector3 center, Vector3 axis, float size, bool active, IfcRenderColor baseColor)
    {
        var color = active
            ? new IfcRenderColor(1f, 0.84f, 0.20f, 1f)
            : baseColor;
        var shaftEnd = center + axis * (size * 0.78f);
        var tip = center + axis * size;
        AddCylinder(values, center, shaftEnd, size * 0.014f, color);
        AddCone(values, shaftEnd, tip, size * 0.055f, color);
    }

    private static (Vector3 U, Vector3 V) PerpendicularBasis(Vector3 axis)
    {
        var reference = Math.Abs(Vector3.Dot(axis, Vector3.UnitZ)) > 0.9f ? Vector3.UnitX : Vector3.UnitZ;
        var u = Vector3.Normalize(Vector3.Cross(axis, reference));
        var v = Vector3.Normalize(Vector3.Cross(axis, u));
        return (u, v);
    }

    private static void AddCylinder(List<uint> values, Vector3 start, Vector3 end, float radius, IfcRenderColor color)
    {
        const int segments = 10;
        var axis = Vector3.Normalize(end - start);
        var (u, v) = PerpendicularBasis(axis);
        for (var i = 0; i < segments; i++)
        {
            var angleA = i * MathF.Tau / segments;
            var angleB = (i + 1) * MathF.Tau / segments;
            var offsetA = (u * MathF.Cos(angleA) + v * MathF.Sin(angleA)) * radius;
            var offsetB = (u * MathF.Cos(angleB) + v * MathF.Sin(angleB)) * radius;
            AddTriangle(values, start + offsetA, end + offsetA, end + offsetB, color);
            AddTriangle(values, start + offsetA, end + offsetB, start + offsetB, color);
        }
    }

    private static void AddCone(List<uint> values, Vector3 baseCenter, Vector3 tip, float radius, IfcRenderColor color)
    {
        const int segments = 14;
        var axis = Vector3.Normalize(tip - baseCenter);
        var (u, v) = PerpendicularBasis(axis);
        for (var i = 0; i < segments; i++)
        {
            var angleA = i * MathF.Tau / segments;
            var angleB = (i + 1) * MathF.Tau / segments;
            var offsetA = (u * MathF.Cos(angleA) + v * MathF.Sin(angleA)) * radius;
            var offsetB = (u * MathF.Cos(angleB) + v * MathF.Sin(angleB)) * radius;
            AddTriangle(values, baseCenter + offsetA, tip, baseCenter + offsetB, color);
            AddTriangle(values, baseCenter + offsetA, baseCenter + offsetB, baseCenter, color);
        }
    }

    private static void AddAnnulus(List<uint> values, Vector3 center, float innerRadius, float outerRadius, IfcRenderColor color)
    {
        const int segments = 72;
        for (var i = 0; i < segments; i++)
        {
            var angleA = i * MathF.Tau / segments;
            var angleB = (i + 1) * MathF.Tau / segments;
            var dirA = new Vector3(MathF.Cos(angleA), MathF.Sin(angleA), 0);
            var dirB = new Vector3(MathF.Cos(angleB), MathF.Sin(angleB), 0);
            var innerA = center + dirA * innerRadius;
            var innerB = center + dirB * innerRadius;
            var outerA = center + dirA * outerRadius;
            var outerB = center + dirB * outerRadius;
            AddTriangle(values, innerA, outerA, outerB, color);
            AddTriangle(values, innerA, outerB, innerB, color);
        }
    }

    private static void AddRingBand(List<uint> values, Vector3 center, float radius, float halfHeight, IfcRenderColor color)
    {
        const int segments = 72;
        var up = new Vector3(0, 0, halfHeight);
        for (var i = 0; i < segments; i++)
        {
            var angleA = i * MathF.Tau / segments;
            var angleB = (i + 1) * MathF.Tau / segments;
            var rimA = center + new Vector3(MathF.Cos(angleA), MathF.Sin(angleA), 0) * radius;
            var rimB = center + new Vector3(MathF.Cos(angleB), MathF.Sin(angleB), 0) * radius;
            AddTriangle(values, rimA - up, rimA + up, rimB + up, color);
            AddTriangle(values, rimA - up, rimB + up, rimB - up, color);
        }
    }

    private static void AddSphere(List<uint> values, Vector3 center, float radius, IfcRenderColor color)
    {
        // Low-poly octahedron-based ball; small enough on screen that 8 faces read as round.
        const int segments = 12;
        for (var i = 0; i < segments; i++)
        {
            var angleA = i * MathF.Tau / segments;
            var angleB = (i + 1) * MathF.Tau / segments;
            var a = center + new Vector3(MathF.Cos(angleA), MathF.Sin(angleA), 0) * radius;
            var b = center + new Vector3(MathF.Cos(angleB), MathF.Sin(angleB), 0) * radius;
            AddTriangle(values, a, b, center + new Vector3(0, 0, radius), color);
            AddTriangle(values, b, a, center - new Vector3(0, 0, radius), color);
        }
    }

    private static void AddTriangle(List<uint> values, Vector3 a, Vector3 b, Vector3 c, IfcRenderColor color)
    {
        AddGizmoVertex(values, a, color);
        AddGizmoVertex(values, b, color);
        AddGizmoVertex(values, c, color);
    }

    private static void AddGizmoVertex(List<uint> values, Vector3 position, IfcRenderColor color)
    {
        // Normal points along the scene light so the gizmo renders at full
        // brightness regardless of orientation.
        values.Add(BitConverter.SingleToUInt32Bits(position.X));
        values.Add(BitConverter.SingleToUInt32Bits(position.Y));
        values.Add(BitConverter.SingleToUInt32Bits(position.Z));
        values.Add(PackNormal(0.35f, 0.55f, 0.75f));
        values.Add(PackColor(color));
        values.Add(BitConverter.SingleToUInt32Bits(0f));
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

            // The STEP edit rotates the product about its placement origin o, but
            // the gizmo pivots at the bounds center C. Adding the translation
            // (R - I)(o - C) makes both transforms identical: R(x - C) + C.
            if (Math.Abs(rotateZ) > 0.0000001f && TryGetProductPlacementOrigin(productId, out var placementOrigin))
            {
                var originRender = ToRenderVector(placementOrigin, renderOrigin);
                var cos = MathF.Cos(rotateZ);
                var sin = MathF.Sin(rotateZ);
                var relativeX = originRender.X - state.Center.X;
                var relativeY = originRender.Y - state.Center.Y;
                moveDelta += new Vector3(
                    cos * relativeX - sin * relativeY - relativeX,
                    sin * relativeX + cos * relativeY - relativeY,
                    0f);
            }
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
            $"meshes {visibleMeshCount:N0}/{totalMeshCount:N0}  tris {visibleTriangleCount:N0}/{totalTriangleCount:N0}",
            $"verts {visibleVertexCount:N0}  inst {instanceCount:N0}",
            $"loop continuous  AA {aaLabel}");
    }

    private void BuildBuffers()
    {
        var scene = Scene;
        if (scene is null || scene.IsEmpty)
        {
            renderOrigin = new IfcPreviewVertex(0, 0, 0);
            vertices = [];
            opaqueIndices = [];
            transparentIndices = [];
            lineVertices = [];
            transparentMeshBatches = [];
            opaqueDrawRanges = [];
            uploadedTransparentBatches.Clear();
            transparentOrderDirty = true;
            opaqueIndexCount = 0;
            transparentIndexCount = 0;
            lineVertexCount = 0;
            visibleMeshCount = 0;
            visibleTriangleCount = 0;
            visibleVertexCount = 0;
            totalMeshCount = 0;
            totalTriangleCount = 0;
            return;
        }

        var hideSpaces = HideSpaces;

        // First pass: exact totals so the interleaved buffers are allocated once
        // (a growing list peaks at ~3x the final size on large models).
        var totalVertexCount = 0;
        var totalOpaqueIndexCount = 0;
        var opaqueMeshCount = 0;
        foreach (var mesh in scene.Meshes)
        {
            if (!mesh.IsRenderable || (hideSpaces && mesh.IsSpace))
            {
                continue;
            }

            totalVertexCount += mesh.VertexCount;
            if (!IsTransparent(mesh))
            {
                totalOpaqueIndexCount += mesh.Indices.Length;
                opaqueMeshCount++;
            }
        }

        var vertexValues = new uint[totalVertexCount * VertexStride];
        var opaqueIndexValues = new uint[totalOpaqueIndexCount];
        var drawRanges = new MeshDrawRange[opaqueMeshCount];
        var batches = new List<TransparentMeshBatch>();
        var vertexCursor = 0;
        var opaqueCursor = 0;
        var rangeCursor = 0;
        var baseVertex = 0u;
        var meshCount = 0;
        var triangleCount = 0;
        foreach (var mesh in scene.Meshes)
        {
            if (!mesh.IsRenderable || (hideSpaces && mesh.IsSpace))
            {
                continue;
            }

            meshCount++;
            var meshVertexCount = mesh.VertexCount;
            var packedColor = PackColor(mesh.Color);
            var productIdBits = BitConverter.SingleToUInt32Bits(mesh.ProductId);
            for (var i = 0; i < meshVertexCount; i++)
            {
                var offset = i * 3;
                vertexValues[vertexCursor++] = BitConverter.SingleToUInt32Bits(ToRenderFloat(mesh.Positions[offset] - renderOrigin.X));
                vertexValues[vertexCursor++] = BitConverter.SingleToUInt32Bits(ToRenderFloat(mesh.Positions[offset + 1] - renderOrigin.Y));
                vertexValues[vertexCursor++] = BitConverter.SingleToUInt32Bits(ToRenderFloat(mesh.Positions[offset + 2] - renderOrigin.Z));
                vertexValues[vertexCursor++] = PackNormal(mesh.Normals[offset], mesh.Normals[offset + 1], mesh.Normals[offset + 2]);
                vertexValues[vertexCursor++] = packedColor;
                vertexValues[vertexCursor++] = productIdBits;
            }

            GetRenderBounds(mesh.Bounds, renderOrigin, out var boundsMin, out var boundsMax);
            if (IsTransparent(mesh))
            {
                var meshIndices = new uint[mesh.Indices.Length];
                var meshCursor = 0;
                foreach (var index in mesh.Indices)
                {
                    if (index >= 0 && index < meshVertexCount)
                    {
                        meshIndices[meshCursor++] = baseVertex + (uint)index;
                    }
                }

                if (meshCursor > 0)
                {
                    if (meshCursor < meshIndices.Length)
                    {
                        Array.Resize(ref meshIndices, meshCursor);
                    }

                    triangleCount += meshCursor / 3;
                    batches.Add(new TransparentMeshBatch(mesh.ProductId, MeshCenter(mesh, renderOrigin), boundsMin, boundsMax, meshVertexCount, meshIndices));
                }
            }
            else
            {
                var rangeStart = opaqueCursor;
                foreach (var index in mesh.Indices)
                {
                    if (index >= 0 && index < meshVertexCount)
                    {
                        opaqueIndexValues[opaqueCursor++] = baseVertex + (uint)index;
                    }
                }

                drawRanges[rangeCursor++] = new MeshDrawRange(mesh.ProductId, rangeStart, opaqueCursor - rangeStart, meshVertexCount, boundsMin, boundsMax);
                triangleCount += mesh.Indices.Length / 3;
            }

            baseVertex += (uint)meshVertexCount;
        }

        if (opaqueCursor < opaqueIndexValues.Length)
        {
            Array.Resize(ref opaqueIndexValues, opaqueCursor);
        }

        vertices = vertexValues;
        opaqueIndices = opaqueIndexValues;
        transparentMeshBatches = batches;
        opaqueDrawRanges = drawRanges;
        uploadedTransparentBatches.Clear();
        transparentOrderDirty = true;
        transparentIndices = [];
        opaqueIndexCount = opaqueIndices.Length;
        transparentIndexCount = 0;
        lineVertices = [];
        lineVertexCount = 0;
        visibleMeshCount = meshCount;
        visibleTriangleCount = triangleCount;
        visibleVertexCount = totalVertexCount;
        totalMeshCount = meshCount;
        totalTriangleCount = triangleCount;
    }

    /// <summary>
    /// Walks the per-mesh draw ranges, frustum-culls against their bounds and
    /// merges adjacent visible ranges into contiguous index-buffer spans (a
    /// fully visible scene collapses back into a single draw call).
    /// </summary>
    private void BuildVisibleOpaqueSpans(in FrustumPlanes frustum)
    {
        opaqueSpans.Clear();
        visibleMeshCount = 0;
        visibleTriangleCount = 0;
        visibleVertexCount = 0;
        var spanStart = -1;
        var spanEnd = 0;
        foreach (var range in opaqueDrawRanges)
        {
            // A previewed (gizmo-dragged) product is displaced in the vertex
            // shader, so its stored bounds are stale: never cull it.
            if (range.ProductId != previewProductId && !frustum.Intersects(range.BoundsMin, range.BoundsMax))
            {
                continue;
            }

            visibleMeshCount++;
            visibleTriangleCount += range.IndexCount / 3;
            visibleVertexCount += range.VertexCount;
            if (spanStart < 0)
            {
                spanStart = range.IndexOffset;
                spanEnd = range.IndexOffset + range.IndexCount;
            }
            else if (range.IndexOffset == spanEnd)
            {
                spanEnd += range.IndexCount;
            }
            else
            {
                opaqueSpans.Add((spanStart, spanEnd - spanStart));
                spanStart = range.IndexOffset;
                spanEnd = range.IndexOffset + range.IndexCount;
            }
        }

        if (spanStart >= 0)
        {
            opaqueSpans.Add((spanStart, spanEnd - spanStart));
        }
    }

    private static void GetRenderBounds(IfcRenderBounds bounds, IfcPreviewVertex origin, out Vector3 min, out Vector3 max)
    {
        if (bounds.IsEmpty)
        {
            // Degenerate bounds: keep the mesh always visible instead of risking
            // a wrong cull.
            min = new Vector3(-1e30f);
            max = new Vector3(1e30f);
            return;
        }

        min = new Vector3(
            ToRenderFloat(bounds.MinX - origin.X),
            ToRenderFloat(bounds.MinY - origin.Y),
            ToRenderFloat(bounds.MinZ - origin.Z));
        max = new Vector3(
            ToRenderFloat(bounds.MaxX - origin.X),
            ToRenderFloat(bounds.MaxY - origin.Y),
            ToRenderFloat(bounds.MaxZ - origin.Z));
    }

    private unsafe void UploadBuffers(SilkGL gl)
    {
        BindArray(gl, vertexArray, vertexBuffer);
        fixed (uint* vertexPointer = vertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(vertices.Length * sizeof(uint)), vertexPointer, BufferUsageARB.StaticDraw);
        }

        gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
        fixed (uint* indexPointer = opaqueIndices)
        {
            gl.BufferData(BufferTargetARB.ElementArrayBuffer, (nuint)(opaqueIndices.Length * sizeof(uint)), indexPointer, BufferUsageARB.StaticDraw);
        }

        ConfigureAttributes(gl);

        BindArray(gl, lineVertexArray, lineVertexBuffer);
        fixed (uint* linePointer = lineVertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(lineVertices.Length * sizeof(uint)), linePointer, BufferUsageARB.StaticDraw);
        }

        ConfigureAttributes(gl);
        gl.BindVertexArray(0);
    }

    private unsafe void UpdateGridBuffer(SilkGL gl, int width, int height)
    {
        var signature = CreateInfiniteGridSignature(width, height);
        if (currentGridSignature == signature && lineVertexCount > 0)
        {
            return;
        }

        lineVertices = BuildInfiniteGridVertices(signature);
        lineVertexCount = lineVertices.Length / VertexStride;
        currentGridSignature = signature;

        BindArray(gl, lineVertexArray, lineVertexBuffer);
        fixed (uint* linePointer = lineVertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(lineVertices.Length * sizeof(uint)), linePointer, BufferUsageARB.DynamicDraw);
        }

        ConfigureAttributes(gl);
        gl.BindVertexArray(0);
    }

    /// <summary>
    /// Keeps the transparent index buffer sorted back-to-front and culled to the
    /// frustum. The sort is throttled to noticeable camera movement and the
    /// rebuild + GPU upload only happens when the sort ran or the visible set
    /// changed — a static camera costs nothing per frame.
    /// </summary>
    private unsafe void UpdateTransparentIndexBuffer(SilkGL gl, Vector3 cameraPosition, in FrustumPlanes frustum)
    {
        if (transparentMeshBatches.Count == 0)
        {
            transparentIndexCount = 0;
            return;
        }

        var sortThreshold = (float)Math.Max(camera.Distance * 0.01d, 0.001d);
        var needsSort = transparentOrderDirty
            || Vector3.DistanceSquared(cameraPosition, lastTransparentSortCamera) > sortThreshold * sortThreshold;
        if (needsSort)
        {
            transparentMeshBatches.Sort((left, right) =>
                Vector3.DistanceSquared(right.Center, cameraPosition)
                    .CompareTo(Vector3.DistanceSquared(left.Center, cameraPosition)));
            lastTransparentSortCamera = cameraPosition;
            transparentOrderDirty = false;
        }

        visibleTransparentScratch.Clear();
        foreach (var batch in transparentMeshBatches)
        {
            if (batch.ProductId == previewProductId || frustum.Intersects(batch.BoundsMin, batch.BoundsMax))
            {
                visibleTransparentScratch.Add(batch);
                visibleMeshCount++;
                visibleTriangleCount += batch.Indices.Length / 3;
                visibleVertexCount += batch.VertexCount;
            }
        }

        if (!needsSort && SameBatchList(visibleTransparentScratch, uploadedTransparentBatches))
        {
            return;
        }

        uploadedTransparentBatches.Clear();
        uploadedTransparentBatches.AddRange(visibleTransparentScratch);

        var totalIndexCount = 0;
        foreach (var batch in visibleTransparentScratch)
        {
            totalIndexCount += batch.Indices.Length;
        }

        transparentIndexCount = totalIndexCount;
        if (totalIndexCount == 0)
        {
            return;
        }

        if (transparentIndices.Length != totalIndexCount)
        {
            transparentIndices = new uint[totalIndexCount];
        }

        var offset = 0;
        foreach (var batch in visibleTransparentScratch)
        {
            Array.Copy(batch.Indices, 0, transparentIndices, offset, batch.Indices.Length);
            offset += batch.Indices.Length;
        }

        gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, transparentIndexBuffer);
        fixed (uint* indexPointer = transparentIndices)
        {
            gl.BufferData(BufferTargetARB.ElementArrayBuffer, (nuint)(transparentIndices.Length * sizeof(uint)), indexPointer, BufferUsageARB.DynamicDraw);
        }
    }

    private static bool SameBatchList(List<TransparentMeshBatch> left, List<TransparentMeshBatch> right)
    {
        if (left.Count != right.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Count; i++)
        {
            if (!ReferenceEquals(left[i], right[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static void BindArray(SilkGL gl, uint array, uint buffer)
    {
        gl.BindVertexArray(array);
        gl.BindBuffer(BufferTargetARB.ArrayBuffer, buffer);
    }

    private static unsafe void ConfigureAttributes(SilkGL gl)
    {
        // Normals/colors ride as normalized bytes (GL 2.0-compatible, unlike
        // INT_2_10_10_10) so the same layout works on the GLSL 120 fallback.
        const uint stride = VertexStride * sizeof(uint);
        gl.EnableVertexAttribArray(0);
        gl.VertexAttribPointer(0, 3, VertexAttribPointerType.Float, false, stride, null);
        gl.EnableVertexAttribArray(1);
        gl.VertexAttribPointer(1, 4, VertexAttribPointerType.Byte, true, stride, (void*)(3 * sizeof(uint)));
        gl.EnableVertexAttribArray(2);
        gl.VertexAttribPointer(2, 4, VertexAttribPointerType.UnsignedByte, true, stride, (void*)(4 * sizeof(uint)));
        gl.EnableVertexAttribArray(3);
        gl.VertexAttribPointer(3, 1, VertexAttribPointerType.Float, false, stride, (void*)(5 * sizeof(uint)));
    }

    /// <summary>Packs a unit normal into 4 signed normalized bytes (w unused).</summary>
    private static uint PackNormal(float x, float y, float z)
    {
        return SByteBits(x) | (SByteBits(y) << 8) | (SByteBits(z) << 16);
    }

    private static uint SByteBits(float value)
    {
        var scaled = (int)MathF.Round(Math.Clamp(value, -1f, 1f) * 127f);
        return (uint)(scaled & 0xFF);
    }

    private static uint PackColor(IfcRenderColor color)
    {
        return ByteBits(color.R) | (ByteBits(color.G) << 8) | (ByteBits(color.B) << 16) | (ByteBits(color.A) << 24);
    }

    private static uint ByteBits(float value)
    {
        return (uint)Math.Clamp((int)MathF.Round(value * 255f), 0, 255);
    }

    private static void AddLocalVertex(List<uint> values, float x, float y, float z, IfcRenderColor color, int productId)
    {
        values.Add(BitConverter.SingleToUInt32Bits(x));
        values.Add(BitConverter.SingleToUInt32Bits(y));
        values.Add(BitConverter.SingleToUInt32Bits(z));
        values.Add(PackNormal(0, 0, 1));
        values.Add(PackColor(color));
        values.Add(BitConverter.SingleToUInt32Bits(productId));
    }

    private static bool IsTransparent(IfcRenderMesh mesh)
    {
        return mesh.Color.A < 0.99f;
    }

    private static Vector3 MeshCenter(IfcRenderMesh mesh, IfcPreviewVertex origin)
    {
        return ToRenderVector(mesh.Bounds.Center, origin);
    }

    private InfiniteGridSignature CreateInfiniteGridSignature(int width, int height)
    {
        var bounds = Scene?.Bounds ?? IfcRenderBounds.Empty;
        var radius = Math.Max(1d, bounds.Radius);
        var z = bounds.IsEmpty ? 0d : bounds.MinZ - radius * 0.015d;
        var fovRadians = Math.Clamp(camera.FieldOfViewDegrees, 5d, 140d) * Math.PI / 180d;
        var visibleHeight = 2d * Math.Max(0.25d, camera.Distance) * Math.Tan(fovRadians / 2d);
        if (!IsFinite(visibleHeight) || visibleHeight <= 0)
        {
            visibleHeight = Math.Max(1d, camera.SceneRadius * 2d);
        }

        var aspect = Math.Max(0.1d, width / (double)Math.Max(1, height));
        var visibleSpan = Math.Max(visibleHeight, visibleHeight * aspect);
        var target = IsFinite(camera.Target) ? camera.Target : renderOrigin;
        var look = NormalizeVertex(camera.ToPose().LookDirection);
        var grazingFactor = Math.Clamp(1d / Math.Max(0.12d, Math.Abs(look.Z)), 1d, 10d);
        var footprintSpan = Math.Max(
            visibleSpan * 3d * grazingFactor,
            Math.Max(camera.Distance * 4d, camera.SceneRadius * 2d) * grazingFactor);
        if (!IsFinite(footprintSpan) || footprintSpan <= 0)
        {
            footprintSpan = visibleSpan * 8d;
        }

        // Never extend the grid past the far clipping plane: the edge fade must
        // dissolve it before the clip would cut a hard line across the ground
        // (the "chopped off" look when zooming far out).
        var farLimit = (camera.FarPlane - camera.Distance) * 1.8d;
        if (IsFinite(farLimit) && farLimit > 0)
        {
            footprintSpan = Math.Min(footprintSpan, farLimit);
        }

        var desiredStep = Math.Max(visibleSpan / 24d, footprintSpan / InfiniteGridTargetLineCount);
        var fineStep = NiceStepFloor(desiredStep);
        if (!IsFinite(fineStep) || fineStep <= 0)
        {
            fineStep = 1d;
        }

        var coarseStep = NextNiceStep(fineStep);
        var lodBlend = GridLodBlend(desiredStep, fineStep, coarseStep);
        var minX = Math.Floor((target.X - footprintSpan * 0.5d) / fineStep) * fineStep;
        var maxX = Math.Ceiling((target.X + footprintSpan * 0.5d) / fineStep) * fineStep;
        var minY = Math.Floor((target.Y - footprintSpan * 0.5d) / fineStep) * fineStep;
        var maxY = Math.Ceiling((target.Y + footprintSpan * 0.5d) / fineStep) * fineStep;
        return new InfiniteGridSignature(
            target.X,
            target.Y,
            minX,
            maxX,
            minY,
            maxY,
            fineStep,
            coarseStep,
            lodBlend,
            z,
            renderOrigin.X,
            renderOrigin.Y,
            renderOrigin.Z);
    }

    private static uint[] BuildInfiniteGridVertices(InfiniteGridSignature signature)
    {
        var estimatedLineCount = EstimateGridLineCount(signature.MinX, signature.MaxX, signature.FineStep)
            + EstimateGridLineCount(signature.MinY, signature.MaxY, signature.FineStep)
            + EstimateGridLineCount(signature.MinX, signature.MaxX, signature.CoarseStep)
            + EstimateGridLineCount(signature.MinY, signature.MaxY, signature.CoarseStep)
            + 2;
        var values = new List<uint>(estimatedLineCount * 2 * VertexStride);
        var origin = new IfcPreviewVertex(signature.OriginX, signature.OriginY, signature.OriginZ);
        var fineAlpha = 1d - SmoothStep(0d, 1d, signature.LodBlend);
        var coarseAlpha = SmoothStep(0d, 1d, signature.LodBlend);
        AddGridLevel(values, origin, signature, signature.FineStep, fineAlpha);
        AddGridLevel(values, origin, signature, signature.CoarseStep, coarseAlpha);

        return values.ToArray();
    }

    private static void AddGridLevel(
        List<uint> values,
        IfcPreviewVertex origin,
        InfiniteGridSignature signature,
        double step,
        double levelAlpha)
    {
        if (levelAlpha <= 0.001d || step <= 0 || !IsFinite(step))
        {
            return;
        }

        var minX = Math.Floor(signature.MinX / step) * step;
        var maxX = Math.Ceiling(signature.MaxX / step) * step;
        var minY = Math.Floor(signature.MinY / step) * step;
        var maxY = Math.Ceiling(signature.MaxY / step) * step;
        var grid = new IfcRenderColor(0.17f, 0.22f, 0.19f, 0.72f);
        var major = new IfcRenderColor(0.24f, 0.30f, 0.26f, 0.88f);
        var axisX = new IfcRenderColor(0.88f, 0.34f, 0.28f, 0.95f);
        var axisY = new IfcRenderColor(0.34f, 0.68f, 0.42f, 0.95f);
        var axisZ = new IfcRenderColor(0.32f, 0.54f, 0.86f, 0.95f);

        for (var x = minX; x <= maxX + step * 0.5d; x += step)
        {
            var edgeAlpha = EdgeFade(x, minX, maxX);
            AddWorldLine(
                values,
                x,
                minY,
                signature.Z,
                x,
                maxY,
                signature.Z,
                origin,
                WithAlpha(GridLineColor(x, step, axisY, major, grid), levelAlpha * edgeAlpha));
        }

        for (var y = minY; y <= maxY + step * 0.5d; y += step)
        {
            var edgeAlpha = EdgeFade(y, minY, maxY);
            AddWorldLine(
                values,
                minX,
                y,
                signature.Z,
                maxX,
                y,
                signature.Z,
                origin,
                WithAlpha(GridLineColor(y, step, axisX, major, grid), levelAlpha * edgeAlpha));
        }

        if (minX <= 0d && maxX >= 0d && minY <= 0d && maxY >= 0d)
        {
            var zExtent = Math.Max(maxX - minX, maxY - minY) * 0.25d;
            AddWorldLine(values, 0d, 0d, signature.Z, 0d, 0d, signature.Z + zExtent, origin, WithAlpha(axisZ, levelAlpha));
        }
    }

    private static IfcRenderColor GridLineColor(
        double coordinate,
        double step,
        IfcRenderColor axis,
        IfcRenderColor major,
        IfcRenderColor grid)
    {
        if (Math.Abs(coordinate) < step * 0.001d)
        {
            return axis;
        }

        var majorStep = step * 10d;
        if (majorStep > 0)
        {
            var ratio = coordinate / majorStep;
            if (Math.Abs(ratio - Math.Round(ratio)) < 0.001d)
            {
                return major;
            }
        }

        return grid;
    }

    private static IfcRenderColor WithAlpha(IfcRenderColor color, double alpha)
    {
        return color with { A = (float)Math.Clamp(color.A * alpha, 0d, 1d) };
    }

    private static double EdgeFade(double coordinate, double min, double max)
    {
        var span = max - min;
        if (span <= 0 || !IsFinite(span))
        {
            return 1d;
        }

        var distanceToEdge = Math.Min(coordinate - min, max - coordinate);
        var normalized = Math.Clamp(distanceToEdge / Math.Max(0.000001d, span * 0.16d), 0d, 1d);
        return SmoothStep(0d, 1d, normalized);
    }

    private static int EstimateGridLineCount(double min, double max, double step)
    {
        if (step <= 0 || !IsFinite(step) || !IsFinite(min) || !IsFinite(max) || max < min)
        {
            return 0;
        }

        return Math.Max(0, (int)Math.Ceiling((max - min) / step) + 1);
    }

    private static void AddWorldLine(
        List<uint> values,
        double x1,
        double y1,
        double z1,
        double x2,
        double y2,
        double z2,
        IfcPreviewVertex origin,
        IfcRenderColor color)
    {
        AddLocalLine(
            values,
            ToRenderFloat(x1 - origin.X),
            ToRenderFloat(y1 - origin.Y),
            ToRenderFloat(z1 - origin.Z),
            ToRenderFloat(x2 - origin.X),
            ToRenderFloat(y2 - origin.Y),
            ToRenderFloat(z2 - origin.Z),
            color);
    }

    private static void AddLocalLine(List<uint> values, float x1, float y1, float z1, float x2, float y2, float z2, IfcRenderColor color)
    {
        AddLocalVertex(values, x1, y1, z1, color, 0);
        AddLocalVertex(values, x2, y2, z2, color, 0);
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

    private static double NiceStepFloor(double value)
    {
        if (value <= 0 || double.IsNaN(value) || double.IsInfinity(value))
        {
            return 1;
        }

        var exponent = Math.Floor(Math.Log10(value));
        var magnitude = Math.Pow(10, exponent);
        var fraction = value / magnitude;
        var niceFraction = fraction switch
        {
            >= 2 => 2,
            _ => 1,
        };
        return niceFraction * magnitude;
    }

    private static double NextNiceStep(double step)
    {
        if (step <= 0 || double.IsNaN(step) || double.IsInfinity(step))
        {
            return 2;
        }

        var exponent = Math.Floor(Math.Log10(step));
        var magnitude = Math.Pow(10, exponent);
        var fraction = step / magnitude;
        var nextFraction = fraction switch
        {
            < 1.5 => 2,
            _ => 10,
        };
        return nextFraction == 10
            ? magnitude * 10
            : magnitude * nextFraction;
    }

    private static double GridLodBlend(double desiredStep, double fineStep, double coarseStep)
    {
        if (coarseStep <= fineStep || !IsFinite(desiredStep) || !IsFinite(fineStep) || !IsFinite(coarseStep))
        {
            return 0;
        }

        var blend = (Math.Log(desiredStep) - Math.Log(fineStep)) / (Math.Log(coarseStep) - Math.Log(fineStep));
        return Math.Clamp(blend, 0d, 1d);
    }

    private static double SmoothStep(double edge0, double edge1, double value)
    {
        if (edge1 <= edge0)
        {
            return value < edge0 ? 0d : 1d;
        }

        var t = Math.Clamp((value - edge0) / (edge1 - edge0), 0d, 1d);
        return t * t * (3d - 2d * t);
    }

    private Matrix4x4 CreateViewProjection(double width, double height)
    {
        var clipping = NativeViewportCameraController.FitClippingPlanes(
            camera,
            Scene?.Bounds ?? IfcRenderBounds.Empty,
            NearPlane,
            FarPlane);
        camera = camera with
        {
            FieldOfViewDegrees = FieldOfView,
            NearPlane = clipping.NearPlane,
            FarPlane = clipping.FarPlane
        };
        var pose = camera.ToPose();
        var position = ToRenderVector(pose.Position, renderOrigin);
        var target = ToRenderVector(camera.Target, renderOrigin);
        var up = ToDirectionVector(pose.UpDirection);
        var view = Matrix4x4.CreateLookAt(position, target, up);
        var aspect = Math.Max(0.1f, (float)(width / Math.Max(1d, height)));
        var projection = Matrix4x4.CreatePerspectiveFieldOfView(
            DegreesToRadians((float)pose.FieldOfViewDegrees),
            aspect,
            (float)pose.NearPlaneDistance,
            (float)pose.FarPlaneDistance);
        return view * projection;
    }

    /// <summary>
    /// Renders product ids into an offscreen color buffer and reads back the
    /// pixel under <paramref name="point"/>. Returns the picked product id,
    /// 0 for empty space, or -1 when the GPU path is unavailable (caller
    /// falls back to the CPU raycast).
    /// </summary>
    private unsafe int PickProductGpu(SilkGL gl, Point point, int width, int height, int fb, Matrix4x4 viewProjection)
    {
        if (pickProgram == 0 || (opaqueIndexCount == 0 && transparentIndexCount == 0 && transparentMeshBatches.Count == 0))
        {
            return pickProgram == 0 ? -1 : 0;
        }

        if (pickFbo == 0 || width != lastPickWidth || height != lastPickHeight)
        {
            if (pickFbo != 0)
            {
                gl.DeleteFramebuffer(pickFbo);
            }

            if (pickColorRb != 0)
            {
                gl.DeleteRenderbuffer(pickColorRb);
            }

            if (pickDepthRb != 0)
            {
                gl.DeleteRenderbuffer(pickDepthRb);
            }

            pickFbo = gl.GenFramebuffer();
            gl.BindFramebuffer(FramebufferTarget.Framebuffer, pickFbo);

            pickColorRb = gl.GenRenderbuffer();
            gl.BindRenderbuffer(RenderbufferTarget.Renderbuffer, pickColorRb);
            gl.RenderbufferStorage(RenderbufferTarget.Renderbuffer, InternalFormat.Rgba8, (uint)width, (uint)height);
            gl.FramebufferRenderbuffer(FramebufferTarget.Framebuffer, FramebufferAttachment.ColorAttachment0, RenderbufferTarget.Renderbuffer, pickColorRb);

            pickDepthRb = gl.GenRenderbuffer();
            gl.BindRenderbuffer(RenderbufferTarget.Renderbuffer, pickDepthRb);
            gl.RenderbufferStorage(RenderbufferTarget.Renderbuffer, InternalFormat.Depth24Stencil8, (uint)width, (uint)height);
            gl.FramebufferRenderbuffer(FramebufferTarget.Framebuffer, FramebufferAttachment.DepthAttachment, RenderbufferTarget.Renderbuffer, pickDepthRb);

            var status = gl.CheckFramebufferStatus(FramebufferTarget.Framebuffer);
            if ((FramebufferStatus)status != FramebufferStatus.Complete)
            {
                LogViewport($"pick FBO creation failed: {status}");
                gl.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)fb);
                gl.DeleteFramebuffer(pickFbo);
                gl.DeleteRenderbuffer(pickColorRb);
                gl.DeleteRenderbuffer(pickDepthRb);
                pickFbo = 0;
                pickColorRb = 0;
                pickDepthRb = 0;
                return -1;
            }

            lastPickWidth = width;
            lastPickHeight = height;
        }

        gl.BindFramebuffer(FramebufferTarget.Framebuffer, pickFbo);
        gl.Viewport(0, 0, (uint)width, (uint)height);
        gl.ClearColor(0f, 0f, 0f, 1f);
        gl.Clear(ClearBufferMask.ColorBufferBit | ClearBufferMask.DepthBufferBit);
        gl.Disable(EnableCap.Blend);
        gl.Enable(EnableCap.DepthTest);
        gl.DepthMask(true);

        gl.UseProgram(pickProgram);
        var uniformMatrix = viewProjection;
        gl.UniformMatrix4(gl.GetUniformLocation(pickProgram, "uMvp"), 1, false, &uniformMatrix.M11);
        gl.Uniform1(gl.GetUniformLocation(pickProgram, "uPreviewProductId"), previewProductId);
        var previewMatrix = previewTransform;
        gl.UniformMatrix4(gl.GetUniformLocation(pickProgram, "uPreviewTransform"), 1, false, &previewMatrix.M11);

        gl.BindVertexArray(vertexArray);
        if (opaqueSpans.Count > 0)
        {
            gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
            foreach (var (offset, count) in opaqueSpans)
            {
                gl.DrawElements(PrimitiveType.Triangles, (uint)count, DrawElementsType.UnsignedInt, (void*)((long)offset * sizeof(uint)));
            }
        }

        // Transparent surfaces stay pickable (nearest hit wins), matching the
        // CPU raycast semantics; they render opaquely into the id buffer.
        if (transparentIndexCount > 0)
        {
            gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, transparentIndexBuffer);
            gl.DrawElements(PrimitiveType.Triangles, (uint)transparentIndexCount, DrawElementsType.UnsignedInt, null);
        }

        gl.BindVertexArray(0);

        var scaling = VisualRoot?.RenderScaling ?? 1.0;
        var pixelX = Math.Clamp((int)(point.X * scaling), 0, width - 1);
        var pixelY = Math.Clamp(height - 1 - (int)(point.Y * scaling), 0, height - 1);
        var pixel = stackalloc byte[4];
        gl.ReadPixels(pixelX, pixelY, 1, 1, PixelFormat.Rgba, PixelType.UnsignedByte, pixel);
        gl.BindFramebuffer(FramebufferTarget.Framebuffer, (uint)fb);

        return IfcRenderPicking.DecodeProductId(pixel[0], pixel[1], pixel[2]);
    }

    /// <summary>
    /// CPU raycast for coordinate picking: nearest mesh triangle hit, falling
    /// back to the ground plane (scene bottom) so empty areas still yield a
    /// usable point. Returns world coordinates (render space + render origin).
    /// </summary>
    private bool TryPickWorldPoint(Point point, out double worldX, out double worldY, out double worldZ)
    {
        worldX = 0;
        worldY = 0;
        worldZ = 0;
        if (!TryCreateRay(point, out var rayOrigin, out var rayDirection))
        {
            return false;
        }

        var scene = Scene;
        var bestDistance = float.PositiveInfinity;
        if (scene is not null && !scene.IsEmpty)
        {
            var hideSpaces = HideSpaces;
            foreach (var mesh in scene.Meshes)
            {
                if (!mesh.IsRenderable || (hideSpaces && mesh.IsSpace))
                {
                    continue;
                }

                var vertexCount = mesh.VertexCount;
                for (var i = 0; i + 2 < mesh.Indices.Length; i += 3)
                {
                    var first = mesh.Indices[i];
                    var second = mesh.Indices[i + 1];
                    var third = mesh.Indices[i + 2];
                    if (first < 0 || second < 0 || third < 0
                        || first >= vertexCount || second >= vertexCount || third >= vertexCount)
                    {
                        continue;
                    }

                    if (IntersectTriangle(
                        rayOrigin,
                        rayDirection,
                        ToRenderVector(mesh.Positions, first, renderOrigin),
                        ToRenderVector(mesh.Positions, second, renderOrigin),
                        ToRenderVector(mesh.Positions, third, renderOrigin),
                        out var distance)
                        && distance < bestDistance)
                    {
                        bestDistance = distance;
                    }
                }
            }
        }

        Vector3 hit;
        if (float.IsFinite(bestDistance))
        {
            hit = rayOrigin + rayDirection * bestDistance;
        }
        else
        {
            // Ground plane at the scene bottom (the grid's height); rays parallel
            // to the plane or pointing away cannot pick.
            var bounds = scene?.Bounds ?? IfcRenderBounds.Empty;
            var planeZ = bounds.IsEmpty ? 0f : ToRenderFloat(bounds.MinZ - renderOrigin.Z);
            if (!TryIntersectPlane(rayOrigin, rayDirection, new Vector3(0, 0, planeZ), Vector3.UnitZ, out hit))
            {
                return false;
            }
        }

        worldX = hit.X + renderOrigin.X;
        worldY = hit.Y + renderOrigin.Y;
        worldZ = hit.Z + renderOrigin.Z;
        return true;
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

            var vertexCount = mesh.VertexCount;
            for (var i = 0; i + 2 < mesh.Indices.Length; i += 3)
            {
                var first = mesh.Indices[i];
                var second = mesh.Indices[i + 1];
                var third = mesh.Indices[i + 2];
                if (first < 0 || second < 0 || third < 0
                    || first >= vertexCount || second >= vertexCount || third >= vertexCount)
                {
                    continue;
                }

                if (IntersectTriangle(
                    near,
                    direction,
                    ToRenderVector(mesh.Positions, first, renderOrigin),
                    ToRenderVector(mesh.Positions, second, renderOrigin),
                    ToRenderVector(mesh.Positions, third, renderOrigin),
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

    private void RebaseRenderOrigin(IfcPreviewVertex origin)
    {
        var next = IsFinite(origin) ? origin : GetDefaultRenderOrigin(Scene);
        if (IsSameOrigin(renderOrigin, next))
        {
            return;
        }

        renderOrigin = next;
        buffersDirty = true;
    }

    private void MaybeRebaseNavigationOrigin()
    {
        var dx = camera.Target.X - renderOrigin.X;
        var dy = camera.Target.Y - renderOrigin.Y;
        var dz = camera.Target.Z - renderOrigin.Z;
        var offset = Math.Sqrt(dx * dx + dy * dy + dz * dz);
        if (!IsFinite(offset))
        {
            return;
        }

        // Rebase before single-precision render coordinates lose visible accuracy
        // (float ~7 significant digits versus the current view distance).
        if (offset > Math.Max(2_000d, camera.Distance * 512d))
        {
            RebaseRenderOrigin(camera.Target);
            QueueRender();
        }
    }

    private static IfcPreviewVertex GetDefaultRenderOrigin(IfcRenderScene? scene)
    {
        return scene is null || scene.Bounds.IsEmpty
            ? new IfcPreviewVertex(0, 0, 0)
            : scene.Bounds.Center;
    }

    private static Vector3 ToRenderVector(IfcPreviewVertex vertex, IfcPreviewVertex origin)
    {
        return new Vector3(
            ToRenderFloat(vertex.X - origin.X),
            ToRenderFloat(vertex.Y - origin.Y),
            ToRenderFloat(vertex.Z - origin.Z));
    }

    private static Vector3 ToRenderVector(double[] positions, int vertexIndex, IfcPreviewVertex origin)
    {
        var offset = vertexIndex * 3;
        return new Vector3(
            ToRenderFloat(positions[offset] - origin.X),
            ToRenderFloat(positions[offset + 1] - origin.Y),
            ToRenderFloat(positions[offset + 2] - origin.Z));
    }

    private static Vector3 ToDirectionVector(IfcPreviewVertex vertex)
    {
        return new Vector3(
            ToRenderFloat(vertex.X),
            ToRenderFloat(vertex.Y),
            ToRenderFloat(vertex.Z));
    }

    private static float ToRenderFloat(double value)
    {
        if (double.IsNaN(value))
        {
            return 0f;
        }

        if (double.IsPositiveInfinity(value) || value > float.MaxValue)
        {
            return float.MaxValue;
        }

        if (double.IsNegativeInfinity(value) || value < -float.MaxValue)
        {
            return -float.MaxValue;
        }

        return (float)value;
    }

    private static bool IsSameOrigin(IfcPreviewVertex left, IfcPreviewVertex right)
    {
        return Math.Abs(left.X - right.X) < 0.000001d
            && Math.Abs(left.Y - right.Y) < 0.000001d
            && Math.Abs(left.Z - right.Z) < 0.000001d;
    }

    private static bool IsFinite(IfcPreviewVertex vertex)
    {
        return IsFinite(vertex.X) && IsFinite(vertex.Y) && IsFinite(vertex.Z);
    }

    private static IfcPreviewVertex NormalizeVertex(IfcPreviewVertex vertex)
    {
        var length = Math.Sqrt(vertex.X * vertex.X + vertex.Y * vertex.Y + vertex.Z * vertex.Z);
        return length > 0 && IsFinite(length)
            ? new IfcPreviewVertex(vertex.X / length, vertex.Y / length, vertex.Z / length)
            : new IfcPreviewVertex(0, 0, -1);
    }

    private static bool IsFinite(double value)
    {
        return !double.IsNaN(value) && !double.IsInfinity(value);
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

    private static uint CreateProgramWithFallback(
        SilkGL gl,
        bool isGles,
        string label,
        string modernVertexShaderSource,
        string modernFragmentShaderSource,
        string legacyVertexShaderSource,
        string legacyFragmentShaderSource,
        params string[] attributeNames)
    {
        if (isGles)
        {
            try
            {
                var programId = CreateProgram(
                    gl,
                    WithGlslEsVersion(modernVertexShaderSource),
                    WithGlslEsVersion(modernFragmentShaderSource),
                    attributeNames);
                LogViewport($"shader {label}: using GLSL ES 300");
                return programId;
            }
            catch (Exception exception)
            {
                LogViewport($"shader {label}: GLSL ES 300 failed, trying desktop GLSL ({exception.Message})");
            }
        }

        try
        {
            var programId = CreateProgram(
                gl,
                WithGlslCoreVersion(modernVertexShaderSource, 460),
                WithGlslCoreVersion(modernFragmentShaderSource, 460),
                attributeNames);
            LogViewport($"shader {label}: using GLSL 460 core");
            return programId;
        }
        catch (Exception exception)
        {
            LogViewport($"shader {label}: GLSL 460 core failed, trying GLSL 330 core ({exception.Message})");
        }

        try
        {
            var programId = CreateProgram(gl, modernVertexShaderSource, modernFragmentShaderSource, attributeNames);
            LogViewport($"shader {label}: using GLSL 330 core");
            return programId;
        }
        catch (Exception exception)
        {
            LogViewport($"shader {label}: GLSL 330 core failed, falling back to GLSL 120 ({exception.Message})");
        }

        var legacyProgramId = CreateProgram(gl, legacyVertexShaderSource, legacyFragmentShaderSource, attributeNames);
        LogViewport($"shader {label}: using GLSL 120 fallback");
        return legacyProgramId;
    }

    private static uint CreateProgram(SilkGL gl, string vertexShaderSource, string fragmentShaderSource, IReadOnlyList<string> attributeNames)
    {
        uint vertexShader = 0;
        uint fragmentShader = 0;
        uint shaderProgram = 0;
        try
        {
            vertexShader = CompileShader(gl, ShaderType.VertexShader, vertexShaderSource);
            fragmentShader = CompileShader(gl, ShaderType.FragmentShader, fragmentShaderSource);
            shaderProgram = gl.CreateProgram();
            gl.AttachShader(shaderProgram, vertexShader);
            gl.AttachShader(shaderProgram, fragmentShader);
            for (var index = 0u; index < attributeNames.Count; index++)
            {
                gl.BindAttribLocation(shaderProgram, index, attributeNames[(int)index]);
            }

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
        catch
        {
            if (shaderProgram != 0)
            {
                gl.DeleteProgram(shaderProgram);
            }

            if (vertexShader != 0)
            {
                gl.DeleteShader(vertexShader);
            }

            if (fragmentShader != 0)
            {
                gl.DeleteShader(fragmentShader);
            }

            throw;
        }
    }

    private static uint CompileShader(SilkGL gl, ShaderType type, string source)
    {
        var shader = gl.CreateShader(type);
        gl.ShaderSource(shader, source);
        gl.CompileShader(shader);
        gl.GetShader(shader, ShaderParameterName.CompileStatus, out var status);
        if (status == 0)
        {
            var info = gl.GetShaderInfoLog(shader);
            gl.DeleteShader(shader);
            throw new InvalidOperationException(info);
        }

        return shader;
    }

    private static string WithGlslCoreVersion(string source, int version)
    {
        return source.Replace("#version 330 core", $"#version {version} core", StringComparison.Ordinal);
    }

    private static string WithGlslEsVersion(string source)
    {
        return source.Replace(
            "#version 330 core",
            "#version 300 es\nprecision highp float;\nprecision highp int;",
            StringComparison.Ordinal);
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

    internal static void LogViewport(string message)
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

    private const string SceneVertexShaderSource330 = """
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aProductId;

uniform mat4 uMvp;
uniform mat4 uPreviewTransform;
uniform int uPreviewProductId;

out vec3 vNormal;
out vec4 vColor;
out vec3 vWorldPos;
flat out float vProductId;

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
    vWorldPos = worldPosition.xyz;
    vProductId = aProductId;
}
""";

    private const string SceneFragmentShaderSource330 = """
#version 330 core
in vec3 vNormal;
in vec4 vColor;
in vec3 vWorldPos;
flat in float vProductId;

uniform int uSelectedProductId;
uniform vec3 uCameraPosition;
uniform int uUnlit;

out vec4 outColor;

void main()
{
    vec3 color;
    if (uUnlit == 1)
    {
        color = vColor.rgb;
    }
    else
    {
        // Zero-length vertex normals mark faceted geometry: derive the flat
        // face normal from screen-space derivatives (crisp hard edges, no
        // duplicated vertices).
        vec3 normal = dot(vNormal, vNormal) > 0.25
            ? normalize(vNormal)
            : normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));

        // IFC windings are inconsistent; light the side facing the camera.
        vec3 viewDirection = normalize(uCameraPosition - vWorldPos);
        if (dot(normal, viewDirection) < 0.0)
        {
            normal = -normal;
        }

        // Hemisphere ambient + key + fill + headlight: cheap, stable, no pitch
        // black faces and no blown-out highlights.
        float sky = normal.z * 0.5 + 0.5;
        vec3 ambient = mix(vec3(0.27, 0.27, 0.26), vec3(0.48, 0.49, 0.48), sky);
        float key = max(dot(normal, normalize(vec3(0.38, 0.26, 0.89))), 0.0) * 0.46;
        float fill = max(dot(normal, normalize(vec3(-0.50, -0.40, 0.20))), 0.0) * 0.15;
        float head = max(dot(normal, viewDirection), 0.0) * 0.10;
        color = vColor.rgb * min(ambient + vec3(key + fill + head), vec3(1.08));
    }

    if (uSelectedProductId > 0 && abs(vProductId - float(uSelectedProductId)) < 0.5)
    {
        color = mix(color, vec3(1.0, 0.78, 0.22), 0.68);
    }

    outColor = vec4(color, vColor.a);
}
""";

    private const string SceneVertexShaderSource120 = """
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
varying vec3 vWorldPos;
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
    vWorldPos = worldPosition.xyz;
    vProductId = aProductId;
}
""";

    private const string SceneFragmentShaderSource120 = """
#version 120
varying vec3 vNormal;
varying vec4 vColor;
varying vec3 vWorldPos;
varying float vProductId;

uniform int uSelectedProductId;
uniform vec3 uCameraPosition;
uniform int uUnlit;

void main()
{
    vec3 color;
    if (uUnlit == 1)
    {
        color = vColor.rgb;
    }
    else
    {
        vec3 normal = dot(vNormal, vNormal) > 0.25
            ? normalize(vNormal)
            : normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
        vec3 viewDirection = normalize(uCameraPosition - vWorldPos);
        if (dot(normal, viewDirection) < 0.0)
        {
            normal = -normal;
        }

        float sky = normal.z * 0.5 + 0.5;
        vec3 ambient = mix(vec3(0.27, 0.27, 0.26), vec3(0.48, 0.49, 0.48), sky);
        float key = max(dot(normal, normalize(vec3(0.38, 0.26, 0.89))), 0.0) * 0.46;
        float fill = max(dot(normal, normalize(vec3(-0.50, -0.40, 0.20))), 0.0) * 0.15;
        float head = max(dot(normal, viewDirection), 0.0) * 0.10;
        color = vColor.rgb * min(ambient + vec3(key + fill + head), vec3(1.08));
    }

    if (uSelectedProductId > 0 && abs(vProductId - float(uSelectedProductId)) < 0.5)
    {
        color = mix(color, vec3(1.0, 0.78, 0.22), 0.68);
    }

    gl_FragColor = vec4(color, vColor.a);
}
""";

    private const string BackgroundVertexShaderSource330 = """
#version 330 core
layout(location = 0) in vec2 aPosition;

out vec2 vNdc;

void main()
{
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vNdc = aPosition;
}
""";

    private const string BackgroundFragmentShaderSource330 = """
#version 330 core
in vec2 vNdc;

uniform mat4 uInverseViewProjection;

out vec4 outColor;

void main()
{
    vec4 nearPoint = uInverseViewProjection * vec4(vNdc, -1.0, 1.0);
    vec4 farPoint = uInverseViewProjection * vec4(vNdc, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);
    float up = direction.z;

    vec3 zenith = vec3(0.071, 0.086, 0.102);
    vec3 horizon = vec3(0.149, 0.173, 0.165);
    vec3 ground = vec3(0.051, 0.059, 0.053);
    vec3 color = up >= 0.0
        ? mix(horizon, zenith, smoothstep(0.0, 0.55, up))
        : mix(horizon, ground, smoothstep(0.0, 0.32, -up));

    // Soft glow band right at the horizon line.
    color += vec3(0.014, 0.020, 0.017) * (1.0 - smoothstep(0.0, 0.10, abs(up)));
    outColor = vec4(color, 1.0);
}
""";

    private const string BackgroundVertexShaderSource120 = """
#version 120
attribute vec2 aPosition;

varying vec2 vNdc;

void main()
{
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vNdc = aPosition;
}
""";

    private const string BackgroundFragmentShaderSource120 = """
#version 120
varying vec2 vNdc;

uniform mat4 uInverseViewProjection;

void main()
{
    vec4 nearPoint = uInverseViewProjection * vec4(vNdc, -1.0, 1.0);
    vec4 farPoint = uInverseViewProjection * vec4(vNdc, 1.0, 1.0);
    vec3 direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);
    float up = direction.z;

    vec3 zenith = vec3(0.071, 0.086, 0.102);
    vec3 horizon = vec3(0.149, 0.173, 0.165);
    vec3 ground = vec3(0.051, 0.059, 0.053);
    vec3 color = up >= 0.0
        ? mix(horizon, zenith, smoothstep(0.0, 0.55, up))
        : mix(horizon, ground, smoothstep(0.0, 0.32, -up));

    color += vec3(0.014, 0.020, 0.017) * (1.0 - smoothstep(0.0, 0.10, abs(up)));
    gl_FragColor = vec4(color, 1.0);
}
""";

    private const string PickVertexShaderSource330 = """
#version 330 core
layout(location = 0) in vec3 aPosition;
layout(location = 3) in float aProductId;

uniform mat4 uMvp;
uniform mat4 uPreviewTransform;
uniform int uPreviewProductId;

flat out float vProductId;

void main()
{
    vec4 worldPosition = vec4(aPosition, 1.0);
    if (uPreviewProductId > 0 && abs(aProductId - float(uPreviewProductId)) < 0.5)
    {
        worldPosition = uPreviewTransform * worldPosition;
    }

    gl_Position = uMvp * worldPosition;
    vProductId = aProductId;
}
""";

    private const string PickFragmentShaderSource330 = """
#version 330 core
flat in float vProductId;

out vec4 outColor;

void main()
{
    int id = int(vProductId + 0.5);
    int r = (id / 65536) - ((id / 16777216) * 256);
    int g = (id / 256) - ((id / 65536) * 256);
    int b = id - ((id / 256) * 256);
    outColor = vec4(float(r) / 255.0, float(g) / 255.0, float(b) / 255.0, 1.0);
}
""";

    private const string PickVertexShaderSource120 = """
#version 120
attribute vec3 aPosition;
attribute float aProductId;

uniform mat4 uMvp;
uniform mat4 uPreviewTransform;
uniform int uPreviewProductId;

varying float vProductId;

void main()
{
    vec4 worldPosition = vec4(aPosition, 1.0);
    if (uPreviewProductId > 0 && abs(aProductId - float(uPreviewProductId)) < 0.5)
    {
        worldPosition = uPreviewTransform * worldPosition;
    }

    gl_Position = uMvp * worldPosition;
    vProductId = aProductId;
}
""";

    private const string PickFragmentShaderSource120 = """
#version 120
varying float vProductId;

void main()
{
    float id = floor(vProductId + 0.5);
    float r = floor(id / 65536.0);
    float g = floor(mod(id / 256.0, 256.0));
    float b = mod(id, 256.0);
    gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
""";

    private const string FxaaVertexShaderSource330 = """
#version 330 core
layout(location = 0) in vec2 aPosition;
out vec2 vTexCoord;

void main()
{
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vTexCoord = aPosition * 0.5 + 0.5;
}
""";

    private const string FxaaFragmentShaderSource330 = """
#version 330 core
in vec2 vTexCoord;
uniform sampler2D uTexture;
uniform vec2 uTexelSize;

out vec4 outColor;

void main()
{
    float FXAA_SPAN_MAX = 8.0;
    float FXAA_REDUCE_MUL = 1.0 / 8.0;
    float FXAA_REDUCE_MIN = 1.0 / 128.0;

    vec3 rgbNW = texture(uTexture, vTexCoord + (vec2(-1.0, -1.0) * uTexelSize)).xyz;
    vec3 rgbNE = texture(uTexture, vTexCoord + (vec2(1.0, -1.0) * uTexelSize)).xyz;
    vec3 rgbSW = texture(uTexture, vTexCoord + (vec2(-1.0, 1.0) * uTexelSize)).xyz;
    vec3 rgbSE = texture(uTexture, vTexCoord + (vec2(1.0, 1.0) * uTexelSize)).xyz;
    vec3 rgbM  = texture(uTexture, vTexCoord).xyz;

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
        texture(uTexture, vTexCoord.xy + dir * (1.0 / 3.0 - 0.5)).xyz +
        texture(uTexture, vTexCoord.xy + dir * (2.0 / 3.0 - 0.5)).xyz
    );
    vec3 rgbB = rgbA * (1.0 / 2.0) + (1.0 / 4.0) * (
        texture(uTexture, vTexCoord.xy + dir * (0.0 / 3.0 - 0.5)).xyz +
        texture(uTexture, vTexCoord.xy + dir * (3.0 / 3.0 - 0.5)).xyz
    );
    float lumaB = dot(rgbB, luma);

    if ((lumaB < lumaMin) || (lumaB > lumaMax)) {
        outColor = vec4(rgbA, 1.0);
    } else {
        outColor = vec4(rgbB, 1.0);
    }
}
""";

    private const string FxaaVertexShaderSource120 = """
#version 120
attribute vec2 aPosition;
varying vec2 vTexCoord;

void main()
{
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vTexCoord = aPosition * 0.5 + 0.5;
}
""";

    private const string FxaaFragmentShaderSource120 = """
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

    private sealed record TransparentMeshBatch(int ProductId, Vector3 Center, Vector3 BoundsMin, Vector3 BoundsMax, int VertexCount, uint[] Indices);

    private readonly record struct MeshDrawRange(int ProductId, int IndexOffset, int IndexCount, int VertexCount, Vector3 BoundsMin, Vector3 BoundsMax);

    /// <summary>
    /// View frustum extracted from a row-vector view-projection matrix. The
    /// near plane uses the GL convention (z &gt;= -w), which is the conservative
    /// superset of what actually rasterizes — culling never clips visible geometry.
    /// </summary>
    private readonly struct FrustumPlanes
    {
        private readonly Vector4 left;
        private readonly Vector4 right;
        private readonly Vector4 bottom;
        private readonly Vector4 top;
        private readonly Vector4 near;
        private readonly Vector4 far;

        public FrustumPlanes(in Matrix4x4 m)
        {
            left = new Vector4(m.M14 + m.M11, m.M24 + m.M21, m.M34 + m.M31, m.M44 + m.M41);
            right = new Vector4(m.M14 - m.M11, m.M24 - m.M21, m.M34 - m.M31, m.M44 - m.M41);
            bottom = new Vector4(m.M14 + m.M12, m.M24 + m.M22, m.M34 + m.M32, m.M44 + m.M42);
            top = new Vector4(m.M14 - m.M12, m.M24 - m.M22, m.M34 - m.M32, m.M44 - m.M42);
            near = new Vector4(m.M14 + m.M13, m.M24 + m.M23, m.M34 + m.M33, m.M44 + m.M43);
            far = new Vector4(m.M14 - m.M13, m.M24 - m.M23, m.M34 - m.M33, m.M44 - m.M43);
        }

        public bool Intersects(Vector3 min, Vector3 max)
        {
            return !Outside(left, min, max)
                && !Outside(right, min, max)
                && !Outside(bottom, min, max)
                && !Outside(top, min, max)
                && !Outside(near, min, max)
                && !Outside(far, min, max);
        }

        private static bool Outside(in Vector4 plane, in Vector3 min, in Vector3 max)
        {
            // Positive-vertex test: if the AABB corner furthest along the plane
            // normal is behind the plane, the whole box is outside.
            var x = plane.X >= 0 ? max.X : min.X;
            var y = plane.Y >= 0 ? max.Y : min.Y;
            var z = plane.Z >= 0 ? max.Z : min.Z;
            return plane.X * x + plane.Y * y + plane.Z * z + plane.W < 0;
        }
    }

    private readonly record struct InfiniteGridSignature(
        double TargetX,
        double TargetY,
        double MinX,
        double MaxX,
        double MinY,
        double MaxY,
        double FineStep,
        double CoarseStep,
        double LodBlend,
        double Z,
        double OriginX,
        double OriginY,
        double OriginZ);

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

public sealed class ViewportPointPickedEventArgs(double worldX, double worldY, double worldZ) : EventArgs
{
    public double WorldX { get; } = worldX;

    public double WorldY { get; } = worldY;

    public double WorldZ { get; } = worldZ;
}
