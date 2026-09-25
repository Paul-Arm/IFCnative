# Rauchtest im laufenden Server-Image (von ../smoke-test.ps1 aufgerufen):
#
#   docker compose exec -T web bash -c "cd /app && bin/rails runner -" < check.rb
#
# Prüft, was nur im fertigen Image schiefgehen kann: Plugin geladen,
# Migration gelaufen, Speichertyp und Cron-Job registriert, BIM-Werkzeuge
# vorhanden, Frontend-Bundle mit dem Plugin-Teil. Exit 1 bei einem Fehler.
checks = {}

plugin = Redmine::Plugin.all.find { |p| p.id.to_s == "openproject_ifc_hub" }
checks["Plugin geladen (#{plugin&.version})"] = plugin.present?
checks["Rechte view/edit/manage_ifc_hub"] =
  %i[view_ifc_hub edit_ifc_hub manage_ifc_hub].all? { |p| OpenProject::AccessControl.permission(p).present? }
checks["Projektmodul ifc_hub"] = OpenProject::AccessControl.available_project_modules.include?(:ifc_hub)
checks["Konfiguration (IFC_HUB_URL, Secret)"] = OpenProject::IfcHub::Configuration.configured?
checks["Migration: Tabelle ifc_hub_sync_links"] =
  ActiveRecord::Base.connection.table_exists?(IfcHub::SyncLink.table_name)
checks["Speichertyp ifc_hub"] = Storages::Storage.provider_types[:ifc_hub] == Storages::IfcHubStorage
checks["Cron-Job IfcHub::SyncAllJob"] =
  Rails.application.config.good_job.cron.values.any? { |job| job[:class].to_s == "IfcHub::SyncAllJob" }
checks["BIM-Edition"] = ENV["OPENPROJECT_EDITION"] == "bim"
checks["IFC-Konverter (IfcConvert, xeokit-metadata)"] =
  %w[IfcConvert xeokit-metadata].all? { |tool| system("command -v #{tool} > /dev/null") }

manifest = JSON.parse(Rails.root.join("config/frontend_assets.manifest.json").read)
main_js = Rails.public_path.join("assets/frontend", manifest.fetch("main.js"))
checks["Frontend-Bundle #{main_js.basename} mit Plugin-Teil"] =
  main_js.exist? && main_js.read.include?("Storages::IfcHubStorage")

width = checks.keys.map(&:length).max
checks.each { |name, ok| puts "#{ok ? 'OK    ' : 'FEHLER'} #{name.ljust(width)}" }
exit(checks.values.all? ? 0 : 1)
