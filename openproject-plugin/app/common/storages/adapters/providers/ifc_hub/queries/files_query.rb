module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Inhalt eines Ordners für die Dateiauswahl.
          class FilesQuery < Base
            def call(auth_strategy:, input_data:)
              get(auth_strategy, "/files", location: input_data.folder.path).bind do |json|
                storage_file(json[:parent]).bind do |parent|
                  files = Array(json[:files]).filter_map { storage_file(it).value_or(nil) }
                  ancestors = Array(json[:ancestors]).map do |ancestor|
                    Results::StorageFileAncestor.new(name: ancestor[:name], location: ancestor[:location])
                  end
                  Results::StorageFileCollection.build(files:, parent:, ancestors:)
                end
              end
            end
          end
        end
      end
    end
  end
end
