<#
.SYNOPSIS
  Instala MySQL 8.4 LTS como servicio de Windows (sin XAMPP) y prepara la base de datos del Data Hub.

.DESCRIPTION
  - Descarga el ZIP oficial de MySQL (o usa -ZipPath si ya lo tienes, útil sin internet).
  - Lo registra como servicio con inicio automático: arranca solo al encender la PC.
  - Crea la base de datos y un usuario dedicado para la app, y escribe backend/.env.
  - Es idempotente: si el servicio ya existe, solo se asegura de que esté iniciado.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-mysql.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-mysql.ps1 -Port 3307 -ZipPath D:\mysql-8.4.6-winx64.zip
#>
param(
  [string]$Version = '8.4.6',
  [string]$InstallDir = 'C:\mysql',
  [string]$ServiceName = 'MySQL84',
  [int]$Port = 3306,
  [string]$ZipPath,
  [string]$RootPassword,
  [string]$AppDatabase = 'data_hub',
  [string]$AppUser = 'datahub'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $RepoRoot 'backend\.env'

# --- Autoelevación: registrar un servicio requiere permisos de administrador ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Se requieren permisos de administrador. Abriendo ventana elevada...' -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  foreach ($kv in $PSBoundParameters.GetEnumerator()) { $argList += "-$($kv.Key)", "`"$($kv.Value)`"" }
  $p = Start-Process powershell -Verb RunAs -ArgumentList $argList -Wait -PassThru
  exit $p.ExitCode
}

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Done($code = 0) {
  if ($Host.Name -eq 'ConsoleHost') { Read-Host "`nPresiona Enter para cerrar" | Out-Null }
  exit $code
}
function New-Password([int]$len = 20) {
  $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  -join (1..$len | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
}
function Set-EnvValue([string]$file, [string]$key, [string]$value) {
  $lines = if (Test-Path $file) { @(Get-Content $file) } else { @() }
  $found = $false
  $lines = $lines | ForEach-Object {
    if ($_ -match "^\s*$key=") { $found = $true; "$key=$value" } else { $_ }
  }
  if (-not $found) { $lines += "$key=$value" }
  [IO.File]::WriteAllLines($file, [string[]]$lines)  # UTF-8 sin BOM
}

try {
  # --- Servicio ya instalado: solo iniciarlo ---
  $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existing) {
    Step "El servicio $ServiceName ya existe"
    Set-Service -Name $ServiceName -StartupType Automatic
    if ($existing.Status -ne 'Running') { Start-Service $ServiceName }
    Write-Host "MySQL está en ejecución con inicio automático." -ForegroundColor Green
    Write-Host "Si backend\.env aún no tiene credenciales, edítalo a mano (ver DEPLOY.md)."
    Done
  }

  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "El puerto $Port ya está en uso (¿otro MySQL o XAMPP en ejecución?). Detenlo o vuelve a ejecutar con -Port 3307."
  }

  # --- Runtime de Visual C++ (requerido por mysqld.exe) ---
  if (-not (Test-Path "$env:WINDIR\System32\vcruntime140_1.dll") -or -not (Test-Path "$env:WINDIR\System32\msvcp140.dll")) {
    Step 'Instalando Microsoft Visual C++ Redistributable'
    $vc = Join-Path $env:TEMP 'vc_redist.x64.exe'
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $vc -UseBasicParsing
    Start-Process $vc -ArgumentList '/install', '/quiet', '/norestart' -Wait
  }

  # --- Descarga y extracción ---
  $base = Join-Path $InstallDir "mysql-$Version-winx64"
  $bin = Join-Path $base 'bin'
  if (-not (Test-Path (Join-Path $bin 'mysqld.exe'))) {
    if (-not $ZipPath) {
      $ZipPath = Join-Path $env:TEMP "mysql-$Version-winx64.zip"
      if (-not (Test-Path $ZipPath)) {
        $minor = ($Version -split '\.')[0..1] -join '.'
        $url = "https://cdn.mysql.com/archives/mysql-$minor/mysql-$Version-winx64.zip"
        Step "Descargando MySQL $Version (~250 MB) desde $url"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest $url -OutFile "$ZipPath.part" -UseBasicParsing
        Move-Item "$ZipPath.part" $ZipPath -Force
      }
    }
    Step "Descomprimiendo en $InstallDir"
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Expand-Archive $ZipPath -DestinationPath $InstallDir -Force
  }

  # --- Configuración (my.ini sin BOM; MySQL no lo acepta) ---
  $data = Join-Path $InstallDir 'data'
  $ini = Join-Path $InstallDir 'my.ini'
  $ini_content = @"
