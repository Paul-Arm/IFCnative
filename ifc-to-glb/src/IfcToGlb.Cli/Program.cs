using System.Globalization;
using IFCnative.IfcToGlb;
using Microsoft.Extensions.Logging;

const string Usage = """
    ifc2glb - memory-efficient IFC to glTF binary (GLB) converter (xBIM geometry)

    Usage:
      ifc2glb <input.ifc> [output.glb] [options]

    Options:
      --deflection-mm <value>   Tessellation chord tolerance in mm (default: 4)
      --deflection-angle <value> Angular deflection in radians (default: 1)
      --threads <n>             Tessellation threads (default: CPU count)
      --include-spaces          Export IfcSpace volumes (skipped by default)
      --no-metadata             Omit IFC type/name/expressId node extras
      --quiet                   Suppress progress output
      --verbose                 Show xBIM toolkit logs (diagnostics)
      -h, --help                Show this help

    Output defaults to the input path with a .glb extension. Exit codes:
    0 = success, 1 = conversion failed, 2 = invalid arguments.
    """;

string? input = null;
string? output = null;
var deflectionMm = 4d;
var deflectionAngle = 1d;
var threads = Environment.ProcessorCount;
var includeSpaces = false;
var metadata = true;
var quiet = false;
var verbose = false;

for (var i = 0; i < args.Length; i++)
{
    var arg = args[i];
    switch (arg)
    {
        case "-h" or "--help":
            Console.WriteLine(Usage);
            return 0;
        case "--include-spaces":
            includeSpaces = true;
            break;
        case "--no-metadata":
            metadata = false;
            break;
        case "--quiet":
            quiet = true;
            break;
        case "--verbose":
            verbose = true;
            break;
        case "--deflection-mm" or "--deflection-angle" or "--threads":
            if (i + 1 >= args.Length || !double.TryParse(args[++i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            {
                Console.Error.WriteLine($"error: {arg} requires a numeric value");
                return 2;
            }

            if (arg == "--deflection-mm")
            {
                deflectionMm = value;
            }
            else if (arg == "--deflection-angle")
            {
                deflectionAngle = value;
            }
            else
            {
                threads = (int)value;
            }

            break;
        default:
            if (arg.StartsWith('-'))
            {
                Console.Error.WriteLine($"error: unknown option {arg}");
                return 2;
            }

            if (input is null)
            {
                input = arg;
            }
            else if (output is null)
            {
                output = arg;
            }
            else
            {
                Console.Error.WriteLine($"error: unexpected argument {arg}");
                return 2;
            }

            break;
    }
}

if (input is null)
{
    Console.Error.WriteLine(Usage);
    return 2;
}

if (!File.Exists(input))
{
    Console.Error.WriteLine($"error: input file not found: {input}");
    return 2;
}

output ??= Path.ChangeExtension(input, ".glb");

if (verbose)
{
    IfcToGlbConverter.ConfigureLogging(LoggerFactory.Create(builder =>
        builder.AddSimpleConsole(console => console.SingleLine = true)
            .SetMinimumLevel(LogLevel.Debug)));
}

var progress = quiet
    ? null
    : new SynchronousProgress(message => Console.Error.WriteLine($"[ifc2glb] {message}"));

try
{
    var result = IfcToGlbConverter.Convert(
        input,
        output,
        new ConversionOptions
        {
            DeflectionMillimetres = deflectionMm,
            DeflectionAngle = deflectionAngle,
            MaxThreads = threads,
            IncludeSpaces = includeSpaces,
            IncludeMetadata = metadata,
        },
        progress);

    if (!quiet)
    {
        var peak = TryGetPeakWorkingSetMb();
        Console.Error.WriteLine(
            $"[ifc2glb] {result.ProductCount:N0} products, {result.InstanceCount:N0} instances, "
            + $"{result.MeshCount:N0} meshes, {result.TriangleCount:N0} triangles -> "
            + $"{result.OutputBytes / (1024d * 1024d):0.00} MB in {result.Duration.TotalSeconds:0.0}s"
            + (peak is double mb ? $" (peak memory {mb:0} MB)" : string.Empty));
    }

    Console.WriteLine(result.OutputPath);
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine(verbose ? $"error: {exception}" : $"error: {exception.Message}");
    return 1;
}

static double? TryGetPeakWorkingSetMb()
{
    try
    {
        return System.Diagnostics.Process.GetCurrentProcess().PeakWorkingSet64 / (1024d * 1024d);
    }
    catch
    {
        return null;
    }
}

internal sealed class SynchronousProgress(Action<string> report) : IProgress<string>
{
    public void Report(string value) => report(value);
}
