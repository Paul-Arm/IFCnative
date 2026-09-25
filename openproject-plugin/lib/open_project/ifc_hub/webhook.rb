require "base64"
require "json"
require "openssl"

module OpenProject::IfcHub
  # Prüft das Token des Hub-Webhooks (Gegenstück: OpenProjectNotifier in
  # server/src/integrations/openprojectSync.ts). nil = ungültig.
  module Webhook
    MAX_LIFETIME = 600
    CLOCK_SKEW = 60

    module_function

    def verify(token, secret: Configuration.shared_secret, now: Time.now.to_i)
      return nil unless Configuration.configured?

      header_b64, payload_b64, signature = token.to_s.split(".")
      return nil unless header_b64 && payload_b64 && signature

      header = JSON.parse(Base64.urlsafe_decode64(header_b64))
      return nil unless header["alg"] == "HS256"

      expected = Ticket.b64(OpenSSL::HMAC.digest("SHA256", secret, "#{header_b64}.#{payload_b64}"))
      return nil unless ActiveSupport::SecurityUtils.secure_compare(expected, signature)

      payload = JSON.parse(Base64.urlsafe_decode64(payload_b64))
      return nil unless payload["iss"] == "ifc-hub" && payload["aud"] == "openproject"

      iat = payload["iat"].to_i
      exp = payload["exp"].to_i
      return nil if exp - iat > MAX_LIFETIME || iat > now + CLOCK_SKEW || exp < now - CLOCK_SKEW

      payload
    rescue ArgumentError, JSON::ParserError
      nil
    end
  end
end
