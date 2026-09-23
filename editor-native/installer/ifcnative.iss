; Inno Setup script for IFCnative (native).
; Build: iscc installer\ifcnative.iss  (after cargo build --release)

#define AppName "IFCnative"
#define AppVersion "0.1.0"
#define ExeName "IFCnative.exe"
#ifndef BuildDir
  #define BuildDir "..\target\x86_64-pc-windows-gnu\release"
#endif

[Setup]
AppId={{6B2C6E8A-3A2F-4D8E-9F3B-1F2E7C9A5D41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=IFCnative
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#ExeName}
OutputBaseFilename=IFCnative-{#AppVersion}-setup
SetupIconFile=..\app\assets\icon.ico
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "associfc"; Description: "IFC-Dateien (.ifc, .ifczip) mit IFCnative öffnen"; GroupDescription: "Dateizuordnung"

[Files]
Source: "{#BuildDir}\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#ExeName}"
Name: "{group}\{#AppName} deinstallieren"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#ExeName}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.ifc\OpenWithProgids"; ValueType: string; ValueName: "IFCnative.ifc"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associfc
Root: HKA; Subkey: "Software\Classes\.ifczip\OpenWithProgids"; ValueType: string; ValueName: "IFCnative.ifc"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associfc
Root: HKA; Subkey: "Software\Classes\IFCnative.ifc"; ValueType: string; ValueName: ""; ValueData: "IFC-Modell"; Flags: uninsdeletekey; Tasks: associfc
Root: HKA; Subkey: "Software\Classes\IFCnative.ifc\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#ExeName},0"; Tasks: associfc
Root: HKA; Subkey: "Software\Classes\IFCnative.ifc\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeName}"" ""%1"""; Tasks: associfc

[Run]
Filename: "{app}\{#ExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
