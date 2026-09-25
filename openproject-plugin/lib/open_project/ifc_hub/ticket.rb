require "base64"
require "json"
require "openssl"
require "securerandom"

module OpenProject::IfcHub
  # Kurzlebiges, HMAC-signiertes Anmelde-Ticket (JWT, HS256) für den Hub.
  #
  # Der Hub prüft Signatur, Ablauf und Einmaligkeit (jti), legt Benutzer,
  # Projekt und Mitgliedschaft bei Bedarf an und tauscht das Ticket gegen
  # eine normale Hub-Sitzung. Gegenstück: server/src/integrations/openproject.
  module Ticket
    TTL_SECONDS = 120
    AUDIENCE = "ifc-hub".freeze
    ISSUER = "openproject".freeze

    module_function

    def issue(user:, project:, role:, secret: Configuration.shared_secret, now: Time.now.to_i)
      payload = {
        iss: ISSUER,
        aud: AUDIENCE,
        iat: now,
        exp: now + TTL_SECONDS,
        jti: SecureRandom.uuid,
        openproject_url: base_url,
        user: {
          id: user.id.to_s,
          login: user.login,
          email: user.mail,
          name: user.name
        },
        project: {
          id: project.id.to_s,
          identifier: project.identifier,
          name: project.name
        },
        role:
      }
      encode(payload, secret)
    end

    def encode(payload, secret)
      header = { alg: "HS256", typ: "JWT" }
      signing_input = [header, payload].map { |part| b64(JSON.generate(part)) }.join(".")
      signature = OpenSSL::HMAC.digest("SHA256", secret, signing_input)
      "#{signing_input}.#{b64(signature)}"
    end

    def b64(data)
      Base64.urlsafe_encode64(data, padding: false)
    end

    def base_url
      "#{Setting.protocol}://#{Setting.host_name}"
    end
  end
end
