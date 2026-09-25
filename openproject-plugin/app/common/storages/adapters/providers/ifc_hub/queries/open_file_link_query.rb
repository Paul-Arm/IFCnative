module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # "Öffnen": verknüpfte Hub-Projekte öffnen im eingebetteten Hub in
          # OpenProject, alle anderen direkt im Hub.
          class OpenFileLinkQuery < Base
            def call(auth_strategy:, input_data:)
              params = { id: input_data.file_id, location: input_data.open_location ? "true" : "false" }
              get(auth_strategy, "/open", params).fmap do |json|
                if json[:openprojectProjectId].present?
                  "#{Setting.protocol}://#{Setting.host_name}/projects/#{json[:openprojectProjectId]}/ifc_hub#{json[:subPath]}"
                else
                  browser_url(json[:hubPath])
                end
              end
            end
          end
        end
      end
    end
  end
end
