# OpenProject + Plugin "IFC Hub".
#
# Build-Kontext ist das Repo-Root, damit das Plugin aus openproject-plugin/
# ins Image kopiert werden kann. Ziele:
#
#   plugin  All-in-one-Image, nur Ruby-Teil (Menüpunkt, Einbettung,
#           Speichertyp, Abgleich) — baut in Sekunden, das vorkompilierte
#           Frontend des Images bleibt gültig (Upload aus OpenProject fehlt).
#   full    All-in-one-Image mit neu gebautem Angular-Frontend (Frontend-
#           Teil des Plugins: Upload, Commit-Dialog). Lokale Testumgebung.
#   server  wie "full", aber auf Basis des -slim-bim-Images für das offizielle
#           Compose-Setup (getrennte Datenbank, Proxy, Worker, Cron). Das
#           Frontend wird in "full" gebaut und nur kopiert (slim-Images haben
#           keine Build-Werkzeuge). Gebaut von deploy/openproject-server/build-image.ps1.
#
# Der Angular-Build braucht mehrere GB RAM (Docker-Speicher entsprechend
# einstellen) und dauert je nach Rechner 5–30 min.

ARG OPENPROJECT_VERSION=17.7.2
# Basis des Ziels "server"; siehe dort.
ARG SERVER_BASE_FLAVOR=slim-bim

FROM openproject/openproject:${OPENPROJECT_VERSION} AS plugin
ARG OPENPROJECT_VERSION

# Patch-Serie für OpenProject (patches/openproject-<Version>/, Branch
# ifc-hub/v<Version>): Erweiterungspunkte, die das Plugin nutzt, der Reihe
# nach auf die Quellen des offiziellen Images. Passt einer nicht (OpenProject
# geändert), bricht der Build hier ab — siehe patches/README.md. Geänderte
# Dateien außerhalb von frontend/ landen in /tmp/patched für das slim-Image
# (dort fehlen git/patch und das Frontend kommt fertig gebaut).
COPY deploy/openproject-local/patches/openproject-${OPENPROJECT_VERSION}/ /tmp/openproject-patches/
RUN cd /app \
 && for p in /tmp/openproject-patches/*.patch; do \
      git apply --check "$p" && git apply "$p" || exit 1; \
    done \
 && mkdir -p /tmp/patched \
 && for p in /tmp/openproject-patches/*.patch; do git apply --numstat "$p"; done \
    | awk '{print $3}' | sort -u | grep -v '^frontend/' \
    | xargs -r -I{} cp --parents {} /tmp/patched/

COPY --chown=app:app openproject-plugin /app/vendored-plugins/openproject-ifc_hub
COPY --chown=app:app deploy/openproject-local/Gemfile.plugins /app/Gemfile.plugins

# Gemfile.lock um das Plugin erweitern (keine eigenen Gems).
RUN cd /app \
 && bundle config unset --local deployment \
 && bundle install \
 && bundle config set --local deployment true \
 && chown app:app Gemfile.lock

FROM plugin AS full

# Ohne Manifest baut precompile-assets.sh das Frontend neu; dabei verlinkt
# openproject:plugins:register_frontend frontend/module des Plugins in die
# Angular-App. DOCKER=1 räumt node_modules & Caches im selben Layer weg.
# Das alte Frontend-Bundle kommt vorher weg, sonst liegen beide im Image.
#
# db/schema_cache.yml (mit PostgreSQL erzeugt) muss währenddessen weg: der
# Precompile läuft gegen die Attrappe "nulldb" und kann den Cache nicht
# laden. Im offiziellen Build entsteht die Datei erst nach den Assets.
ARG NODE_HEAP_MB=6144
RUN cd /app \
 && rm -rf config/frontend_assets.manifest.json public/assets/frontend \
 && mv db/schema_cache.yml /tmp/schema_cache.yml \
 && NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" DOCKER=1 ./docker/prod/setup/precompile-assets.sh \
 && mv /tmp/schema_cache.yml db/schema_cache.yml \
 && chown -R app:app public config/frontend_assets.manifest.json

# Frontend für das slim-Image ausdünnen wie dessen offizieller Build
# (docker/prod/setup/prune-slim-runtime.sh): ohne Sourcemaps und Lookbook.
FROM full AS server-assets
RUN cd /app/public/assets \
 && find . -type f -name '*.map' -delete \
 && rm -rf lookbook

# "slim-bim" = slim mit BIM-Edition und IFC-Konvertern (IfcConvert, xeokit)
# — ohne die kann OpenProject IFC-Modelle (auch aus dem Hub-Abgleich) nicht
# anzeigen. Das einfache "slim" enthält sie nicht.
FROM openproject/openproject:${OPENPROJECT_VERSION}-${SERVER_BASE_FLAVOR} AS server

# Plugin-Quellen und die um das Plugin erweiterte Gemfile.lock (beide
# Basis-Images haben dieselbe). Das Plugin ist ein Pfad-Gem ohne eigene
# Abhängigkeiten — installiert werden muss nichts, bundle check prüft das.
COPY --chown=app:app openproject-plugin /app/vendored-plugins/openproject-ifc_hub
COPY --chown=app:app deploy/openproject-local/Gemfile.plugins /app/Gemfile.plugins
COPY --from=full --chown=app:app /app/Gemfile.lock /app/Gemfile.lock

# Vom Fork-Patch geänderte Ruby-Dateien (siehe Stufe "plugin").
COPY --from=full --chown=app:app /tmp/patched/ /app/

# Das in "full" gebaute Frontend (inkl. Frontend-Teil des Plugins und der
# exportierten JS-Übersetzungen).
COPY --from=server-assets --chown=app:app /app/public/assets /app/public/assets
COPY --from=full --chown=app:app /app/config/frontend_assets.manifest.json /app/config/frontend_assets.manifest.json

RUN cd /app && bundle check

# Herkunft des Images (setzt das Build-Skript); überschreibt die vom
# Basis-Image geerbten Labels, die sonst auf dessen Build zeigen.
ARG OPENPROJECT_VERSION
ARG SERVER_BASE_FLAVOR
ARG IFC_HUB_IMAGE_VERSION=dev
ARG IFC_HUB_REVISION=unknown
ARG IFC_HUB_BUILD_DATE=unknown
LABEL org.opencontainers.image.title="OpenProject mit Plugin IFC Hub" \
      org.opencontainers.image.description="OpenProject ${OPENPROJECT_VERSION} (${SERVER_BASE_FLAVOR}) mit Plugin openproject-ifc_hub" \
      org.opencontainers.image.vendor="IFCnative" \
      org.opencontainers.image.version="${IFC_HUB_IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IFC_HUB_REVISION}" \
      org.opencontainers.image.created="${IFC_HUB_BUILD_DATE}" \
      org.opencontainers.image.base.name="openproject/openproject:${OPENPROJECT_VERSION}-${SERVER_BASE_FLAVOR}"
