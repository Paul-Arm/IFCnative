# IFCnative

Lightweight React/Vite IFC builder and viewer with Mosaic panes, React Flow relationship graphs, and ThatOpen/web-ifc loading.

## Commands

```bash
npm install
npm run start
npm run build
npm run test:ifc
```

The dev server uses Vite, not Expo or Metro.

## Native Windows

The Windows-native editor lives in `NativeWindows/` and keeps the React/Vite app intact. It targets `.NET 9` WPF and now includes package-backed groundwork for xBIM, HelixToolkit, xBIM IDS validation, and AvalonDock.

```powershell
dotnet run --project NativeWindows.Tests\IFCnative.NativeWindows.Tests.csproj
dotnet build NativeWindows\IFCnative.NativeWindows.csproj
```
