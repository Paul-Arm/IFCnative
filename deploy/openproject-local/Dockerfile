# OpenProject 17.7.2 + Plugin "IFC Hub".
#
# Build-Kontext ist das Repo-Root (siehe docker-compose.yml), damit das
# Plugin aus openproject-plugin/ ins Image kopiert werden kann. Dieselbe
# Datei dient als Vorlage für das Server-Image.
#
# Zwei Ziele:
#   plugin  nur Ruby-Teil (Menüpunkt, Einbettung, Speichertyp) — baut in
#           Sekunden, das vorkompilierte Frontend des Images bleibt gültig.
#   full    zusätzlich OpenProjects Angular-Frontend neu gebaut, mit dem
#           Frontend-Teil des Plugins (Upload in den Speicher "IFC Hub").
#           Braucht mehrere GB RAM und dauert ~15–30 min.

FROM openproject/openproject:17.7.2 AS plugin

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
#
# db/schema_cache.yml (mit PostgreSQL erzeugt) muss währenddessen weg: der
# Precompile läuft gegen die Attrappe "nulldb" und kann den Cache nicht
# laden. Im offiziellen Build entsteht die Datei erst nach den Assets.
ARG NODE_HEAP_MB=6144
RUN cd /app \
 && rm -f config/frontend_assets.manifest.json \
 && mv db/schema_cache.yml /tmp/schema_cache.yml \
 && NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" DOCKER=1 ./docker/prod/setup/precompile-assets.sh \
 && mv /tmp/schema_cache.yml db/schema_cache.yml \
 && chown -R app:app public config/frontend_assets.manifest.json
