require "open_project/plugins"

module OpenProject::IfcHub
  class Engine < ::Rails::Engine
    engine_name :openproject_ifc_hub

    include OpenProject::Plugins::ActsAsOpEngine

    register "openproject-ifc_hub",
             author_url: "https://github.com/",
             bundled: false,
             settings: {} do
      # Die Rolle im Hub leitet sich aus diesen Rechten ab (siehe
      # IfcHub::EmbedController#hub_role): view -> viewer, edit -> contributor,
      # manage -> maintainer, OpenProject-Admin -> owner.
      project_module :ifc_hub do
        permission :view_ifc_hub,
                   { "ifc_hub/embed": %i[show sync_storage] },
                   permissible_on: :project
        permission :edit_ifc_hub,
                   {},
                   permissible_on: :project,
                   dependencies: %i[view_ifc_hub]
        permission :manage_ifc_hub,
                   {},
                   permissible_on: :project,
                   dependencies: %i[edit_ifc_hub]
      end

      menu :project_menu,
           :ifc_hub,
           { controller: "/ifc_hub/embed", action: "show" },
           caption: :label_ifc_hub,
           icon: "stack",
           after: :work_packages
    end

    # Speichertyp "IFC Hub" (Storages::IfcHubStorage) bei OpenProjects
    # Adapter-Registry anmelden. to_prepare: läuft nach allen Initializern
    # und nach jedem Neuladen im Entwicklungsmodus erneut.
    config.to_prepare do
      # Laden = registrieren: STI-Unterklasse (für Storage.provider_types)
      # und der CSP-Hook für die Einbettung.
      ::Storages::IfcHubStorage
      OpenProject::IfcHub::FrameSrcHook

      registry = ::Storages::Adapters::Registry
      unless registry.key?("ifc_hub.queries.files")
        registry.import(::Storages::Adapters::Providers::IfcHub::IfcHubRegistry)
      end

      # "Neuer Ordner" in der Ordnerauswahl auch für den IFC Hub.
      unless ::Storages::CreateFolderService.ancestors.include?(OpenProject::IfcHub::CreateFolderServicePatch)
        ::Storages::CreateFolderService.prepend(OpenProject::IfcHub::CreateFolderServicePatch)
      end

      # Abgleich mit dem Hub: neue/ersetzte IFC-Datei im BCF-Modul.
      unless ::Bim::IfcModels::IfcModel.include?(OpenProject::IfcHub::IfcModelSyncTrigger)
        ::Bim::IfcModels::IfcModel.include(OpenProject::IfcHub::IfcModelSyncTrigger)
      end
    end

    # Abgleich mit dem Hub: jede Änderung an einem Arbeitspaket (inkl.
    # Kommentare) erzeugt ein Journal.
    config.after_initialize do
      OpenProject::Notifications.subscribe(OpenProject::Events::JOURNAL_CREATED) do |payload|
        OpenProject::IfcHub::SyncTriggers.journal_created(payload)
      end
    end

    # Sicherheitsnetz, falls ein Webhook des Hubs verloren geht.
    add_cron_jobs do
      {
        "IfcHub::SyncAllJob": {
          cron: "*/5 * * * *",
          class: "IfcHub::SyncAllJob"
        }
      }
    end
  end
end
