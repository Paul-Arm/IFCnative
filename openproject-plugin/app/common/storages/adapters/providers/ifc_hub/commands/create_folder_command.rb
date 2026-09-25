module Storages
  module Adapters
    module Providers
      module IfcHub
        module Commands
          # "Neuer Ordner" in der Ordnerauswahl: legt im Hub-Projekt einen
          # Ordner an (parent_location = Pfad/Id des übergeordneten Ordners).
          class CreateFolderCommand < Base
            def call(auth_strategy:, input_data:)
              post(auth_strategy, "/folders",
                   { parentLocation: input_data.parent_location.path, name: input_data.folder_name })
                .bind { storage_file(it) }
            end
          end
        end
      end
    end
  end
end
