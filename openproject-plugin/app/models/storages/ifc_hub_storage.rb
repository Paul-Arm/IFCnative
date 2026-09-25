module Storages
  # Externer Dateispeicher "IFC Hub": Hub-Projekte, Ordner und Modelle
  # erscheinen im Tab "Dateien" der Arbeitspakete. Anmeldung beim Hub per
  # signiertem Token (gemeinsames Secret) — kein OAuth.
  #
  # host  = Adresse, unter der OpenProjects SERVER den Hub erreicht
  #         (im Docker-Netz z. B. http://host.docker.internal:8787)
  # IFC_HUB_URL = Adresse aus Sicht des BROWSERS (Download/Upload/Öffnen)
  class IfcHubStorage < Storage
    def self.short_provider_name = :ifc_hub

    def configuration_checks
      {
        name_configured: name.present?,
        storage_host_configured: host.present?,
        shared_secret_configured: OpenProject::IfcHub::Configuration.configured?
      }
    end

    # Ordner verwaltet der Hub selbst — optional ein fester Projektordner.
    def available_project_folder_modes = %w[inactive manual]

    def automatic_management_new_record? = false
    def automatic_management_enabled? = false
    def provider_fields_defaults = {}

    def audience = nil
    def authenticate_via_idp? = false
    def authenticate_via_storage? = false
    def supports_oauth_redirect? = false
    def oauth_configuration = nil

    # Browser lädt direkt zum Hub hoch -> connect-src für dessen Origin.
    def connect_src
      [OpenProject::IfcHub::Configuration.hub_origin].compact
    end
  end
end
