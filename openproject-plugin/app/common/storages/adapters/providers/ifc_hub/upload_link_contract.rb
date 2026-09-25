module Storages
  module Adapters
    module Providers
      module IfcHub
        # Wie Results::UploadLinkContract, aber auch mit HTTP: Im internen Netz
        # läuft der Hub oft ohne TLS (dann läuft auch OpenProject per HTTP —
        # hinter HTTPS würde der Browser den Upload als Mixed Content sperren).
        class UploadLinkContract < ::DryApplicationContract
          params do
            required(:destination).filled { uri?(%w[http https]) }
            required(:method).filled(AdapterTypes::HTTPVerb)
          end
        end
      end
    end
  end
end
