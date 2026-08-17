; Monkeyeffect installer — installs a complete copy so Desktop portable files stay safe
#define MyAppName "Monkeyeffect"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Monkeyeffect"
#define MyAppExeName "Monkeyeffect.vbs"
#define MyAppId "{{A7C3E2F1-8B4D-4E9A-9C21-MEFFECT2026}}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Monkeyeffect
DefaultGroupName=Monkeyeffect
DisableProgramGroupPage=yes
OutputDir=C:\Users\PC\Desktop
OutputBaseFilename=Monkeyeffect-Setup
SetupIconFile=C:\Users\PC\Desktop\TempleGiftRelay-Portable\monkeyeffect.ico
UninstallDisplayIcon={app}\TempleGiftRelay.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Additional icons:"; Flags: checkedonce

[Files]
; Full app payload from staged release folder
Source: "C:\Users\PC\Desktop\TempleGiftRelay-Portable\installer-stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Monkeyeffect"; Filename: "{app}\Monkeyeffect.bat"; IconFilename: "{app}\monkeyeffect.ico"; WorkingDir: "{app}"
Name: "{group}\Uninstall Monkeyeffect"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Monkeyeffect"; Filename: "{app}\Monkeyeffect.bat"; IconFilename: "{app}\monkeyeffect.ico"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Monkeyeffect.bat"; Description: "Launch Monkeyeffect"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
