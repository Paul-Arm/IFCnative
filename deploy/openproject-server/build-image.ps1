<#
.SYNOPSIS
  Baut lokal das OpenProject-Image mit Plugin "IFC Hub" für den Server.

.DESCRIPTION
  Ziel "server" aus deploy/openproject-local/Dockerfile: offizielles
  openproject/openproject:<Version>-slim-bim + Plugin + neu gebautes Frontend.
  Passt in das offizielle Compose-Setup (opf/openproject-docker-compose);
  dort nur das Image tauschen (docker-compose.override.yml daneben).

  Der Angular-Build braucht einige GB RAM in Docker und 5–30 min; spätere
  Builds ohne Änderungen am Plugin kommen aus dem Cache.

  Tag (Standard): <OpenProject-Version>-ifchub-<Git-Commit>, bei
  uncommitteten Änderungen an Plugin/Dockerfile zusätzlich "-dirty".

  Auf den Server kommt das Image per Registry (-Registry … -Push) oder als
  Datei (-Export: gzip-Archiv für "docker load").

.EXAMPLE
  ./deploy/openproject-server/build-image.ps1 -Export

.EXAMPLE
  ./deploy/openproject-server/build-image.ps1 -Registry registry.example.local:5000 -Push
#>
[CmdletBinding()]
param(
  # OpenProject-Version des Basis-Images; bei jedem OpenProject-Update neu bauen.
  [string]$OpenProjectVersion = "17.7.2",
  # Basis-Variante: slim-bim (mit IFC-Konvertern) oder slim (ohne BIM-Werkzeuge).
  [ValidateSet("slim-bim", "slim")]
  [string]$BaseFlavor = "slim-bim",
  [string]$Image = "ifcnative/openproject-ifc-hub",
  # Registry-Host (z. B. registry.example.local:5000); leer = nur lokal.
  [string]$Registry = "",
  # Eigener Tag statt <Version>-ifchub-<Commit>.
  [string]$Tag = "",
  # Node-Heap für den Angular-Build (MB), muss in den Docker-Speicher passen.
  [int]$NodeHeapMb = 6144,
  # Nach dem Build in die Registry schieben (braucht -Registry).
  [switch]$Push,
  # Nach dem Build als .tar.gz für "docker load" speichern.
  [switch]$Export,
  [string]$ExportDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$dockerfile = Join-Path $repoRoot "deploy/openproject-local/Dockerfile"

function Invoke-Docker {
  param([string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($Arguments[0]) fehlgeschlagen (Exit $LASTEXITCODE)"
  }
}

if ($Push -and -not $Registry) {
  # Ohne Registry-Host ginge der Push an Docker Hub — nie ungewollt.
  throw "-Push braucht -Registry <host[:port]>."
}

$revision = (git -C $repoRoot rev-parse HEAD).Trim()
$shortRevision = $revision.Substring(0, 7)
$dirty = [bool](git -C $repoRoot status --porcelain -- openproject-plugin deploy/openproject-local)
if (-not $Tag) {
  $Tag = "$OpenProjectVersion-ifchub-$shortRevision"
  if ($dirty) { $Tag += "-dirty" }
}
if ($dirty) {
  Write-Warning "Uncommittete Änderungen an Plugin oder Dockerfile — das Image entspricht nicht Commit $shortRevision."
}

$repository = if ($Registry) { "$($Registry.TrimEnd('/'))/$Image" } else { $Image }
$ref = "${repository}:$Tag"

Write-Host "==> Baue $ref (OpenProject $OpenProjectVersion-$BaseFlavor, Commit $shortRevision)" -ForegroundColor Cyan
$started = Get-Date
Invoke-Docker @(
  "build",
  "--file", $dockerfile,
  "--target", "server",
  "--platform", "linux/amd64",
  "--build-arg", "OPENPROJECT_VERSION=$OpenProjectVersion",
  "--build-arg", "SERVER_BASE_FLAVOR=$BaseFlavor",
  "--build-arg", "NODE_HEAP_MB=$NodeHeapMb",
  "--build-arg", "IFC_HUB_IMAGE_VERSION=$Tag",
  "--build-arg", "IFC_HUB_REVISION=$revision",
  "--build-arg", "IFC_HUB_BUILD_DATE=$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))",
  "--tag", $ref,
  $repoRoot
)
$size = [math]::Round(((docker image inspect $ref --format "{{.Size}}") -as [double]) / 1MB)
Write-Host ("==> Fertig nach {0:mm\:ss} min, {1} MB" -f ((Get-Date) - $started), $size) -ForegroundColor Green

if ($Push) {
  Write-Host "==> Push nach $Registry" -ForegroundColor Cyan
  Invoke-Docker @("push", $ref)
}

$archive = $null
if ($Export) {
  if (-not $ExportDir) { $ExportDir = Join-Path $PSScriptRoot "dist" }
  New-Item -ItemType Directory -Force $ExportDir | Out-Null
  $baseName = "openproject-ifc-hub_$Tag"
  $tar = Join-Path $ExportDir "$baseName.tar"
  $archive = "$tar.gz"
  Write-Host "==> Exportiere nach $archive" -ForegroundColor Cyan
  Invoke-Docker @("save", "--output", $tar, $ref)
  # docker save kann kein gzip; docker load liest .tar.gz direkt.
  $in = [System.IO.File]::OpenRead($tar)
  try {
    $out = [System.IO.File]::Create($archive)
    try {
      $gzip = [System.IO.Compression.GZipStream]::new($out, [System.IO.Compression.CompressionLevel]::Optimal)
      try { $in.CopyTo($gzip) } finally { $gzip.Dispose() }
    } finally { $out.Dispose() }
  } finally { $in.Dispose() }
  Remove-Item $tar
  $hash = (Get-FileHash -Algorithm SHA256 $archive).Hash.ToLowerInvariant()
  Set-Content -Path "$archive.sha256" -Value "$hash  $(Split-Path -Leaf $archive)" -Encoding ascii -NoNewline
  Write-Host ("==> {0} MB, SHA-256 {1}" -f [math]::Round((Get-Item $archive).Length / 1MB), $hash) -ForegroundColor Green
}

Write-Host ""
Write-Host "Auf dem Server in der .env des OpenProject-Compose setzen:" -ForegroundColor Cyan
Write-Host "  IFC_HUB_OPENPROJECT_IMAGE=$ref"
if ($archive) {
  $leaf = Split-Path -Leaf $archive
  Write-Host ""
  Write-Host "Übertragen und laden:" -ForegroundColor Cyan
  Write-Host "  scp `"$archive`" `"$archive.sha256`" <server>:/tmp/"
  Write-Host "  ssh <server> 'cd /tmp && sha256sum -c $leaf.sha256 && docker load -i $leaf'"
} elseif ($Push) {
  Write-Host "  (Registry-Image; docker compose pull holt es mit IFC_HUB_PULL_POLICY=missing)"
}
Write-Host ""
Write-Host "Lokal prüfen: ./deploy/openproject-server/smoke-test.ps1 -ImageRef $ref"
