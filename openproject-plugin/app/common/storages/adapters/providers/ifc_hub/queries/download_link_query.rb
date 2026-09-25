module Storages
  module Adapters
    module Providers
      module IfcHub
        module Queries
          # Kurzlebiger, vom Hub signierter Download-Link (Browser -> Hub direkt).
          class DownloadLinkQuery < Base
            def call(auth_strategy:, input_data:)
              get(auth_strategy, "/download-link", id: input_data.file_id).fmap { URI(browser_url(it[:path])) }
            end
          end
        end
      end
    end
  end
end
