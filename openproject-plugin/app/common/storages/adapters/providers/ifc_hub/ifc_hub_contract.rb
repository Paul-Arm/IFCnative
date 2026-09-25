module Storages
  module Adapters
    module Providers
      module IfcHub
        class IfcHubContract < ::ModelContract
          attribute :name
          validates :name, presence: true, length: { maximum: 255 }

          # Adresse, unter der OpenProjects Server den Hub erreicht.
          attribute :host
          # Kein secure_context_uri: im internen Netz läuft der Hub oft per HTTP.
          validates :host, presence: true, url: { allowed_protocols: %w[http https] }, length: { maximum: 255 }
        end
      end
    end
  end
end
