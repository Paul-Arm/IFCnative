module Storages
  module Adapters
    module Providers
      module IfcHub
        # Bausteine des Speichertyps "IFC Hub" für Storages::Adapters::Registry
        # (eingehängt in OpenProject::IfcHub::Engine). Schlüssel wie bei den
        # eingebauten Anbietern: "ifc_hub.queries.files" usw.
        IfcHubRegistry = Dry::Core::Container::Namespace.new("ifc_hub") do
          namespace("authentication") do
            # Kein OAuth: pro Anfrage ein kurzlebiges, signiertes Token.
            # Pfeil-Lambdas: im DSL (BasicObject) gibt es kein Kernel#lambda.
            register(:userless, ->(_use_cache = true) {
              Input::Strategy.build(key: :bearer_token, token: OpenProject::IfcHub::StorageToken.issue)
            })
            register(:user_bound, ->(user, _storage = nil) {
              Input::Strategy.build(key: :bearer_token, token: OpenProject::IfcHub::StorageToken.issue(user:))
            })
          end
          namespace("components") do
            namespace("forms") do
              register(:general_information, ::Storages::Admin::Forms::IfcHubGeneralInfoFormComponent)
            end
            register(:setup_wizard, StorageWizard)
            register(:general_information, ::Storages::Admin::GeneralInfoComponent)
          end
          namespace("contracts") do
            register(:storage, IfcHubContract)
            register(:general_information, IfcHubContract)
          end
          namespace("queries") do
            register(:download_link, Queries::DownloadLinkQuery)
            register(:file_info, Queries::FileInfoQuery)
            register(:file_path_to_id_map, Queries::FilePathToIdMapQuery)
            register(:files, Queries::FilesQuery)
            register(:files_info, Queries::FilesInfoQuery)
            register(:open_file_link, Queries::OpenFileLinkQuery)
            register(:open_storage, Queries::OpenStorageQuery)
            register(:upload_link, Queries::UploadLinkQuery)
            register(:user, Queries::UserQuery)
          end
          namespace("validators") do
            register(:connection, Validators::ConnectionValidator)
          end
        end
      end
    end
  end
end
