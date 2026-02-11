param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [switch]$Recurse,

  [int]$CpBase = 0,
  [int]$MaxGlyphs = 256,
  [int]$HeaderBytes = -1
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputDir)) {
  throw "InputDir not found: $InputDir"
}

if (-not (Test-Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$searchOpt = if ($Recurse) { "-Recurse" } else { "" }
$files = if ($Recurse) {
  Get-ChildItem -Path $InputDir -File -Recurse | Where-Object {
    $_.Extension -match "^\.(fnt|bin|rom|c64)$"
  }
} else {
  Get-ChildItem -Path $InputDir -File | Where-Object {
    $_.Extension -match "^\.(fnt|bin|rom|c64)$"
  }
}

if (-not $files -or $files.Count -eq 0) {
  Write-Host "No matching files found in $InputDir"
  exit 0
}

$ok = 0
$failed = 0

foreach ($f in $files) {
  $outName = [System.IO.Path]::GetFileNameWithoutExtension($f.Name) + ".json"
  $outPath = Join-Path $OutputDir $outName

  Write-Host "Converting $($f.FullName) -> $outPath"
  try {
    python tools/c64bin2osdjson.py `
      "$($f.FullName)" `
      "$outPath" `
      --cp-base $CpBase `
      --max-glyphs $MaxGlyphs `
      --header-bytes $HeaderBytes
    $ok++
  } catch {
    Write-Warning "Failed: $($f.FullName) :: $($_.Exception.Message)"
    $failed++
  }
}

Write-Host ""
Write-Host "Done. Success: $ok  Failed: $failed"
