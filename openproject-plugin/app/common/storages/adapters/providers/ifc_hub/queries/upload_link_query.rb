module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Signierter Upload-Link: der Browser lädt direkt in den Hub hoch
          # (Upload-Strategie im Plugin-Frontend, frontend/module).
          class UploadLinkQuery < Base
            def call(auth_strategy:, input_data:)
              post(auth_strategy, "/upload-link", { folderId: input_data.folder_id, fileName: input_data.file_name })
                .bind do |json|
                  Results::UploadLink.build(destination: browser_url(json[:path]),
                                            method: :post,
                                            contract: UploadLinkContract.new)
                end
            end
          end
        end
      end
    end
  end
end
