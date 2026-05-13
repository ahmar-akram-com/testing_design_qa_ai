param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$HealthUrl = "http://127.0.0.1:$Port/api/health"
$AppUrl = "http://127.0.0.1:$Port/"

function Test-Health {
  try {
    $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return $null -ne $health -and $health.status -eq "ok"
  } catch {
    return $false
  }
}

Push-Location $Root
try {
  if (Test-Health) {
    Write-Host "DesignQA-AI is already running at $AppUrl" -ForegroundColor Green
    exit 0
  }

  $out = Join-Path $Root "dev.out.log"
  $err = Join-Path $Root "dev.err.log"

  Write-Host "Starting DesignQA-AI at $AppUrl" -ForegroundColor Cyan
  Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err

  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    if (Test-Health) {
      Write-Host "DesignQA-AI is ready at $AppUrl" -ForegroundColor Green
      exit 0
    }
  }

  Write-Host "Server did not become healthy within 20 seconds." -ForegroundColor Red
  Write-Host "Last stdout:"
  if (Test-Path $out) { Get-Content $out -Tail 40 }
  Write-Host "Last stderr:"
  if (Test-Path $err) { Get-Content $err -Tail 40 }
  exit 1
} finally {
  Pop-Location
}
