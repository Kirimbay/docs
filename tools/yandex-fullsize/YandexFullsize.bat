@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0YandexFullsize.ps1'"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0YandexFullsize.ps1"
if errorlevel 1 (
  echo.
  echo Could not open the program.
  pause
)
