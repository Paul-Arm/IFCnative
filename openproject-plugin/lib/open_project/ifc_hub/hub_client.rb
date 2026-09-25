require "tempfile"

module OpenProject::IfcHub
  # HTTP-Client für die Sync-API des Hubs
  # (/api/integrations/openproject/sync/:op_project_id/…). Server-zu-Server
  # über die Host-Adresse des Speichers "IFC Hub", angemeldet mit einem
  # Dienst-Token (gemeinsames Secret). Lange Timeouts: IFC-Dateien können
  # über 100 MB groß sein.
  class HubClient
    class Error < StandardError; end

    TIMEOUTS = {
      connect_timeout: 10,
      read_timeout: 300,
      write_timeout: 300,
      request_timeout: 900
    }.freeze

    def initialize(storage)
      @base = storage.host.to_s.delete_suffix("/")
    end

    # Zustand des verknüpften Hub-Projekts; nil = nicht verknüpft.
    def state(op_project_id)
      response = session.get(url(op_project_id, "/state"))
      return nil if status_of(response) == 404

      json!(response)
    end

    # Lädt den aktuellen Stand eines Hub-Modells in eine Tempdatei und gibt
    # [pfad, commit_id] an den Block.
    def download_model(op_project_id, model_id)
      response = session.get(url(op_project_id, "/models/#{model_id}/file"))
      raise Error, "Download #{model_id}: HTTP #{status_of(response)}" unless status_of(response) == 200

      Tempfile.create(["ifc-hub", ".ifc"], binmode: true) do |file|
        response.body.copy_to(file)
        file.flush
        yield file.path, response.headers["x-ifc-hub-commit"]
      end
    end

    def create_model(op_project_id, name:, file_path:, message:, author:)
      json!(session.post(url(op_project_id, "/models"),
                         form: { name:, message:, author: author.to_json, file: file_part(file_path, name) }))
    end

    def commit_model(op_project_id, model_id, name:, file_path:, message:, author:)
      json!(session.post(url(op_project_id, "/models/#{model_id}/commits"),
                         form: { message:, author: author.to_json, file: file_part(file_path, name) }))
    end

    def create_issue(op_project_id, attributes)
      json!(session.post(url(op_project_id, "/issues"), json: attributes))
    end

    def update_issue(op_project_id, issue_id, attributes)
      json!(session.patch(url(op_project_id, "/issues/#{issue_id}"), json: attributes))
    end

    def create_comment(op_project_id, issue_id, body:, author:)
      json!(session.post(url(op_project_id, "/issues/#{issue_id}/comments"), json: { body:, author: }))
    end

    private

    # Multipart (form: mit Datei) ist in httpx >= 1.x eingebaut.
    def session
      OpenProject.httpx
                 .with(timeout: TIMEOUTS)
                 .bearer_auth(StorageToken.issue)
    end

    def url(op_project_id, path)
      "#{@base}/api/integrations/openproject/sync/#{op_project_id}#{path}"
    end

    def file_part(path, name)
      { body: File.open(path, "rb"), filename: "#{name}.ifc", content_type: "application/octet-stream" }
    end

    def json!(response)
      status = status_of(response)
      raise Error, "Hub antwortet HTTP #{status}: #{body_of(response)[0, 300]}" unless (200..299).cover?(status)

      JSON.parse(response.body.to_s, symbolize_names: true)
    end

    def status_of(response)
      response.respond_to?(:status) ? response.status : "keine Antwort (#{response.error&.message})"
    end

    def body_of(response)
      response.respond_to?(:body) ? response.body.to_s : ""
    end
  end
end
