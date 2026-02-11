param(
  [string]$InputDir = "fonts/data/atari",
  [string]$Output = "fonts/manifest-atari.json",
  [switch]$Recurse
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputDir)) {
  throw "Input directory not found: $InputDir"
}

$files = if ($Recurse) {
  Get-ChildItem -Path $InputDir -File -Filter *.json -Recurse
} else {
  Get-ChildItem -Path $InputDir -File -Filter *.json
}

if (-not $files -or $files.Count -eq 0) {
  throw "No .json files found in: $InputDir"
}

$items = foreach ($f in $files) {
  $j = Get-Content $f.FullName -Raw | ConvertFrom-Json

  $name = if ($j.PSObject.Properties.Name -contains "name" -and $j.name) {
    [string]$j.name
  } else {
    $f.BaseName
  }

  $cell = if ($j.PSObject.Properties.Name -contains "cell" -and $j.cell) {
    @($j.cell)
  } else {
    @(12, 18)
  }

  $glyphCount = 0
  if ($j.PSObject.Properties.Name -contains "glyphs" -and $j.glyphs) {
    $glyphCount = @($j.glyphs.PSObject.Properties).Count
  }

  [pscustomobject]@{
    id         = ($f.BaseName -replace '[^a-zA-Z0-9]+', '-').ToLower().Trim('-')
    file       = $f.Name
    name       = $name
    cell       = $cell
    glyphCount = $glyphCount
    hasUpper   = $true
    hasLower   = $true
    hasDigits  = $true
  }
}

$sorted = $items | Sort-Object name
$json = $sorted | ConvertTo-Json -Depth 8

$outDir = Split-Path -Parent $Output
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

Set-Content -Path $Output -Value $json -Encoding utf8
Write-Host "Wrote $Output with $($sorted.Count) entries from $InputDir"
