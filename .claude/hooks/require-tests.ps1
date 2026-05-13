#!/usr/bin/env pwsh
# Stop — force Claude à runner les tests avant de déclarer "fini"
$changed = git diff --name-only HEAD 2>$null
$srcChanged = $changed | Where-Object { $_ -match '^(src|app|api|lib)/' }

if ($srcChanged -and -not (Test-Path ".claude\last-test-run")) {
    Write-Error "Lance les tests avant de terminer (npm test / dotnet test / pytest)"
    exit 2
}
exit 0
