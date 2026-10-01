module OpenProject::IfcHub
  # OpenProject navigiert per Turbo: Beim Klick auf "IFC Hub" wird nur der
  # Seiteninhalt getauscht, die CSP der zuerst geladenen Seite bleibt
  # gültig. Deshalb erlaubt JEDE Seite (für angemeldete Benutzer) den Hub
  # als iframe-Quelle — sonst blockiert der Browser das eingebettete iframe.
  # Dazu kommt ifcnative: für "Im Editor öffnen" (Configuration#frame_sources).
  class FrameSrcHook < OpenProject::Hook::Listener
    def application_controller_before_action(context)
      return if Configuration.hub_origin.blank? || !User.current.logged?

      context[:controller].append_content_security_policy_directives(frame_src: Configuration.frame_sources)
    end
  end
end
