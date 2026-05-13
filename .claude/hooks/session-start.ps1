#!/usr/bin/env pwsh
# SessionStart — charge automatiquement l'index mémoire global + état projet courant

$globalIndex = "$env:USERPROFILE\.claude\memory\INDEX.md"
$projectState = "memory\PROJECT_STATE.md"

$output = @()

if (Test-Path $globalIndex) {
    $output += "=== MEMOIRE GLOBALE (INDEX) ==="
    $output += Get-Content $globalIndex -Raw
    $output += ""
}

if (Test-Path $projectState) {
    $output += "=== ETAT PROJET COURANT ==="
    $output += Get-Content $projectState -Raw
    $output += ""
    $output += ">>> Pour charger plus de contexte : @memoria charge le contexte du projet"
    $output += ">>> Pour mettre a jour apres la session : @memoria mets a jour la memoire"
}

if ($output.Count -gt 0) {
    $output | Out-String
}

exit 0
