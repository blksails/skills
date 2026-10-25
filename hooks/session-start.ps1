$ErrorActionPreference = "SilentlyContinue"
& (Join-Path $PSScriptRoot "..\bin\team-skills.ps1") check-update
& (Join-Path $PSScriptRoot "..\bin\team-skills.ps1") check-policy
exit 0
