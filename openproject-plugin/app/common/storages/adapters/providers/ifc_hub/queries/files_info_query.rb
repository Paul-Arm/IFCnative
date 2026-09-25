module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Metadaten mehrerer Dateien auf einmal (Abgleich der Dateiverknüpfungen).
          class FilesInfoQuery < Base
            def call(auth_strategy:, input_data:)
              post(auth_strategy, "/files/info", { ids: input_data.file_ids }).fmap do |json|
                Array(json[:files]).map { file_info(it) }
              end
            end

            private

            def file_info(json)
              unless json[:status] == "ok"
                code = json[:statusCode].to_i
                return Results::StorageFileInfo.new(
                  id: json[:id],
                  status: Rack::Utils::SYMBOL_TO_STATUS_CODE.key(code)&.to_s || "error",
                  status_code: code
                )
              end

              Results::StorageFileInfo.new(
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
