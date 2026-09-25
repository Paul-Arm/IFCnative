module OpenProject::IfcHub
  # Konfiguration per Umgebungsvariable (docker-compose), damit das Secret
  # nicht in der Datenbank liegt:
  #
  #   IFC_HUB_URL            Adresse des Hubs, wie der BROWSER sie erreicht
  #                          (z. B. http://10.10.17.29:8787)
  #   IFC_HUB_SHARED_SECRET  gemeinsames Secret mit dem Hub
  #                          (dort OPENPROJECT_SHARED_SECRET), >= 32 Zeichen
  module Configuration
    MIN_SECRET_LENGTH = 32

    module_function

    def hub_url
      ENV.fetch("IFC_HUB_URL", "").strip.delete_suffix("/")
    end

    def shared_secret
      ENV.fetch("IFC_HUB_SHARED_SECRET", "")
    end

    def configured?
      hub_origin.present? && shared_secret.length >= MIN_SECRET_LENGTH
    end

    # Origin für die CSP-Direktive frame-src (Schema + Host + Port).
    def hub_origin
      uri = URI.parse(hub_url)
      return nil unless uri.is_a?(URI::HTTP) && uri.host.present?

      port = uri.port == uri.default_port ? "" : ":#{uri.port}"
      "#{uri.scheme}://#{uri.host}#{port}"
    rescue URI::InvalidURIError
      nil
    end

    # Das Ticket steht im Fragment (#…): Fragmente schickt der Browser nicht
    # an den Server, es landet also in keinem Zugriffsprotokoll.
    def embed_url(ticket:, path:)
      fragment = URI.encode_www_form(ticket:, path:)
      "#{hub_url}/embed##{fragment}"
    end
  end
end
