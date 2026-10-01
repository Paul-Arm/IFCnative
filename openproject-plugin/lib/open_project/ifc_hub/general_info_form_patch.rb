module OpenProject::IfcHub
  # Der Speicher-Controller rendert bei Validierungsfehlern (create) und beim
  # Bearbeiten der Grunddaten (edit_host) fest
  # Storages::Admin::Forms::GeneralInfoFormComponent — dessen Vorlage zeigt
  # das Adressfeld nur für Nextcloud/SharePoint. Für IFC-Hub-Speicher
  # stattdessen unser Formular mit Name + Adresse.
  module GeneralInfoFormPatch
    def new(storage = nil, *, **, &)
      if equal?(::Storages::Admin::Forms::GeneralInfoFormComponent) && storage.is_a?(::Storages::IfcHubStorage)
        return ::Storages::Admin::Forms::IfcHubGeneralInfoFormComponent.new(storage, *, **, &)
      end

      super
    end
  end
end
