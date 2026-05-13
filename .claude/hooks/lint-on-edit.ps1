#!/usr/bin/env pwsh
# PostToolUse — lint automatique après chaque édition
if (Test-Path "package.json") {
    npx prettier --write . 2>$null
    npx eslint --fix . 2>$null
}
if (Test-Path "*.csproj") {
    dotnet format 2>$null
}
exit 0
