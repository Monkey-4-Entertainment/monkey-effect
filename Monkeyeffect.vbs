' Launch Monkeyeffect without showing a CMD window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
bat = appDir & "\Monkeyeffect.bat"
If Not fso.FileExists(bat) Then
  MsgBox "Monkeyeffect.bat not found." & vbCrLf & appDir, vbCritical, "Monkeyeffect"
  WScript.Quit 1
End If
sh.CurrentDirectory = appDir
sh.Run "cmd /c """ & bat & """ __quiet__", 0, False
