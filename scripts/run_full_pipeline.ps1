<#
.SYNOPSIS
  Full pipeline: generate new words + re-enrich incomplete + enrich new words.
  Run from project root: .\scripts\run_full_pipeline.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Load .env ──────────────────────────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot '..' '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    $line = $line.Trim()
    if ($line -match '^([A-Z_][A-Z0-9_]*)=(.+)$') {
      [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
    }
  }
  Write-Host "[OK] Loaded .env"
} else {
  Write-Error ".env not found"
}

$env:GEMINI_MODEL = 'gemini-2.5-flash'

# ── Step 1: Generate new words ─────────────────────────────────────────────────
Write-Host ""
Write-Host "=== STEP 1: Generate new words (target: 3000 total) ==="
Remove-Item -ErrorAction SilentlyContinue "$PSScriptRoot\new_words_to_enrich.txt"
node "$PSScriptRoot\generate_words.js"
if ($LASTEXITCODE -ne 0) {
  Write-Warning "generate_words.js exited with code $LASTEXITCODE. Check output above."
}

# ── Step 2: Re-enrich 614 incomplete words ────────────────────────────────────
Write-Host ""
Write-Host "=== STEP 2: Re-enrich incomplete words ==="
$incompleteFile = "$PSScriptRoot\incomplete_words.txt"
if (Test-Path $incompleteFile) {
  $targetWords = (Get-Content $incompleteFile -Raw).Trim()
  Write-Host "Re-enriching $(($targetWords -split ',').Count) incomplete words..."
  $env:TARGET_WORDS = $targetWords
  node "$PSScriptRoot\enrich.js"
  Remove-Item -Variable 'env:TARGET_WORDS' -ErrorAction SilentlyContinue
  [System.Environment]::SetEnvironmentVariable('TARGET_WORDS', $null, 'Process')
} else {
  Write-Warning "incomplete_words.txt not found; skipping re-enrichment"
}

# ── Step 3: Enrich new words (auto-detected: not in enriched.json) ────────────
Write-Host ""
Write-Host "=== STEP 3: Enrich new words ==="
node "$PSScriptRoot\enrich.js"

# ── Step 4: Validate ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== STEP 4: Validate ==="
node "$PSScriptRoot\validate.js"
$validateExitCode = $LASTEXITCODE

# ── Step 5: Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== SUMMARY ==="
$w = Get-Content (Join-Path $PSScriptRoot '..' 'data' 'words.json') -Raw | ConvertFrom-Json
$levels = @{}
foreach ($prop in $w.PSObject.Properties) {
  $lvl = $prop.Value.level
  if (-not $lvl) { $lvl = 'none' }
  if ($levels.ContainsKey($lvl)) { $levels[$lvl]++ } else { $levels[$lvl] = 1 }
}
$total = ($levels.Values | Measure-Object -Sum).Sum
Write-Host "Total words: $total / 3000"
foreach ($lvl in 'A1','A2','B1','B2','C1') {
  $count = if ($levels.ContainsKey($lvl)) { $levels[$lvl] } else { 0 }
  Write-Host "  $lvl`: $count"
}

if ($validateExitCode -eq 0) {
  Write-Host "Validation: PASSED (0 errors)"
} else {
  Write-Warning "Validation: FAILED — run 'node scripts/validate.js' for details"
}
