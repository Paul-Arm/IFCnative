module Storages
  module Adapters
    module Providers
      module IfcHub
        # Einrichtung in einem Schritt: Name + Server-Adresse des Hubs.
        class StorageWizard < ::Wizard
          step :general_information, completed_if: ->(storage) { storage.name.present? && storage.host.present? }
        end
      end
    end
  end
end
