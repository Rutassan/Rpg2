# Helper to run combat.ps1 via Invoke-Expression reading as UTF8 to avoid encoding issues
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$s = Get-Content -Raw -Encoding UTF8 -Path '.\combat.ps1'
Invoke-Expression $s
