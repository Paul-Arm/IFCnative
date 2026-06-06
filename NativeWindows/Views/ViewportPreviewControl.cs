using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using IFCnative.NativeWindows.Services;

namespace IFCnative.NativeWindows.Views;

public sealed class ViewportPreviewControl : Control
{
    public static readonly StyledProperty<IEnumerable<IfcPreviewMesh>?> MeshesProperty =
        AvaloniaProperty.Register<ViewportPreviewControl, IEnumerable<IfcPreviewMesh>?>(nameof(Meshes));

    static ViewportPreviewControl()
    {
        AffectsRender<ViewportPreviewControl>(MeshesProperty);
    }

    public IEnumerable<IfcPreviewMesh>? Meshes
    {
        get => GetValue(MeshesProperty);
        set => SetValue(MeshesProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);

        var bounds = Bounds;
        context.DrawRectangle(new SolidColorBrush(Color.Parse("#151814")), null, bounds);
        DrawGrid(context, bounds);

        var meshes = Meshes?.Where(mesh => mesh.IsRenderable).ToList() ?? [];
        if (meshes.Count == 0)
        {
            return;
        }

        var vertices = meshes.SelectMany(mesh => mesh.Vertices).ToList();
        var minX = vertices.Min(vertex => vertex.X);
        var maxX = vertices.Max(vertex => vertex.X);
        var minY = vertices.Min(vertex => vertex.Y);
        var maxY = vertices.Max(vertex => vertex.Y);
        if (Math.Abs(maxX - minX) < 0.001)
        {
            maxX = minX + 1;
        }

        if (Math.Abs(maxY - minY) < 0.001)
        {
            maxY = minY + 1;
        }

        var palette = new[]
        {
            Color.Parse("#58A58B"),
            Color.Parse("#B8904B"),
            Color.Parse("#8BA8D9"),
            Color.Parse("#B86E6A"),
            Color.Parse("#8EBA62"),
        };
        var scale = Math.Min((bounds.Width - 32) / (maxX - minX), (bounds.Height - 32) / (maxY - minY));
        if (!double.IsFinite(scale) || scale <= 0)
        {
            scale = 1;
        }

        var offsetX = bounds.X + (bounds.Width - ((maxX - minX) * scale)) / 2;
        var offsetY = bounds.Y + (bounds.Height - ((maxY - minY) * scale)) / 2;

        Point Project(IfcPreviewVertex vertex)
        {
            return new Point(
                offsetX + ((vertex.X - minX) * scale),
                offsetY + ((maxY - vertex.Y) * scale));
        }

        for (var meshIndex = 0; meshIndex < meshes.Count; meshIndex++)
        {
            var mesh = meshes[meshIndex];
            var color = palette[meshIndex % palette.Length];
            var fill = new SolidColorBrush(color, 0.26);
            var pen = new Pen(new SolidColorBrush(color, 0.90), 1.1);

            for (var i = 0; i + 2 < mesh.TriangleIndices.Count; i += 3)
            {
                var a = mesh.TriangleIndices[i];
                var b = mesh.TriangleIndices[i + 1];
                var c = mesh.TriangleIndices[i + 2];
                if (a >= mesh.Vertices.Count || b >= mesh.Vertices.Count || c >= mesh.Vertices.Count)
                {
                    continue;
                }

                var geometry = new StreamGeometry();
                using (var stream = geometry.Open())
                {
                    stream.BeginFigure(Project(mesh.Vertices[a]), isFilled: true);
                    stream.LineTo(Project(mesh.Vertices[b]));
                    stream.LineTo(Project(mesh.Vertices[c]));
                    stream.EndFigure(isClosed: true);
                }

                context.DrawGeometry(fill, pen, geometry);
            }
        }
    }

    private static void DrawGrid(DrawingContext context, Rect bounds)
    {
        var pen = new Pen(new SolidColorBrush(Color.Parse("#2B3028")), 1);
        for (var x = bounds.X; x < bounds.Right; x += 48)
        {
            context.DrawLine(pen, new Point(x, bounds.Y), new Point(x, bounds.Bottom));
        }

        for (var y = bounds.Y; y < bounds.Bottom; y += 48)
        {
            context.DrawLine(pen, new Point(bounds.X, y), new Point(bounds.Right, y));
        }
    }
}
