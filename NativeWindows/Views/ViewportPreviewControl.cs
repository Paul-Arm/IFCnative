using System.Numerics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.OpenGL;
using Avalonia.OpenGL.Controls;
using Avalonia.Threading;
using IFCnative.NativeWindows.Services;
using Silk.NET.OpenGL;
using SilkGL = Silk.NET.OpenGL.GL;

namespace IFCnative.NativeWindows.Views;

public sealed class ViewportPreviewControl : OpenGlControlBase
{
    public static readonly StyledProperty<IfcRenderScene?> SceneProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, IfcRenderScene?>(nameof(Scene));

    public static readonly StyledProperty<int> SelectedProductIdProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, int>(nameof(SelectedProductId));

    private const int VertexStride = 11;
    private enum DragMode
    {
        None,
        Orbit,
        Pan,
        Dolly,
    }

    private SilkGL? glApi;
    private uint program;
    private uint vertexArray;
    private uint vertexBuffer;
    private uint indexBuffer;
    private uint lineVertexArray;
    private uint lineVertexBuffer;
    private int indexCount;
    private int lineVertexCount;
    private bool buffersDirty = true;
    private bool renderQueued;
    private float[] vertices = [];
    private uint[] indices = [];
    private float[] lineVertices = [];
    private NativeViewportCameraState camera = NativeViewportCameraController.DefaultState();
    private Point? lastPointer;
    private Point? clickStart;
    private Point? pendingPickPoint;
    private bool pointerMoved;
    private DragMode dragMode;
    private int renderLogCount;

    public event EventHandler<IfcProductPickedEventArgs>? ProductPicked;

    public ViewportPreviewControl()
    {
        Focusable = true;
    }

    static ViewportPreviewControl()
    {
        AffectsRender<ViewportPreviewControl>(SceneProperty, SelectedProductIdProperty);
        SceneProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnSceneChanged());
        SelectedProductIdProperty.Changed.AddClassHandler<ViewportPreviewControl>((control, _) => control.OnSelectedProductChanged());
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
            lineVertexArray = glApi.GenVertexArray();
            lineVertexBuffer = glApi.GenBuffer();
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

