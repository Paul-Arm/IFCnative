module IfcHub
  # Sicherheitsnetz (Cron, alle 5 min): stößt den Abgleich aller Projekte
  # mit aktivem Modul "IFC Hub" an — falls ein Webhook verloren ging.
  class SyncAllJob < ApplicationJob
    def perform
      Project.active
             .joins(:enabled_modules)
             .where(enabled_modules: { name: "ifc_hub" })
             .pluck(:id)
             .each { |id| SyncProjectJob.perform_later(id) }
    end
  end
end
