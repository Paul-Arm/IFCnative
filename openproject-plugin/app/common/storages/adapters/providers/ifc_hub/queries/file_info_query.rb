module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Metadaten einer verlinkten Datei (Name, Autor, Rechte, Pfad).
          class FileInfoQuery < Base
            def call(auth_strategy:, input_data:)
              get(auth_strategy, "/files/info", id: input_data.file_id).bind { file_info(it) }
            end

            private

            def file_info(json)
              Results::StorageFileInfo.build(
                status: "ok",
                status_code: 200,
                id: json[:id],
                name: json[:name],
                size: json[:size],
                mime_type: json[:mimeType],
                created_at: parse_time(json[:createdAt]),
                last_modified_at: parse_time(json[:lastModifiedAt]),
                owner_name: json[:createdByName],
                last_modified_by_name: json[:lastModifiedByName],
                permissions: Array(json[:permissions]).map(&:to_sym),
                location: json[:location]
              )
            end
          end
        end
      end
    end
  end
end
