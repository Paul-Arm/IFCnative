module OpenProject::IfcHub
  # Storages::CreateFolderService kennt die Anbieter fest (Nextcloud,
  # OneDrive, SharePoint) und wirft sonst "Unknown Storage Type". Beim IFC Hub
  # ist die Ordner-Id bereits der Pfad — wie bei OneDrive.
  module CreateFolderServicePatch
    private

    def parent_path(parent_id, user)
      return Success(parent_id) if @storage.is_a?(::Storages::IfcHubStorage)

      super
    end
  end
end
