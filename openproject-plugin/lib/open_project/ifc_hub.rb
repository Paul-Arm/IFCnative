module OpenProject
  module IfcHub
    require "open_project/ifc_hub/engine"

    # Während eines Abgleichs lösen eigene Änderungen (neue IFC-Datei, Notiz,
    # Status) keinen weiteren Abgleich aus.
    def self.syncing
      previous = Thread.current[:ifc_hub_syncing]
      Thread.current[:ifc_hub_syncing] = true
      yield
    ensure
      Thread.current[:ifc_hub_syncing] = previous
    end

    def self.syncing?
      Thread.current[:ifc_hub_syncing] == true
    end
  end
end
