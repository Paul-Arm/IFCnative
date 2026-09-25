Gem::Specification.new do |s|
  s.name        = "openproject-ifc_hub"
  s.version     = "0.1.0"
  s.authors     = "IFCnative"
  s.summary     = "IFC Hub in OpenProject"
  s.description = "Bettet den IFC Hub (Modellversionierung, Prüfungen, 3D) als Projektmodul in OpenProject ein " \
                  "und meldet Benutzer per signiertem Ticket automatisch im Hub an."
  s.license     = "GPL-3.0"

  s.files = Dir["{app,config,lib}/**/*"]
  s.required_ruby_version = ">= 3.3"
  s.metadata["rubygems_mfa_required"] = "true"
end
