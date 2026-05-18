param(
  [string]$ApiKey = $env:GEMINI_API_KEY,
  [string]$ApiKeys = $env:GEMINI_API_KEYS,
  [int]$BatchSize = 50,
  [int]$MaxRounds = 5,
  [int]$TargetHighPolysemyMissingAlt = 0,
  [switch]$SkipValidate,
  [switch]$SkipAudit,
  [switch]$ValidateEveryRound
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($BatchSize -lt 1) {
  throw 'BatchSize must be >= 1'
}
if ($MaxRounds -lt 1) {
  throw 'MaxRounds must be >= 1'
}

$previousApiKey = $env:GEMINI_API_KEY
$previousApiKeys = $env:GEMINI_API_KEYS
$previousReEnrich = $env:REENRICH_NO_ALT
$previousMaxWords = $env:MAX_WORDS
$previousTargetWords = $env:TARGET_WORDS

function Get-EnvFileValue {
  param(
    [string]$Path,
    [string[]]$Names
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $lines = Get-Content $Path -ErrorAction SilentlyContinue
  foreach ($name in $Names) {
    $pattern = "^{0}\s*=\s*(.+)$" -f [regex]::Escape($name)
    $match = $lines | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if ($match -and $match -match $pattern) {
      return $Matches[1].Trim()
    }
  }

  return $null
}

function Resolve-ApiKeyList {
  param(
    [string]$InlineApiKey,
    [string]$InlineApiKeys
  )

  $apiKeyList = @()

  if (-not [string]::IsNullOrWhiteSpace($InlineApiKeys)) {
    $apiKeyList = @(
      $InlineApiKeys -split '[,;\r\n]+' |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
    )
  }

  if ($apiKeyList.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($InlineApiKey)) {
    $apiKeyList = @($InlineApiKey.Trim())
  }

  if ($apiKeyList.Count -eq 0) {
    $envFilePath = Join-Path $PSScriptRoot '..\.env'
    $envKeys = Get-EnvFileValue -Path $envFilePath -Names @('GEMINI_API_KEYS', 'GEMINI_API_KEY', 'API_KEY')
    if (-not [string]::IsNullOrWhiteSpace($envKeys)) {
      $apiKeyList = @(
        $envKeys -split '[,;\r\n]+' |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ }
      )
    }
  }

  return @($apiKeyList | Select-Object -Unique)
}

function Get-TargetWordsFromCoverageReport {
  param(
    [int]$Limit,
    [int]$Threshold
  )

  $reportPath = Join-Path $PSScriptRoot '..\data\alt_meaning_coverage_report.json'
  if (-not (Test-Path $reportPath)) {
    return @()
  }

  try {
    $report = Get-Content $reportPath -Raw | ConvertFrom-Json
    $targets = @($report.highPolysemyMissingAlt | Sort-Object @{ Expression = { [int]$_.wordnetSenseCount }; Descending = $true }, @{ Expression = { [string]$_.word }; Descending = $false })
    if ($Threshold -gt 0) {
      $targets = @($targets | Where-Object { [int]$_.wordnetSenseCount -ge $Threshold })
    }
    if ($Limit -gt 0) {
      $targets = @($targets | Select-Object -First $Limit)
    }
    return @($targets | ForEach-Object { $_.word })
  } catch {
    Write-Host 'Coverage report could not be read for targeting; falling back to sequential selection.' -ForegroundColor Yellow
    return @()
  }
}

try {
  $apiKeyList = Resolve-ApiKeyList -InlineApiKey $ApiKey -InlineApiKeys $ApiKeys

  if ($apiKeyList.Count -eq 0) {
    throw 'Missing API key(s). Pass -ApiKey, -ApiKeys, or set GEMINI_API_KEY/GEMINI_API_KEYS in the shell or .env.'
  }

  $env:GEMINI_API_KEY = $apiKeyList[0]
  $env:GEMINI_API_KEYS = ($apiKeyList -join ',')

  for ($round = 1; $round -le $MaxRounds; $round++) {
    Write-Host ""
    Write-Host "=== Re-enrich round $round/$MaxRounds ===" -ForegroundColor Cyan

    $env:REENRICH_NO_ALT = '1'
    $targetWords = Get-TargetWordsFromCoverageReport -Limit $BatchSize -Threshold 3
    if ($targetWords.Count -gt 0) {
      $env:TARGET_WORDS = ($targetWords -join ',')
      Remove-Item Env:MAX_WORDS -ErrorAction SilentlyContinue
      Write-Host ("Targeting {0} high-priority words from coverage report." -f $targetWords.Count) -ForegroundColor Yellow
    } else {
      $env:MAX_WORDS = [string]$BatchSize
      Remove-Item Env:TARGET_WORDS -ErrorAction SilentlyContinue
      Write-Host ("Targeting the next {0} words in sequential order." -f $BatchSize) -ForegroundColor Yellow
    }

    Write-Host ">> node scripts/enrich.js"
    node scripts/enrich.js
    if ($LASTEXITCODE -ne 0) {
      throw "enrich.js failed in round $round (exit code $LASTEXITCODE)"
    }

    $shouldValidateNow = -not $SkipValidate -and ($ValidateEveryRound -or $round -eq $MaxRounds)
    if ($shouldValidateNow) {
      Write-Host ">> node scripts/validate.js"
      node scripts/validate.js
      if ($LASTEXITCODE -ne 0) {
        throw "validate.js failed in round $round (exit code $LASTEXITCODE)"
      }
    }

    $shouldAuditNow = -not $SkipAudit -and ($ValidateEveryRound -or $round -eq $MaxRounds)
    if ($shouldAuditNow) {
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
  Write-Host 'Tip: use -ValidateEveryRound only when you want strict per-round checks.'
}
finally {
  if ($null -ne $previousApiKey) { $env:GEMINI_API_KEY = $previousApiKey } else { Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue }
  if ($null -ne $previousApiKeys) { $env:GEMINI_API_KEYS = $previousApiKeys } else { Remove-Item Env:GEMINI_API_KEYS -ErrorAction SilentlyContinue }
  if ($null -ne $previousReEnrich) { $env:REENRICH_NO_ALT = $previousReEnrich } else { Remove-Item Env:REENRICH_NO_ALT -ErrorAction SilentlyContinue }
  if ($null -ne $previousMaxWords) { $env:MAX_WORDS = $previousMaxWords } else { Remove-Item Env:MAX_WORDS -ErrorAction SilentlyContinue }
  if ($null -ne $previousTargetWords) { $env:TARGET_WORDS = $previousTargetWords } else { Remove-Item Env:TARGET_WORDS -ErrorAction SilentlyContinue }
}
