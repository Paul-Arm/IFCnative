module IfcHub
  # Siehe db/migrate/*_create_ifc_hub_sync_links.rb
  class SyncLink < ApplicationRecord
    self.table_name = "ifc_hub_sync_links"

    KINDS = %w[model issue comment].freeze

    belongs_to :project

    validates :kind, inclusion: { in: KINDS }
    validates :op_id, :hub_id, presence: true
  end
end
