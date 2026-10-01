#!/usr/bin/env bash
# Spielt das OpenProject-Image mit Plugin "IFC Hub" in ein bestehendes
# offizielles Compose-Setup ein (auf dem OpenProject-Server, als root):
#
#   ./install-on-server.sh /tmp/openproject-ifc-hub_<tag>.tar.gz [/opt/openproject]
#
# Ablauf: Prüfsumme -> docker load -> Datenbank-Backup -> Override nach
# <dir> -> .env prüfen/Image eintragen -> docker compose up -d -> Health +
# Plugin prüfen. Zurück: ./rollback-on-server.sh [<dir>].
set -euo pipefail

archive=${1:?Aufruf: $0 <archiv.tar.gz> [compose-verzeichnis]}
dir=${2:-/opt/openproject}
here=$(cd "$(dirname "$0")" && pwd)

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFEHLER: %s\n' "$*" >&2; exit 1; }

[ -f "$dir/docker-compose.yml" ] || fail "$dir/docker-compose.yml nicht gefunden."
[ -f "$dir/.env" ] || fail "$dir/.env nicht gefunden."
[ -f "$here/docker-compose.override.yml" ] || fail "docker-compose.override.yml fehlt neben diesem Skript."
# Ein eigenes Override (nicht von uns) nie überschreiben — erst zusammenführen.
if [ -f "$dir/docker-compose.override.yml" ] && ! grep -q 'Plugin "IFC Hub"' "$dir/docker-compose.override.yml"; then
  fail "$dir/docker-compose.override.yml gibt es schon und stammt nicht von uns. Inhalt mit $here/docker-compose.override.yml zusammenführen, dann erneut starten."
fi

say "Prüfsumme"
if [ -f "$archive.sha256" ]; then
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
else
  echo "Keine $archive.sha256 — Prüfung übersprungen."
fi

say "Image laden (dauert eine Minute)"
image=$(docker load -i "$archive" | sed -n 's/^Loaded image: //p' | tail -1)
[ -n "$image" ] || fail "docker load hat kein Image gemeldet."
echo "$image"

cd "$dir"
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p backups

say "Datenbank sichern -> $dir/backups/openproject-$stamp.dump"
docker compose exec -T db sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" -Fc "${POSTGRES_DB:-openproject}"' \
  > "backups/openproject-$stamp.dump"
ls -lh "backups/openproject-$stamp.dump"
cp .env "backups/env-$stamp"
[ -f docker-compose.override.yml ] && cp docker-compose.override.yml "backups/docker-compose.override.yml-$stamp"

say ".env prüfen"
# Image-Tag setzen bzw. ersetzen; die übrigen Werte muss man selbst eintragen.
if grep -q '^IFC_HUB_OPENPROJECT_IMAGE=' .env; then
  sed -i "s|^IFC_HUB_OPENPROJECT_IMAGE=.*|IFC_HUB_OPENPROJECT_IMAGE=$image|" .env
else
  printf '\n# Plugin "IFC Hub" (deploy/openproject-server/.env.example)\nIFC_HUB_OPENPROJECT_IMAGE=%s\n' "$image" >> .env
fi
missing=()
for key in IFC_HUB_URL IFC_HUB_SHARED_SECRET IFC_HUB_SSRF_ALLOWLIST; do
  grep -q "^$key=." .env || missing+=("$key")
done
if [ "${#missing[@]}" -gt 0 ]; then
  fail "In $dir/.env fehlen: ${missing[*]} (Vorlage: .env.example). Danach dieses Skript erneut starten."
fi
secret=$(sed -n 's/^IFC_HUB_SHARED_SECRET=//p' .env)
[ "${#secret}" -ge 32 ] || fail "IFC_HUB_SHARED_SECRET ist kürzer als 32 Zeichen."

say "Override einspielen und Compose prüfen"
cp "$here/docker-compose.override.yml" docker-compose.override.yml
docker compose config -q
docker compose config | grep -E '^\s+image: .*ifc-hub' | sort -u

say "Starten (Seeder führt die Migrationen aus)"
docker compose up -d

say "Warten, bis web gesund ist"
web=$(docker compose ps -q web)
for _ in $(seq 1 60); do
  state=$(docker inspect -f '{{.State.Health.Status}}' "$web" 2>/dev/null || echo unknown)
  [ "$state" = healthy ] && break
  sleep 5
done
echo "web: $state"
docker compose logs --tail 15 seeder

say "Plugin prüfen"
docker compose exec -T web bash -c 'cd /app && bin/rails runner "
  plugin = Redmine::Plugin.all.find { |p| p.id.to_s == \"openproject_ifc_hub\" }
  puts \"Plugin: #{plugin ? plugin.version : %(FEHLT)}\"
  puts \"Konfiguriert: #{OpenProject::IfcHub::Configuration.configured?}\"
  puts \"frame-src: #{OpenProject::IfcHub::Configuration.frame_sources.join(%( ))}\"
  puts \"Tabelle ifc_hub_sync_links: #{ActiveRecord::Base.connection.table_exists?(:ifc_hub_sync_links)}\"
" 2>/dev/null'

[ "$state" = healthy ] || fail "web ist nicht gesund — Logs: docker compose logs web. Zurück: $here/rollback-on-server.sh $dir"
say "Fertig. Zurück jederzeit mit: $here/rollback-on-server.sh $dir"
