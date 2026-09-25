<#
.SYNOPSIS
  Rauchtest für das Server-Image vor dem Rollout.

.DESCRIPTION
  Startet das Image wie das offizielle Compose (Postgres, Seeder mit
  Migrationen, Web, Worker; smoke/docker-compose.yml) mit leerer Datenbank
  und prüft:
    - Seeder und Migrationen (auch die des Plugins) laufen durch,
    - Web wird gesund (/health_checks/default),
    - im Image: Plugin, Rechte, Projektmodul, Speichertyp, Cron-Job,
      BIM-Werkzeuge, Frontend-Bundle (smoke/check.rb),
    - über HTTP: ausgeliefertes Frontend enthält den Plugin-Teil, der
      Webhook des Plugins ist erreichbar und lehnt fremde Aufrufe ab.
  Danach wird alles wieder entfernt (außer mit -Keep).

.EXAMPLE
  ./deploy/openproject-server/smoke-test.ps1 -ImageRef ifcnative/openproject-ifc-hub:17.7.2-ifchub-abc1234
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$ImageRef,
  [int]$Port = 8090,
  [int]$TimeoutSeconds = 600,
  # Umgebung stehen lassen (http://localhost:<Port>, admin/admin); Abbau
  # später mit: docker compose -p ifc-hub-op-smoke down -v
  [switch]$Keep
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$composeFile = Join-Path $PSScriptRoot "smoke/docker-compose.yml"
$checkScript = Join-Path $PSScriptRoot "smoke/check.rb"
$baseUrl = "http://localhost:$Port"

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose -f $composeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($Arguments[0]) fehlgeschlagen (Exit $LASTEXITCODE)" }
}

function Get-Status {
  param([string]$Url, [string]$Method = "GET")
  try {
    (Invoke-WebRequest -Uri $Url -Method $Method -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 10).StatusCode
  } catch {
    # HTTP-Fehler tragen die Antwort, Verbindungsfehler nicht (-> 0).
    $response = $_.Exception.PSObject.Properties["Response"]
    if ($response -and $response.Value) { [int]$response.Value.StatusCode } else { 0 }
  }
}

$results = [ordered]@{}
function Add-Result([string]$Name, [bool]$Ok) {
  $results[$Name] = $Ok
  Write-Host ("{0} {1}" -f $(if ($Ok) { "OK    " } else { "FEHLER" }), $Name) -ForegroundColor $(if ($Ok) { "Green" } else { "Red" })
}

docker image inspect $ImageRef --format "{{.Id}}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Image $ImageRef gibt es lokal nicht — erst build-image.ps1 ausführen." }

$env:IFC_HUB_OPENPROJECT_IMAGE = $ImageRef
$env:SMOKE_SECRET_KEY_BASE = New-Secret
$env:SMOKE_SHARED_SECRET = New-Secret
$env:SMOKE_PORT = "$Port"

$failed = $true
try {
  Write-Host "==> Starte $ImageRef (Seeder + Migrationen, danach Web und Worker)" -ForegroundColor Cyan
  $started = Get-Date
  # up wartet, bis der Seeder erfolgreich beendet ist (depends_on).
  Invoke-Compose @("up", "-d", "web", "worker")
  Add-Result "Seeder/Migrationen ($([math]::Round(((Get-Date) - $started).TotalSeconds)) s)" $true

  Write-Host "==> Warte auf $baseUrl/health_checks/default" -ForegroundColor Cyan
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $health = Get-Status "$baseUrl/health_checks/default"
    if ($health -eq 200) { break }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  Add-Result "Web gesund (HTTP $health)" ($health -eq 200)
  if ($health -ne 200) { throw "Web wurde nicht gesund." }

  Write-Host "==> Prüfungen im Image (check.rb)" -ForegroundColor Cyan
  Get-Content -Raw $checkScript | & docker compose -f $composeFile exec -T web bash -c "cd /app && bin/rails runner -"
  Add-Result "Prüfungen im Image" ($LASTEXITCODE -eq 0)

  Write-Host "==> Prüfungen über HTTP" -ForegroundColor Cyan
  $login = Invoke-WebRequest -Uri "$baseUrl/login" -UseBasicParsing -TimeoutSec 30
  $mainJs = [regex]::Match($login.Content, '/assets/frontend/main-[A-Z0-9]+\.js').Value
  $bundleOk = $false
  if ($mainJs) {
    $bundle = Invoke-WebRequest -Uri "$baseUrl$mainJs" -UseBasicParsing -TimeoutSec 60
    $bundleOk = $bundle.Content.Contains("Storages::IfcHubStorage")
  }
  Add-Result "Ausgeliefertes Frontend $mainJs mit Plugin-Teil" $bundleOk
  $webhook = Get-Status "$baseUrl/ifc_hub/webhook" "POST"
  Add-Result "Webhook /ifc_hub/webhook lehnt Aufruf ohne Token ab (HTTP $webhook)" ($webhook -eq 401)

  $worker = (& docker compose -f $composeFile ps worker --format "{{.State}}").Trim()
  Add-Result "Worker läuft ($worker)" ($worker -eq "running")

  $failed = @($results.Values | Where-Object { -not $_ }).Count -gt 0
} catch {
  Write-Host "FEHLER $($_.Exception.Message)" -ForegroundColor Red
} finally {
  if ($failed) {
    Write-Host "==> Letzte Log-Zeilen" -ForegroundColor Yellow
    & docker compose -f $composeFile logs --no-color --tail 40 seeder web worker
  }
  if ($Keep) {
    Write-Host "Umgebung läuft weiter: $baseUrl (admin/admin). Abbau: docker compose -p ifc-hub-op-smoke down -v"
  } else {
    & docker compose -f $composeFile down -v --remove-orphans 2>&1 | Out-Null
  }
}

if ($failed) {
  Write-Host "==> Rauchtest FEHLGESCHLAGEN" -ForegroundColor Red
  exit 1
}
Write-Host "==> Rauchtest bestanden: $ImageRef" -ForegroundColor Green
