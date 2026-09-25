module IfcHub
  # Gleicht ein Projekt mit dem verknüpften Hub-Projekt ab
  # (OpenProject::IfcHub::ProjectSync). Pro Projekt höchstens ein Lauf und
  # ein wartender Job — weitere Anstöße in dieser Zeit sind überflüssig.
  class SyncProjectJob < ApplicationJob
    include GoodJob::ActiveJobExtensions::Concurrency

    good_job_control_concurrency_with(
      enqueue_limit: 1,
      perform_limit: 1,
      key: -> { "ifc_hub_sync_project_#{arguments.first}" }
    )

    def perform(project_id)
      project = Project.find_by(id: project_id)
      OpenProject::IfcHub::ProjectSync.call(project) if project
    end
  end
end
