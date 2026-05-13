#!/usr/bin/env pwsh
# PreToolUse — bloque les suppressions dangereuses
$input_data = $input | ConvertFrom-Json
$cmd = $input_data.tool_input.command

if ($cmd -match 'rm\s+-[rRfF]+\s+(/|~|\.\.)|Remove-Item\s+-Recurse\s+-Force\s+[/\\]') {
    Write-Error "BLOCKED: suppression dangereuse détectée"
    exit 2
}
exit 0
