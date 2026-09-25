module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Hub-Projekt, das mit einem OpenProject-Projekt verknüpft ist
          # (input_data = OpenProject-Projekt-Id) -> { slug:, name:, location: }.
          class ProjectLinkQuery < Base
            def call(auth_strategy:, input_data:)
              get(auth_strategy, "/project-link", openprojectProjectId: input_data.to_s)
            end
          end
        end
      end
    end
  end
end
