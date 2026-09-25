module IfcHub
  # Der Hub meldet Änderungen in einem verknüpften Projekt (HS256-Token mit
  # dem gemeinsamen Secret) -> Abgleich sofort anstoßen. Bewusst ohne
  # OpenProject-Sitzung/CSRF: Aufrufer ist der Hub-Server, nicht ein Browser.
  class WebhooksController < ::ActionController::API
    def create
      token = request.authorization.to_s.delete_prefix("Bearer ")
      payload = OpenProject::IfcHub::Webhook.verify(token)
      return head(:unauthorized) unless payload

      project = Project.find_by(id: payload["project_id"])
      return head(:not_found) unless project

      SyncProjectJob.perform_later(project.id)
      head :accepted
    end
  end
end