            if (program != 0)
            {
                glApi.DeleteProgram(program);
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

        if (buffersDirty)
        {
            BuildBuffers();
            UploadBuffers(glApi);
            buffersDirty = false;
        }

        var width = Math.Max(1, (int)Bounds.Width);
        var height = Math.Max(1, (int)Bounds.Height);
        glApi.Viewport(0, 0, (uint)width, (uint)height);
        glApi.ClearColor(0.055f, 0.07f, 0.06f, 1f);
        glApi.Clear(ClearBufferMask.ColorBufferBit | ClearBufferMask.DepthBufferBit);

        var viewProjection = CreateViewProjection(width, height);
        var uniformMatrix = viewProjection;
        glApi.UseProgram(program);
        var matrix = &uniformMatrix.M11;
        glApi.UniformMatrix4(glApi.GetUniformLocation(program, "uMvp"), 1, false, matrix);

        glApi.Uniform1(glApi.GetUniformLocation(program, "uSelectedProductId"), SelectedProductId);

        if (lineVertexCount > 0)
        {
            glApi.BindVertexArray(lineVertexArray);
            glApi.LineWidth(1f);
            glApi.DrawArrays(PrimitiveType.Lines, 0, (uint)lineVertexCount);
        }

        if (indexCount > 0)
        {
            glApi.BindVertexArray(vertexArray);
            glApi.DrawElements(PrimitiveType.Triangles, (uint)indexCount, DrawElementsType.UnsignedInt, null);
        }

        glApi.BindVertexArray(0);
        if (renderLogCount < 8)
        {
            renderLogCount++;
            LogViewport($"render {renderLogCount}: fb={fb} size={width}x{height} scene='{Scene?.Status}' vertices={vertices.Length / VertexStride} indices={indexCount} lines={lineVertexCount} glError={glApi.GetError()}");
        }

        if (pendingPickPoint is { } pickPoint)
        {
            pendingPickPoint = null;
            var pickedProductId = PickProduct(pickPoint);
            if (pickedProductId > 0)
            {
                Dispatcher.UIThread.Post(() => ProductPicked?.Invoke(this, new IfcProductPickedEventArgs(pickedProductId)));
            }
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
        dragMode = GetDragMode(point, e.KeyModifiers);
        e.Pointer.Capture(this);
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

        camera = dragMode switch
        {
            DragMode.Orbit => NativeViewportCameraController.Orbit(camera, deltaX, deltaY),
            DragMode.Pan => NativeViewportCameraController.Pan(camera, deltaX, deltaY, Bounds.Width, Bounds.Height),
            DragMode.Dolly => NativeViewportCameraController.Dolly(camera, deltaY),
            _ => camera,
        };
        lastPointer = current;
        if (dragMode != DragMode.None)
        {
            QueueRender();
        }
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        var point = e.GetPosition(this);
        e.Pointer.Capture(null);
        lastPointer = null;
        if (dragMode == DragMode.None && !pointerMoved && clickStart is not null)
        {
            pendingPickPoint = point;
            QueueRender();
        }

        dragMode = DragMode.None;
        clickStart = null;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        camera = NativeViewportCameraController.Zoom(camera, (int)(e.Delta.Y * 120));
        QueueRender();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        switch (e.Key)
        {
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
        buffersDirty = true;
        if (SelectedProductId > 0 && TryFrameProduct(SelectedProductId))
        {
            return;
        }

        FitCamera();
    }

    private void OnSelectedProductChanged()
    {
        if (SelectedProductId > 0 && TryFrameProduct(SelectedProductId))
        {
            return;
        }

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

        foreach (var mesh in scene.Meshes.Where(mesh => mesh.ProductId == productId && mesh.IsRenderable))
        {
            foreach (var vertex in mesh.Vertices)
            {
                bounds = bounds.Include(vertex.X, vertex.Y, vertex.Z);
            }
        }

        return !bounds.IsEmpty;
    }

    private static DragMode GetDragMode(PointerPoint point, KeyModifiers modifiers)
    {
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
                ? DragMode.Pan
                : DragMode.Orbit;
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

    private void BuildBuffers()
    {
        var scene = Scene;
        if (scene is null || scene.IsEmpty)
        {
            vertices = [];
            indices = [];
            lineVertices = [];
            indexCount = 0;
            lineVertexCount = 0;
            return;
        }

        var vertexValues = new List<float>();
        var indexValues = new List<uint>();
        foreach (var mesh in scene.Meshes.Where(mesh => mesh.IsRenderable))
        {
            var baseIndex = (uint)(vertexValues.Count / VertexStride);
            foreach (var vertex in mesh.Vertices)
            {
                AddVertex(vertexValues, vertex, mesh.Color, mesh.ProductId);
            }

            foreach (var index in mesh.Indices)
            {
                if (index >= 0 && index < mesh.Vertices.Count)
                {
                    indexValues.Add(baseIndex + (uint)index);
                }
            }
        }

        vertices = vertexValues.ToArray();
        indices = indexValues.ToArray();
        indexCount = indices.Length;
        lineVertices = BuildGridAndAxes(scene).ToArray();
        lineVertexCount = lineVertices.Length / VertexStride;
    }

    private unsafe void UploadBuffers(SilkGL gl)
    {
        BindArray(gl, vertexArray, vertexBuffer);
        fixed (float* vertexPointer = vertices)
        {
            gl.BufferData(BufferTargetARB.ArrayBuffer, (nuint)(vertices.Length * sizeof(float)), vertexPointer, BufferUsageARB.StaticDraw);
        }

        gl.BindBuffer(BufferTargetARB.ElementArrayBuffer, indexBuffer);
        fixed (uint* indexPointer = indices)
        {
            gl.BufferData(BufferTargetARB.ElementArrayBuffer, (nuint)(indices.Length * sizeof(uint)), indexPointer, BufferUsageARB.StaticDraw);
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
        var picked = 0;
        foreach (var mesh in scene.Meshes)
        {
            if (!mesh.IsRenderable)
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

varying vec3 vNormal;
varying vec4 vColor;
varying float vProductId;

void main()
{
    gl_Position = uMvp * vec4(aPosition, 1.0);
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

}

public sealed class IfcProductPickedEventArgs(int productId) : EventArgs
{
    public int ProductId { get; } = productId;
}
