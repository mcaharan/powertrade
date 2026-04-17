param(
    [int[]]$PortsToKill = @(5000,5173)
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Get-DockerComposeCommand {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        try {
            docker compose version | Out-Null
            return @('docker', 'compose')
        } catch {}
    }

    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        return @('docker-compose')
    }

    return $null
}

Write-Host "[start_all.ps1] KILL ports $($PortsToKill -join ', ') if any"
foreach ($p in $PortsToKill) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
        }
    } catch {}
}

 $composeCmd = Get-DockerComposeCommand

Write-Host "[start_all.ps1] Bringing down docker-compose services (if any)"
if ($composeCmd) {
    try { & $composeCmd[0] $composeCmd[1..($composeCmd.Length - 1)] down } catch { Write-Host "compose down failed: $_" }
} else {
    Write-Host "[start_all.ps1] Docker Compose not found. Skipping MySQL container startup."
}

Write-Host "[start_all.ps1] Starting docker-compose services"
if ($composeCmd) {
    try { & $composeCmd[0] $composeCmd[1..($composeCmd.Length - 1)] up -d } catch { Write-Host "compose up failed: $_" }
} else {
    Write-Host "[start_all.ps1] No Docker runtime available. Backend will use DB fallback mode unless MySQL is already running locally."
}

Write-Host "[start_all.ps1] Waiting for MySQL (127.0.0.1:3306) to accept connections"
if ($composeCmd -or (Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue).TcpTestSucceeded) {
    for ($i=1; $i -le 30; $i++) {
        $test = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue
        if ($test.TcpTestSucceeded) {
            Write-Host "[start_all.ps1] MySQL is reachable"
            break
        }
        Write-Host "[start_all.ps1] waiting for mysql... ($i/30)"
        Start-Sleep -Seconds 1
    }
} else {
    Write-Host "[start_all.ps1] MySQL not reachable on 127.0.0.1:3306. Continuing; backend may start in mock DB mode."
}

$LogsDir = Join-Path $RootDir 'logs'
if (-Not (Test-Path $LogsDir)) { New-Item -Path $LogsDir -ItemType Directory | Out-Null }

Write-Host "[start_all.ps1] Starting backend (npm run dev)"
$BackendDir = Join-Path $RootDir 'backend'
Push-Location $BackendDir
try { npm install --silent } catch { Write-Host "npm install (backend) failed: $_" }
$BackendLog = Join-Path $LogsDir 'backend.log'
$backendCommand = "cd /d `"$BackendDir`" && npm run dev --silent > `"$BackendLog`" 2>&1"
$backendProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $backendCommand -WorkingDirectory $BackendDir -PassThru
Write-Host "[start_all.ps1] backend pid=$($backendProc.Id)"
Pop-Location

Write-Host "[start_all.ps1] Starting frontend (npm run dev)"
$FrontendDir = Join-Path $RootDir 'frontend'
Push-Location $FrontendDir
try { npm install --silent } catch { Write-Host "npm install (frontend) failed: $_" }
$FrontendLog = Join-Path $LogsDir 'frontend.log'
$expose = $env:EXPOSE_FRONTEND
if ($expose -eq '1') {
    $frontendCommand = "cd /d `"$FrontendDir`" && npm run dev -- --host > `"$FrontendLog`" 2>&1"
} else {
    $frontendCommand = "cd /d `"$FrontendDir`" && npm run dev > `"$FrontendLog`" 2>&1"
}
$frontendProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $frontendCommand -WorkingDirectory $FrontendDir -PassThru
Write-Host "[start_all.ps1] frontend pid=$($frontendProc.Id)"
Pop-Location

Write-Host "[start_all.ps1] Done. Backend log: logs/backend.log  Frontend log: logs/frontend.log"
Write-Host "To expose frontend externally set EXPOSE_FRONTEND=1 when running this script."

exit 0
