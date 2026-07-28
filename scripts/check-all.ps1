$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repositoryRoot
try {
  & npm.cmd run check
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop verification failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repositoryRoot "phone")
try {
  & .\gradlew.bat --no-daemon testDebugUnitTest lintDebug
  if ($LASTEXITCODE -ne 0) {
    throw "Android verification failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Push-Location (Join-Path $repositoryRoot "phone\cloudflare")
try {
  & npm.cmd run check
  if ($LASTEXITCODE -ne 0) {
    throw "Relay verification failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

Write-Host "Codex Usage Pet desktop, Android, and relay checks passed."
