$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "..\scripts\team_skills.py"

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $scriptPath @args
} else {
    & python $scriptPath @args
}
exit $LASTEXITCODE
