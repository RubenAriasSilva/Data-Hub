<#
.SYNOPSIS
  Instala dependencias, compila y deja el Data Hub corriendo con PM2 (se reinicia solo y arranca al iniciar sesión).

.DESCRIPTION
  Ejecútalo en la primera instalación y cada vez que actualices el código (git pull). Es idempotente.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy.ps1
  powershell -ExecutionPolicy Bypass -File scripts\windows\deploy.ps1 -OpenFirewall   # (como administrador)
#>
param(
  [switch]$OpenFirewall,  # abre el puerto en el firewall para otras computadoras (requiere administrador)
  [switch]$NoStartup      # no registrar el arranque automático
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $RepoRoot 'backend\.env'

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Invoke-Checked([string]$cmd, [string[]]$cmdArgs) {
  & $cmd @cmdArgs
  if ($LASTEXITCODE -ne 0) { throw "Falló: $cmd $($cmdArgs -join ' ')" }
}
function Get-EnvValue([string]$key, [string]$default) {
  if (Test-Path $EnvFile) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match "^\s*$key=" } | Select-Object -First 1
    if ($line) { return ($line -split '=', 2)[1].Trim() }
  }
  return $default
}

Push-Location $RepoRoot
try {
  # --- Node.js ---
  Step 'Verificando Node.js'
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js no está instalado. Instala la versión LTS desde https://nodejs.org y vuelve a ejecutar.'
  }
  $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
  if ($nodeMajor -lt 20) { throw "Se requiere Node.js 20 o superior (tienes $(node --version))." }
  Write-Host "Node $(node --version)"

  # --- Dependencias y compilación ---
  Step 'Instalando dependencias (backend y frontend)'
  Invoke-Checked npm @('ci', '--prefix', 'backend', '--omit=dev', '--no-audit', '--no-fund')
  Invoke-Checked npm @('ci', '--prefix', 'frontend', '--no-audit', '--no-fund')

  Step 'Compilando el frontend'
  Invoke-Checked npm @('run', 'build', '--prefix', 'frontend')

  # --- Configuración ---
  if (-not (Test-Path $EnvFile)) {
    Step 'Creando backend\.env (no existe)'
    Copy-Item (Join-Path $RepoRoot 'backend\.env.example') $EnvFile
    Write-Host 'Ingresa los datos de MySQL (Enter = valor por defecto):'
    $vals = [ordered]@{ DB_HOST = '127.0.0.1'; DB_PORT = '3306'; DB_USER = 'root'; DB_PASSWORD = ''; DB_NAME = 'data_hub' }
    $content = Get-Content $EnvFile
    foreach ($k in @($vals.Keys)) {
      $v = Read-Host "  $k [$($vals[$k])]"
      if ($v) { $vals[$k] = $v }
      $content = $content | ForEach-Object { if ($_ -match "^$k=") { "$k=$($vals[$k])" } else { $_ } }
    }
    [IO.File]::WriteAllLines($EnvFile, [string[]]$content)
  }
  $port = Get-EnvValue 'PORT' '4000'

  # --- PM2 ---
  if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Step 'Instalando PM2 (global)'
    Invoke-Checked npm @('install', '-g', 'pm2')
    $env:Path = "$env:APPDATA\npm;$env:Path"
  }
  Step 'Iniciando / recargando el Data Hub con PM2'
  Invoke-Checked pm2 @('startOrReload', 'ecosystem.config.cjs', '--update-env')
  Invoke-Checked pm2 @('save')

  # --- Arranque automático al iniciar sesión (carpeta Inicio; no requiere administrador) ---
  if (-not $NoStartup) {
    Step 'Registrando arranque automático'
    $startup = [Environment]::GetFolderPath('Startup')
    $pm2Cmd = (Get-Command pm2).Source
    $launcher = Join-Path $startup 'DataHub-PM2.cmd'
    [IO.File]::WriteAllText($launcher, "@echo off`r`ncall `"$pm2Cmd`" resurrect`r`n")
    Write-Host "Creado $launcher"
  }

  # --- Firewall ---
  if ($OpenFirewall) {
    Step "Abriendo el puerto $port en el firewall"
    if (-not (Get-NetFirewallRule -DisplayName 'Data Hub' -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName 'Data Hub' -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    }
  }

  # --- Verificación ---
  Step 'Verificando el servicio'
  $health = $null
  for ($i = 0; $i -lt 20; $i++) {
    try { $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 3; break }
    catch {
      # 503 = la API responde pero MySQL aún no está disponible
      if ($_.Exception.Response) { $health = 'degraded'; break }
      Start-Sleep -Seconds 1
    }
  }
  Invoke-Checked pm2 @('status')
  if (-not $health) { throw "La app no respondió en el puerto $port. Revisa: pm2 logs data-hub" }
  if ($health -eq 'degraded') {
    Write-Host "`nLa app está corriendo pero NO conecta a MySQL. Revisa backend\.env y 'pm2 logs data-hub'." -ForegroundColor Yellow
  } else {
    Write-Host "`nData Hub en ejecución." -ForegroundColor Green
  }
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Select-Object -ExpandProperty IPAddress
  Write-Host "  Local: http://localhost:$port"
  foreach ($ip in $ips) { Write-Host "  Red:   http://${ip}:$port" }
  Write-Host "`nComandos: pm2 status | pm2 logs data-hub | pm2 restart data-hub | pm2 stop data-hub"
} catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Pop-Location
}
