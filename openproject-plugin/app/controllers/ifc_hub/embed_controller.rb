module IfcHub
  # Projektseite "IFC Hub": bettet die Hub-Oberfläche per iframe ein und
  # meldet den aktuellen Benutzer über ein signiertes Ticket im Hub an.
  class EmbedController < ::ApplicationController
    # Unterpfade im Hub (Modell, Issue, Commit) — nur harmlose Zeichen.
    HUB_PATH = %r{\A[A-Za-z0-9/_.\-]*\z}

    # Anonyme Besucher öffentlicher Projekte bekommen kein Ticket — der Hub
    # braucht eine echte Identität (E-Mail) für Benutzer und Mitgliedschaft.
    before_action :require_login
    before_action :find_project_by_project_id
    before_action :authorize

    menu_item :ifc_hub

    def show
      config = OpenProject::IfcHub::Configuration
      unless config.configured?
        render :not_configured, status: :service_unavailable
        return
      end

      # Speicher "IFC Hub" im Projekt aktivieren, falls schon verknüpft.
      OpenProject::IfcHub::StorageSync.call(@project)

      append_content_security_policy_directives(frame_src: [config.hub_origin])
      ticket = OpenProject::IfcHub::Ticket.issue(user: User.current, project: @project, role: hub_role)
      @hub_src = config.embed_url(ticket:, path: hub_path)
      @hub_origin = config.hub_origin
      @base_path = project_ifc_hub_path(@project)
      @sync_path = project_ifc_hub_sync_storage_path(@project)
    end

    # Nach dem Verknüpfen im Hub (postMessage "ifc-hub:linked"). Idempotent
    # und nur ein Abgleich mit dem, was im Hub bereits verknüpft ist.
    def sync_storage
      project_storage = OpenProject::IfcHub::StorageSync.call(@project)
      render json: { active: project_storage.present?, folder: project_storage&.project_folder_id }
    end

    private

    def hub_role
      return "owner" if User.current.admin?
      return "maintainer" if User.current.allowed_in_project?(:manage_ifc_hub, @project)
      return "contributor" if User.current.allowed_in_project?(:edit_ifc_hub, @project)

      "viewer"
    end

    def hub_path
      path = params[:hub_path].to_s
      return "" unless path.match?(HUB_PATH) && !path.include?("..")

      path.empty? ? "" : "/#{path}"
    end
  end
end
