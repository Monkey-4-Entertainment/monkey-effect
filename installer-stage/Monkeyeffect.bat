@echo off
title Monkeyeffect
cd /d "%~dp0"

rem Normal double-click → hidden launcher (no CMD window left open).
if /I not "%~1"=="__quiet__" (
  if exist "%~dp0Monkeyeffect.vbs" (
    start "" wscript.exe //nologo "%~dp0Monkeyeffect.vbs"
    exit /b 0
  )
)

if not exist "%~dp0TempleGiftRelay.exe" (
  echo ERROR: TempleGiftRelay.exe missing.
  if /I not "%~1"=="__quiet__" pause
  exit /b 1
)
if not exist "%~dp0wwwroot\index.html" (
  echo ERROR: wwwroot missing. Reinstall Monkeyeffect.
  if /I not "%~1"=="__quiet__" pause
  exit /b 1
)

if /I not "%~1"=="__quiet__" echo Closing old Monkeyeffect...
taskkill /F /IM TempleGiftRelay.exe >nul 2>&1
powershell -NoProfile -Command "3847,12922,3848 | ForEach-Object { Get-NetTCPConnection -LocalPort $_ -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3847" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":12922" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3848" ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

if exist "%~dp0TempleGiftRelay.dll.new" (
  copy /Y "%~dp0TempleGiftRelay.dll.new" "%~dp0TempleGiftRelay.dll" >nul
  del "%~dp0TempleGiftRelay.dll.new" >nul 2>&1
)

if exist "%~dp0tools\tts-server.mjs" if exist "%~dp0.playwright\node\win32_x64\node.exe" (
  start "Monkeyeffect TTS" /MIN "%~dp0.playwright\node\win32_x64\node.exe" "%~dp0tools\tts-server.mjs"
)

start "" "%~dp0TempleGiftRelay.exe"
exit /b 0