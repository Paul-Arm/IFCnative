module OpenProject::IfcHub
  # Token für die Datei-API des Hubs (Speichertyp "IFC Hub"): OpenProjects
  # Server ruft den Hub damit im Namen eines Benutzers auf — ohne Benutzer
  # als Dienst, den der Hub nur lesen lässt. Gegenstück:
  # server/src/integrations/openproject.ts (verifyStorageToken).
  module StorageToken
    TTL_SECONDS = 300
    AUDIENCE = "ifc-hub-storage".freeze

    module_function

    def issue(user: nil, secret: Configuration.shared_secret, now: Time.now.to_i)
      payload = {
        iss: Ticket::ISSUER,
        aud: AUDIENCE,
        iat: now,
        exp: now + TTL_SECONDS,
        user: user && {
          id: user.id.to_s,
          login: user.login,
          email: user.mail,
          name: user.name
        }
      }
      Ticket.encode(payload, secret)
    end
  end
end
