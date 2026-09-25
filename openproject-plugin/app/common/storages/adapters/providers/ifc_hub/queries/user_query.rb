module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Wer bin ich im Hub? Bestimmt den Verbindungsstatus ("verbunden").
          class UserQuery < Base
            def self.call(storage:, auth_strategy:)
              new(storage).call(auth_strategy:)
            end

            def call(auth_strategy:, input_data: nil)
              get(auth_strategy, "/user").fmap { |json| { id: json[:id], name: json[:name] } }
            end
          end
        end
      end
    end
  end
end
