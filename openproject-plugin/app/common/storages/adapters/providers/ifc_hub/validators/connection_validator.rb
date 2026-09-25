module Storages
  module Adapters
    module Providers
      module IfcHub
        module Validators
          # Integritätsprüfung in der Speicher-Verwaltung.
          class ConnectionValidator < ::HealthReports::Validator
            register_group BaseConfigurationValidator
          end
        end
      end
    end
  end
end
