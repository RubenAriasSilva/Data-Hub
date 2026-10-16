@echo off
rem Instalacion completa en Windows: MySQL como servicio + Data Hub con PM2.
rem Doble clic o ejecutar desde una terminal. Requiere Node.js 20+ (https://nodejs.org).
cd /d "%~dp0"

echo.
echo === Paso 1/2: MySQL como servicio de Windows (se pedira permiso de administrador) ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-mysql.ps1"
if errorlevel 1 (
  echo.
  echo No se completo la instalacion de MySQL. Revisa el mensaje anterior.
  pause
  exit /b 1
)

echo.
echo === Paso 2/2: Data Hub con PM2 ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\deploy.ps1"

echo.
pause
