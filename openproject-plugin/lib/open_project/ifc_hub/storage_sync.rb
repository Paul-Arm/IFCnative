module OpenProject::IfcHub
  # Aktiviert den Speicher "IFC Hub" in einem Projekt, sobald es mit einem
  # Hub-Projekt verknüpft ist — Projektordner = dieses Hub-Projekt, damit
  # die Dateiauswahl direkt dort öffnet.
  #
  # Läuft beim Öffnen des Menüpunkts und direkt nach dem Verknüpfen
  # (postMessage "ifc-hub:linked" -> EmbedController#sync_storage).
  # Bewusst gesetzte Einstellungen bleiben: ein auf "inaktiv" gestellter
  # Projektordner wird nicht überschrieben, nur ein veralteter Hub-Ordner.
  module StorageSync
    module_function

    def call(project)
      storage = ::Storages::IfcHubStorage.order(:id).find(&:configured?)
      return unless storage

      auth = ::Storages::Adapters::Registry["ifc_hub.authentication.userless"].call
      ::Storages::Adapters::Providers::IfcHub::Queries::ProjectLinkQuery
        .call(storage:, auth_strategy: auth, input_data: project.id)
        .either(
          ->(link) { ensure_project_storage(project, storage, link[:location]) },
          ->(_error) { nil }
        )
    rescue StandardError => e
      Rails.logger.warn("IFC Hub: Speicher-Abgleich für #{project.identifier} fehlgeschlagen: #{e.message}")
      nil
    end

    def ensure_project_storage(project, storage, folder)
      project_storage = ::Storages::ProjectStorage.find_or_initialize_by(project:, storage:)
      if project_storage.persisted?
        # Nur einen veralteten Hub-Ordner nachführen (z. B. nach Neu-Verknüpfung).
        return project_storage unless project_storage.project_folder_manual?
        return project_storage if project_storage.project_folder_id == folder
      end

      project_storage.creator ||= User.system
      project_storage.project_folder_mode = "manual"
      project_storage.project_folder_id = folder
      project_storage.save!
      project_storage
    end
  end
end
