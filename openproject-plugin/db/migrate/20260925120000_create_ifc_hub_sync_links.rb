# Zuordnung OpenProject <-> IFC Hub für den Abgleich (IfcHub::SyncLink):
# kind "model" (IFC-Modell <-> Hub-Modell), "issue" (BCF-Arbeitspaket <->
# Hub-Issue), "comment" (Journal-Notiz <-> Hub-Kommentar). Die Versionen
# halten den zuletzt abgeglichenen Stand beider Seiten fest.
class CreateIfcHubSyncLinks < ActiveRecord::Migration[8.1]
  def change
    create_table :ifc_hub_sync_links do |t|
      t.references :project, null: false, foreign_key: { on_delete: :cascade }
      t.string :kind, null: false
      t.string :op_id, null: false
      t.string :hub_id, null: false
      t.string :op_version
      t.string :hub_version
      t.timestamps
    end
    add_index :ifc_hub_sync_links, %i[kind op_id], unique: true
    add_index :ifc_hub_sync_links, %i[project_id kind hub_id], unique: true
  end
end