[mysqld]
basedir=$($base -replace '\\', '/')
datadir=$($data -replace '\\', '/')
port=$Port
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
max_allowed_packet=64M
innodb_buffer_pool_size=256M

[client]
port=$Port
default-character-set=utf8mb4
"@
  [IO.File]::WriteAllText($ini, $ini_content)

  if (-not (Test-Path $data)) {
    Step 'Inicializando el directorio de datos'
    & (Join-Path $bin 'mysqld.exe') "--defaults-file=$ini" --initialize-insecure --console
    if ($LASTEXITCODE -ne 0) { throw 'Falló la inicialización de MySQL.' }
  }

  Step "Registrando el servicio $ServiceName (inicio automático)"
  & (Join-Path $bin 'mysqld.exe') --install $ServiceName "--defaults-file=$ini"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar el servicio.' }
  Set-Service -Name $ServiceName -StartupType Automatic
  Start-Service $ServiceName

  $mysql = Join-Path $bin 'mysql.exe'
  $ready = $false
  # En PowerShell 5.1, redirigir stderr de un .exe con ErrorAction=Stop lanza excepción; se relaja aquí.
  $ErrorActionPreference = 'Continue'
  for ($i = 0; $i -lt 30; $i++) {
    & (Join-Path $bin 'mysqladmin.exe') -u root --skip-password -h 127.0.0.1 -P $Port ping 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  $ErrorActionPreference = 'Stop'
  if (-not $ready) { throw "MySQL no respondió. Revisa los logs en $data" }

  # --- Contraseñas, base de datos y usuario de la app ---
  Step 'Configurando usuarios y base de datos'
  if (-not $RootPassword) { $RootPassword = New-Password }
  $appPassword = New-Password
  $sql = @"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$RootPassword';
CREATE DATABASE IF NOT EXISTS ``$AppDatabase`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$AppUser'@'localhost' IDENTIFIED BY '$appPassword';
CREATE USER IF NOT EXISTS '$AppUser'@'127.0.0.1' IDENTIFIED BY '$appPassword';
GRANT ALL PRIVILEGES ON ``$AppDatabase``.* TO '$AppUser'@'localhost';
GRANT ALL PRIVILEGES ON ``$AppDatabase``.* TO '$AppUser'@'127.0.0.1';
FLUSH PRIVILEGES;
"@
  $sql | & $mysql -u root --skip-password -h 127.0.0.1 -P $Port
  if ($LASTEXITCODE -ne 0) { throw 'Falló la configuración de usuarios.' }

  # --- backend/.env ---
  if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $RepoRoot 'backend\.env.example') $EnvFile }
  Set-EnvValue $EnvFile 'DB_HOST' '127.0.0.1'
  Set-EnvValue $EnvFile 'DB_PORT' "$Port"
  Set-EnvValue $EnvFile 'DB_USER' $AppUser
  Set-EnvValue $EnvFile 'DB_PASSWORD' $appPassword
  Set-EnvValue $EnvFile 'DB_NAME' $AppDatabase

  Write-Host "`nMySQL $Version instalado como servicio '$ServiceName' en el puerto $Port." -ForegroundColor Green
  Write-Host "Credenciales de la app guardadas en backend\.env (usuario '$AppUser')."
  Write-Host "Contraseña de root: $RootPassword" -ForegroundColor Yellow
  Write-Host 'Guárdala en un lugar seguro: no se almacena en ningún archivo.' -ForegroundColor Yellow
  Write-Host "`nComandos: net start $ServiceName | net stop $ServiceName | `"$mysql`" -u root -p"
  Done
} catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  Done 1
}
