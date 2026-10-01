#!/usr/bin/env bash
# Zurück zum offiziellen OpenProject-Image (auf dem OpenProject-Server):
#
#   ./rollback-on-server.sh [/opt/openproject]
#
# Deaktiviert das Override (umbenannt, nicht gelöscht) und startet die
# Dienste mit dem Image aus docker-compose.yml neu. Die Plugin-Tabelle
# ifc_hub_sync_links bleibt in der Datenbank und stört OpenProject nicht.
# Ein Datenbank-Backup vom Einspielen liegt in <dir>/backups/.
set -euo pipefail

dir=${1:-/opt/openproject}
cd "$dir"

if [ -f docker-compose.override.yml ]; then
  mv docker-compose.override.yml "docker-compose.override.yml.disabled-$(date +%Y%m%d-%H%M%S)"
  echo "Override deaktiviert."
else
  echo "Kein docker-compose.override.yml aktiv."
fi

docker compose up -d
docker compose ps
echo
echo "Zurück auf dem offiziellen Image. Erneut einspielen: install-on-server.sh"
echo "Datenbank wiederherstellen (nur falls nötig):"
echo "  docker compose exec -T db sh -c 'pg_restore -U \"\${POSTGRES_USER:-postgres}\" -d \"\${POSTGRES_DB:-openproject}\" --clean --if-exists' < backups/<datei>.dump"
