module Storages
  module Adapters
    module Providers
      module IfcHub
        # Gemeinsame Basis der Hub-Abfragen: HTTP gegen
        # <storage.host>/api/integrations/openproject/storage/… und
        # Übersetzung der Antworten in Results.
        class Base
          include TaggedLogging
          include Dry::Monads::Result(Results::Error)

          API_PATH = "/api/integrations/openproject/storage".freeze

          def self.call(storage:, auth_strategy:, input_data: nil)
            new(storage).call(auth_strategy:, input_data:)
          end

          def initialize(storage)
            @storage = storage
          end

          private

          def url(path, params = {})
            base = UrlBuilder.url(@storage.uri, API_PATH, path)
            params.present? ? "#{base}?#{URI.encode_www_form(params)}" : base
          end

          def get(auth_strategy, path, params = {})
            Authentication[auth_strategy].call(storage: @storage) do |http|
              handle(http.get(url(path, params)))
            end
          end

          def post(auth_strategy, path, json)
            Authentication[auth_strategy].call(storage: @storage) do |http|
              handle(http.post(url(path), json:))
            end
          end

          def handle(response)
            error = Results::Error.new(source: self.class, payload: response)
            case response
            in { status: 200..299 }
              Success(response.json(symbolize_keys: true))
            in { status: 400 }
              Failure(error.with(code: :request_error))
            in { status: 401 }
              Failure(error.with(code: :unauthorized))
            in { status: 403 }
              Failure(error.with(code: :forbidden))
            in { status: 404 }
              Failure(error.with(code: :not_found))
            else
              Failure(error.with(code: :error))
            end
          end

          # Hub-JSON -> Results::StorageFile
          def storage_file(json)
            Results::StorageFile.build(
              id: json[:id],
              name: json[:name],
              size: json[:size],
              mime_type: json[:mimeType],
              created_at: parse_time(json[:createdAt]),
              last_modified_at: parse_time(json[:lastModifiedAt]),
              created_by_name: json[:createdByName],
              last_modified_by_name: json[:lastModifiedByName],
              location: json[:location],
              permissions: Array(json[:permissions]).map(&:to_sym)
            )
          end

          def parse_time(value)
            value.present? ? Time.zone.parse(value) : nil
          end

          # Adresse des Hubs aus Sicht des Browsers + Pfad vom Hub.
          def browser_url(path)
            "#{OpenProject::IfcHub::Configuration.hub_url}#{path}"
          end
        end
      end
    end
  end
end
