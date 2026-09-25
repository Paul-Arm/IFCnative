module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # "Speicher öffnen": Startseite des Hubs.
          class OpenStorageQuery < Base
            def call(auth_strategy: nil, input_data: nil)
              Success(OpenProject::IfcHub::Configuration.hub_url)
            end
          end
        end
      end
    end
  end
end
