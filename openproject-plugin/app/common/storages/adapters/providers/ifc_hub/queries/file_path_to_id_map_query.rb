module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Pfad -> Datei-Id unterhalb eines Ordners (Projekt kopieren).
          class FilePathToIdMapQuery < Base
            def call(auth_strategy:, input_data:)
              params = { location: input_data.folder.path }
              params[:depth] = input_data.depth.to_i if input_data.depth.finite?
              get(auth_strategy, "/paths", params).fmap do |json|
                json[:paths].to_h { |location, id| [location.to_s, StorageFileId.new(id:)] }
              end
            end
          end
        end
      end
    end
  end
end
