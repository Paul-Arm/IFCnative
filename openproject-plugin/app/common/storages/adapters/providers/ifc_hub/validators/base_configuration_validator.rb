module Storages
  module Adapters
    module Providers
      module IfcHub
        module Validators
          # Konfiguration vollständig? Hub erreichbar und Secret passend?
          class BaseConfigurationValidator < ::HealthReports::ValidatorGroup
            def self.key = :base_configuration

            private

            def validate
              register_checks :storage_configured, :diagnostic_request

              if subject.configured?
                pass_check(:storage_configured)
              else
                fail_check(:storage_configured, :not_configured)
              end

              # Dienst-Token: prüft Erreichbarkeit UND gemeinsames Secret.
              Queries::FilesQuery
                .call(storage: subject,
                      auth_strategy: Registry["ifc_hub.authentication.userless"].call,
                      input_data: Input::Files.build(folder: "/").value!)
                .either(
                  ->(_) { pass_check(:diagnostic_request) },
                  ->(error) { fail_check(:diagnostic_request, :"ifc_hub_#{error.code}") }
                )
            end
          end
        end
      end
    end
  end
end
