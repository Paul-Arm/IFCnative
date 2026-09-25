module Storages::Admin::Forms
  # Grunddaten des Speichertyps "IFC Hub": Name und Server-Adresse. Die
  # allgemeine Vorlage zeigt das Adressfeld nur für Nextcloud/SharePoint.
  class IfcHubGeneralInfoFormComponent < GeneralInfoFormComponent
    private

    def provider_configuration_instructions
      I18n.t("storages.instructions.ifc_hub.provider_configuration",
             hub_url: OpenProject::IfcHub::Configuration.hub_url.presence || "–")
    end
  end
end
