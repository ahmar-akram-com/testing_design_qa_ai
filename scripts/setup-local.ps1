param(
  [switch]$Start
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required but was not found in PATH."
  }
}

function Invoke-Checked($File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

Push-Location $Root
try {
  Write-Step "Checking runtime"
  Assert-Command node
  Assert-Command npm

  $nodeVersion = (& node -p "process.versions.node").Trim()
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Found $nodeVersion."
  }
  Write-Host "Node.js $nodeVersion"

  Write-Step "Checking environment"
  if (-not (Test-Path ".env.local")) {
    Copy-Item ".env.example" ".env.local"
    Write-Warning ".env.local was created from .env.example. Add GEMINI_API_KEY and FIGMA_ACCESS_TOKEN before running QA."
  }

  $envText = Get-Content ".env.local" -Raw
  if ($envText -notmatch "(?m)^GEMINI_API_KEY=.+") {
    Write-Warning "GEMINI_API_KEY is missing in .env.local."
  }
  if ($envText -notmatch "(?m)^FIGMA_ACCESS_TOKEN=.+") {
    Write-Warning "FIGMA_ACCESS_TOKEN is missing in .env.local."
  }

  Write-Step "Installing npm dependencies"
  Invoke-Checked "npm.cmd" @("install", "--ignore-scripts")

  Write-Step "Checking Playwright Chromium"
  $playwrightChromium = (& node -e "process.stdout.write(require('playwright').chromium.executablePath())")
  if (Test-Path $playwrightChromium) {
    Write-Host "Playwright Chromium already installed."
  } else {
    Invoke-Checked "npx.cmd" @("playwright", "install", "chromium")
  }

  Write-Step "Running TypeScript check"
  Invoke-Checked "npm.cmd" @("run", "lint")

  Write-Step "Building app"
  Invoke-Checked "npm.cmd" @("run", "build")

  Write-Step "Testing Playwright launch"
  Invoke-Checked "node" @("-e", "const { chromium } = require('playwright'); (async()=>{ const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.goto('data:text/html,<title>ok</title>'); console.log(await page.title()); await browser.close(); })().catch(err=>{ console.error(err); process.exit(1); })")

  Write-Step "Local setup complete"
  Write-Host "Run npm run start:local, then open http://127.0.0.1:3000" -ForegroundColor Green

  if ($Start) {
    & "$PSScriptRoot\start-local.ps1"
  }
} finally {
  Pop-Location
}
