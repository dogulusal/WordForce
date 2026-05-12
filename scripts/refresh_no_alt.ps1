param(
  [string]$ApiKey = $env:GEMINI_API_KEY,
  [int]$BatchSize = 50,
  [int]$MaxRounds = 5,
  [int]$TargetHighPolysemyMissingAlt = 0,
  [switch]$SkipValidate,
  [switch]$SkipAudit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($BatchSize -lt 1) {
  throw 'BatchSize must be >= 1'
}
if ($MaxRounds -lt 1) {
  throw 'MaxRounds must be >= 1'
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  throw 'Missing API key. Pass -ApiKey or set GEMINI_API_KEY in the shell.'
}

$previousApiKey = $env:GEMINI_API_KEY
$previousReEnrich = $env:REENRICH_NO_ALT
$previousMaxWords = $env:MAX_WORDS

try {
  $env:GEMINI_API_KEY = $ApiKey

  for ($round = 1; $round -le $MaxRounds; $round++) {
    Write-Host ""
    Write-Host "=== Re-enrich round $round/$MaxRounds ===" -ForegroundColor Cyan

    $env:REENRICH_NO_ALT = '1'
    $env:MAX_WORDS = [string]$BatchSize

    Write-Host ">> node scripts/enrich.js"
    node scripts/enrich.js
    if ($LASTEXITCODE -ne 0) {
      throw "enrich.js failed in round $round (exit code $LASTEXITCODE)"
    }

    if (-not $SkipValidate) {
      Write-Host ">> node scripts/validate.js"
      node scripts/validate.js
      if ($LASTEXITCODE -ne 0) {
        throw "validate.js failed in round $round (exit code $LASTEXITCODE)"
      }
    }

    if (-not $SkipAudit) {
      Write-Host ">> node scripts/audit_alt_coverage.js"
      node scripts/audit_alt_coverage.js
      if ($LASTEXITCODE -ne 0) {
        throw "audit_alt_coverage.js failed in round $round (exit code $LASTEXITCODE)"
      }

      $reportPath = Join-Path $PSScriptRoot '..\data\alt_meaning_coverage_report.json'
      if (Test-Path $reportPath) {
        $report = Get-Content $reportPath -Raw | ConvertFrom-Json
        $totals = $report.totals
        Write-Host (
          "Coverage: withAlt={0}, withoutAlt={1}, highPolyMissing={2}" -f
          $totals.wordsWithAltMeanings,
          $totals.wordsWithoutAltMeanings,
          $totals.highPolysemyMissingAlt
        ) -ForegroundColor Yellow

        if ([int]$totals.highPolysemyMissingAlt -le $TargetHighPolysemyMissingAlt) {
          Write-Host "Target reached: highPolysemyMissingAlt <= $TargetHighPolysemyMissingAlt" -ForegroundColor Green
          break
        }
      }
    }
  }

  Write-Host ""
  Write-Host 'Done.' -ForegroundColor Green
  Write-Host 'Tip: set a stricter target once coverage improves, e.g. -TargetHighPolysemyMissingAlt 100'
}
finally {
  if ($null -ne $previousApiKey) { $env:GEMINI_API_KEY = $previousApiKey } else { Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $previousReEnrich) { $env:REENRICH_NO_ALT = $previousReEnrich } else { Remove-Item Env:REENRICH_NO_ALT -ErrorAction SilentlyContinue }
  if ($null -ne $previousMaxWords) { $env:MAX_WORDS = $previousMaxWords } else { Remove-Item Env:MAX_WORDS -ErrorAction SilentlyContinue }
}
