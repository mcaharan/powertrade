param(
    [int[]]$PortsToKill = @(5000,5173)
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir
Write-Host "[start_all.ps1] KILL ports $($PortsToKill -join ', ') if any"
foreach ($p in $PortsToKill) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
        }
    } catch {}
}

Write-Host "[start_all.ps1] Bringing down docker-compose services (if any)"
try { docker-compose down } catch { Write-Host "docker-compose down failed: $_" }

Write-Host "[start_all.ps1] Starting docker-compose services"
try { docker-compose up -d } catch { Write-Host "docker-compose up failed: $_" }

Write-Host "[start_all.ps1] Waiting for MySQL (127.0.0.1:3306) to accept connections"
for ($i=1; $i -le 30; $i++) {
    $test = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue
    if ($test.TcpTestSucceeded) {
        Write-Host "[start_all.ps1] MySQL is reachable"
        break
    }
    Write-Host "[start_all.ps1] waiting for mysql... ($i/30)"
    Start-Sleep -Seconds 1
}

$LogsDir = Join-Path $RootDir 'logs'
if (-Not (Test-Path $LogsDir)) { New-Item -Path $LogsDir -ItemType Directory | Out-Null }

Write-Host "[start_all.ps1] Starting backend (npm run dev)"
$BackendDir = Join-Path $RootDir 'backend'
Push-Location $BackendDir
try { npm install --silent } catch { Write-Host "npm install (backend) failed: $_" }
$BackendLog = Join-Path $LogsDir 'backend.log'
$backendProc = Start-Process -FilePath npm -ArgumentList 'run','dev','--silent' -WorkingDirectory $BackendDir -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendLog -NoNewWindow -PassThru
Write-Host "[start_all.ps1] backend pid=$($backendProc.Id)"
Pop-Location

Write-Host "[start_all.ps1] Starting frontend (npm run dev)"
$FrontendDir = Join-Path $RootDir 'frontend'
Push-Location $FrontendDir
try { npm install --silent } catch { Write-Host "npm install (frontend) failed: $_" }
$FrontendLog = Join-Path $LogsDir 'frontend.log'
$expose = $env:EXPOSE_FRONTEND
if ($expose -eq '1') {
    $args = @('run','dev','--','--host')
} else {
    $args = @('run','dev')
}
$frontendProc = Start-Process -FilePath npm -ArgumentList $args -WorkingDirectory $FrontendDir -RedirectStandardOutput $FrontendLog -RedirectStandardError $FrontendLog -NoNewWindow -PassThru
Write-Host "[start_all.ps1] frontend pid=$($frontendProc.Id)"
Pop-Location

Write-Host "[start_all.ps1] Done. Backend log: logs/backend.log  Frontend log: logs/frontend.log"
Write-Host "To expose frontend externally set EXPOSE_FRONTEND=1 when running this script."

exit 0
