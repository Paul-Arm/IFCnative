module OpenProject::IfcHub
  # Änderungen in OpenProject (IFC-Modell, Arbeitspaket-Journal) stoßen den
  # Abgleich an — leicht verzögert, damit zusammenhängende Änderungen (z. B.
  # BCF-Import: Arbeitspaket, dann Thema, dann Viewpoint) in einem Lauf landen.
  module SyncTriggers
    DELAY = 10.seconds

    module_function

    def enqueue(project_id)
      return if OpenProject::IfcHub.syncing? || project_id.blank?
      return unless Configuration.configured?
      return unless EnabledModule.exists?(project_id:, name: "ifc_hub")

      ::IfcHub::SyncProjectJob.set(wait: DELAY).perform_later(project_id)
    end

    def journal_created(payload)
      journal = payload[:journal]
      return unless journal&.journable_type == "WorkPackage"

      enqueue(journal.journable&.project_id)
    end
  end
end
