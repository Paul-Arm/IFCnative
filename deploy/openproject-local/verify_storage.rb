# Prüft den Speichertyp "IFC Hub" im laufenden Container:
#
#   docker compose -f deploy/openproject-local/docker-compose.yml exec -T openproject \
#     bash -c "cd /app && bin/rails runner -" < deploy/openproject-local/verify_storage.rb
#
# Legt bei Bedarf den Speicher "IFC Hub" an (Host = Hub aus Sicht des
# Containers) und aktiviert ihn im Projekt "bogen-test".
Registry = Storages::Adapters::Registry
Input = Storages::Adapters::Input

puts "provider_types: #{Storages::Storage.provider_types.keys.join(', ')}"

admin = User.where(admin: true, type: "User").order(:id).first
storage = Storages::IfcHubStorage.find_by(name: "IFC Hub") ||
          Storages::IfcHubStorage.create!(name: "IFC Hub", host: "http://host.docker.internal:8787", creator: admin)
puts "storage: #{storage.id} #{storage.host} configured=#{storage.configured?} #{storage.configuration_checks}"

report = Registry.resolve("ifc_hub.validators.connection").new(storage).call
report.groups.each do |group|
  group.results.each { |r| puts "health #{group.key}.#{r.key}: #{r.state} #{r.code}" }
end if report.respond_to?(:groups)
puts "health: #{report.inspect[0, 300]}" unless report.respond_to?(:groups)

auth = Registry["ifc_hub.authentication.user_bound"].call(admin, storage)
puts "authorization_state: #{Storages::Adapters::Authentication.authorization_state(storage:, user: admin)}"

root = Registry.resolve("ifc_hub.queries.files")
               .call(storage:, auth_strategy: auth, input_data: Input::Files.build(folder: "/").value!)
puts "root: #{root.value!.files.map(&:name).join(', ')}"

listing = Registry.resolve("ifc_hub.queries.files")
                  .call(storage:, auth_strategy: auth,
                        input_data: Input::Files.build(folder: "/bestand-bogenbruecke").value!).value!
file = listing.files.first
puts "bestand: parent=#{listing.parent.name} files=#{listing.files.map { "#{_1.name}(#{_1.id})" }.join(', ')}"

info = Registry.resolve("ifc_hub.queries.file_info")
               .call(storage:, auth_strategy: auth, input_data: Input::FileInfo.build(file_id: file.id).value!)
puts "file_info: #{info.value!.name} by #{info.value!.last_modified_by_name}"

download = Registry.resolve("ifc_hub.queries.download_link")
                   .call(storage:, auth_strategy: auth, input_data: Input::DownloadLink.build(file_id: file.id).value!)
puts "download: #{download.value!.to_s[0, 90]}…"

open = Registry.resolve("ifc_hub.queries.open_file_link")
               .call(storage:, auth_strategy: auth, input_data: Input::OpenFileLink.build(file_id: file.id).value!)
puts "open: #{open.value!}"

upload = Registry.resolve("ifc_hub.queries.upload_link")
                 .call(storage:, auth_strategy: auth,
                       input_data: Input::UploadLink.build(folder_id: "/bestand-bogenbruecke", file_name: "Notiz.pdf").value!)
puts "upload: #{upload.value!.method} #{upload.value!.destination.to_s[0, 90]}…"

project = Project.find_by(identifier: "bogen-test")
unless Storages::ProjectStorage.exists?(project:, storage:)
  Storages::ProjectStorage.create!(project:, storage:, creator: admin, project_folder_mode: "inactive")
end
project.enabled_module_names = (project.enabled_module_names + %w[storages]).uniq if Project.method_defined?(:enabled_module_names=)
puts "project storage: #{Storages::ProjectStorage.where(project:).map { "#{_1.storage.name}/#{_1.project_folder_mode}" }.join(', ')}"
