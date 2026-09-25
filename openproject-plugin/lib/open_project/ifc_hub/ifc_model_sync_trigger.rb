module OpenProject::IfcHub
  # In Bim::IfcModels::IfcModel eingebunden (Engine): neue/ersetzte IFC-Datei
  # im BCF-Modul -> Abgleich mit dem Hub.
  module IfcModelSyncTrigger
    extend ActiveSupport::Concern

    included do
      after_commit { OpenProject::IfcHub::SyncTriggers.enqueue(project_id) }
    end
  end
end
