module OpenProject::IfcHub
  # OpenProject navigiert per Turbo: Beim Klick auf "IFC Hub" wird nur der
  # Seiteninhalt getauscht, die CSP der zuerst geladenen Seite bleibt
  # gültig. Deshalb erlaubt JEDE Seite (für angemeldete Benutzer) den Hub
  # als iframe-Quelle — sonst blockiert der Browser das eingebettete iframe.
  class FrameSrcHook < OpenProject::Hook::Listener
    def application_controller_before_action(context)
      origin = Configuration.hub_origin
      return if origin.blank? || !User.current.logged?

      context[:controller].append_content_security_policy_directives(frame_src: [origin])
    end
  end
end
