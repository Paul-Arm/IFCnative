Rails.application.routes.draw do
  # Der Hub meldet Änderungen (signiert) -> Abgleich anstoßen.
  post "ifc_hub/webhook", to: "ifc_hub/webhooks#create", as: :ifc_hub_webhook

  scope "projects/:project_id", as: "project" do
    # Speicher "IFC Hub" nach dem Verknüpfen aktivieren (vom iframe angestoßen).
    post "ifc_hub/sync_storage", to: "ifc_hub/embed#sync_storage", as: :ifc_hub_sync_storage
    # /projects/:id/ifc_hub/m/<modell> öffnet direkt die Modellseite im Hub.
    get "ifc_hub(/*hub_path)", to: "ifc_hub/embed#show", as: :ifc_hub, format: false
  end
end
