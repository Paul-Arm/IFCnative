# Prüft das Plugin im laufenden Container und legt ein Demo-Projekt an:
#
#   docker compose -f deploy/openproject-local/docker-compose.yml exec -T openproject \
#     bash -c "cd /app && bin/rails runner -" < deploy/openproject-local/verify_plugin.rb
#
# Gibt am Ende ein frisches Ticket aus (TICKET=…), mit dem sich die
# Anmeldung am Hub ohne Browser testen lässt.
plugin = Redmine::Plugin.all.find { |p| p.id.to_s == "openproject_ifc_hub" }
puts "plugin: #{plugin ? "#{plugin.id} #{plugin.version}" : 'NICHT GELADEN'}"

permissions = %i[view_ifc_hub edit_ifc_hub manage_ifc_hub]
puts "permissions: #{permissions.map { |p| "#{p}=#{OpenProject::AccessControl.permission(p).present?}" }.join(' ')}"
puts "project module: #{OpenProject::AccessControl.available_project_modules.include?(:ifc_hub)}"

config = OpenProject::IfcHub::Configuration
puts "configured: #{config.configured?} (hub_origin=#{config.hub_origin})"

# Echter Admin, nicht der interne SystemUser (der ist auch admin, hat aber keine E-Mail).
admin = User.where(admin: true, type: "User").order(:id).first
project = Project.find_by(identifier: "ifc-hub-demo")
unless project
  result = Projects::CreateService
             .new(user: admin)
             .call(name: "IFC Hub Demo",
                   identifier: "ifc-hub-demo",
                   workspace_type: "project",
                   enabled_module_names: %w[work_package_tracking bim ifc_hub])
  raise "Projekt anlegen fehlgeschlagen: #{result.errors.full_messages.join(', ')}" unless result.success?

  project = result.result
end
puts "project: #{project.identifier} modules=#{project.enabled_module_names.sort.join(',')}"

puts "TICKET=#{OpenProject::IfcHub::Ticket.issue(user: admin, project:, role: 'owner')}"
