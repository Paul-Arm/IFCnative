require "securerandom"

module OpenProject::IfcHub
  # Abgleich eines OpenProject-Projekts (BCF-Modul) mit dem verknüpften
  # Hub-Projekt — in beide Richtungen:
  #
  #   IFC-Modelle   Bim::IfcModels::IfcModel  <->  Hub-Modell (Art "ifc")
  #                 neue Datei = neuer Commit, neuer Commit = neue Datei
  #   BCF-Themen    Arbeitspaket + Bim::Bcf::Issue  <->  Hub-Issue (Art "bcf")
  #                 Titel, Beschreibung, offen/geschlossen, GUIDs, Kommentare
  #
  # Welche Seite sich geändert hat, zeigen die in IfcHub::SyncLink
  # gespeicherten Versionen (Attachment-Id / Commit-Id, lock_version /
  # updatedAt). Nur eine Seite geändert -> diese gewinnt; beide -> die
  # jüngere. Löschen wird bewusst nicht übertragen.
  class ProjectSync
    MAX_GUIDS = 500
    DEFAULT_CAMERA = {
      "camera_view_point" => { "x" => 10, "y" => -10, "z" => 10 },
      "camera_direction" => { "x" => -0.577, "y" => 0.577, "z" => -0.577 },
      "camera_up_vector" => { "x" => 0, "y" => 0, "z" => 1 },
      "field_of_view" => 60
    }.freeze

    def self.call(project)
      new(project).call
    end

    def initialize(project)
      @project = project
      @storage = ::Storages::IfcHubStorage.order(:id).find(&:configured?)
    end

    def call
      return unless @storage && @project.module_enabled?(:ifc_hub) && @project.module_enabled?(:bim)

      state = client.state(@project.id)
      return unless state # nicht verknüpft

      OpenProject::IfcHub.syncing do
        sync_models(state[:models])
        sync_issues(state[:issues])
      end
    end

    private

    def client
      @client ||= HubClient.new(@storage)
    end

    def links(kind)
      ::IfcHub::SyncLink.where(project: @project, kind:)
    end

    def as_system(&)
      User.execute_as(User.system, &)
    end

    def author_hash(user)
      return nil unless user.is_a?(::User) && user.mail.present?

      { id: user.id.to_s, login: user.login, email: user.mail, name: user.name }
    end

    def newer?(op_time, hub_time_string)
      hub_time_string.blank? || op_time >= Time.zone.parse(hub_time_string)
    end

    # ---- IFC-Modelle -------------------------------------------------------

    def sync_models(hub_models)
      hub_by_id = hub_models.index_by { |model| model[:id] }
      op_models = ::Bim::IfcModels::IfcModel.where(project: @project).includes(:attachments).to_a
      op_by_id = op_models.index_by { |model| model.id.to_s }
      linked_op = Set.new
      linked_hub = Set.new

      links("model").find_each do |link|
        linked_op << link.op_id
        linked_hub << link.hub_id
        op = op_by_id[link.op_id]
        hub = hub_by_id[link.hub_id]
        sync_model_link(link, op, hub) if op && hub
      end

      op_models.each do |op|
        next if linked_op.include?(op.id.to_s) || op.ifc_attachment.nil?

        # Gleichnamiges, noch freies Hub-Modell übernehmen statt Duplikat.
        match = hub_models.find { |hub| !linked_hub.include?(hub[:id]) && hub[:name].casecmp?(op.title) }
        if match
          link = links("model").create!(op_id: op.id.to_s, hub_id: match[:id])
          sync_model_link(link, op, match)
        else
          created = push_new_model(op)
          links("model").create!(op_id: op.id.to_s, hub_id: created[:id],
                                 op_version: op.ifc_attachment.id.to_s, hub_version: created.dig(:head, :id))
          match = { id: created[:id] }
        end
        linked_hub << match[:id]
      end

      hub_models.each do |hub|
        next if linked_hub.include?(hub[:id]) || hub[:head].nil?

        op = pull_new_model(hub)
        next unless op

        links("model").create!(op_id: op.id.to_s, hub_id: hub[:id],
                               op_version: op.ifc_attachment&.id.to_s, hub_version: hub.dig(:head, :id))
      end
    end

    def sync_model_link(link, op, hub)
      attachment = op.ifc_attachment
      head = hub[:head]
      return unless attachment && head

      op_changed = attachment.id.to_s != link.op_version
      hub_changed = head[:id] != link.hub_version
      return unless op_changed || hub_changed

      if op_changed && (!hub_changed || newer?(attachment.created_at, head[:createdAt]))
        result = client.commit_model(@project.id, hub[:id],
                                     name: op.title,
                                     file_path: attachment.diskfile.path,
                                     message: "Neue Datei in OpenProject: #{attachment.filename}",
                                     author: author_hash(attachment.author))
        link.update!(op_version: attachment.id.to_s, hub_version: result.dig(:head, :id))
      else
        updated = pull_model_into(op, hub)
        link.update!(op_version: updated.ifc_attachment&.id.to_s, hub_version: head[:id]) if updated
      end
    end

    def push_new_model(op)
      client.create_model(@project.id,
                          name: op.title,
                          file_path: op.ifc_attachment.diskfile.path,
                          message: "Aus OpenProject übernommen: #{op.ifc_attachment.filename}",
                          author: author_hash(op.ifc_attachment.author))
    end

    def with_hub_file(hub)
      client.download_model(@project.id, hub[:id]) do |path, _commit|
        file = Rack::Multipart::UploadedFile.new(path, "application/octet-stream", true,
                                                 filename: "#{hub[:name]}.ifc")
        yield file
      end
    end

    def pull_model_into(op, hub)
      with_hub_file(hub) do |file|
        result = as_system do
          ::Bim::IfcModels::UpdateService.new(user: User.system, model: op).call(ifc_attachment: file)
        end
        log_failure("IFC-Modell #{op.title} aktualisieren", result)
        result.success? ? op.reload : nil
      end
    end

    def pull_new_model(hub)
      with_hub_file(hub) do |file|
        result = as_system do
          ::Bim::IfcModels::CreateService.new(user: User.system)
                                         .call(project: @project, title: hub[:name], is_default: true,
                                               ifc_attachment: file)
        end
        log_failure("IFC-Modell #{hub[:name]} anlegen", result)
        result.success? ? result.result.reload : nil
      end
    end

    # ---- BCF-Themen ----------------------------------------------------------

    def sync_issues(hub_issues)
      hub_by_id = hub_issues.index_by { |issue| issue[:id] }
      bcf_issues = ::Bim::Bcf::Issue.of_project(@project).includes(:viewpoints, work_package: :status).to_a
      bcf_by_wp = bcf_issues.index_by { |bcf| bcf.work_package_id.to_s }
      linked_op = Set.new
      linked_hub = Set.new

      links("issue").find_each do |link|
        linked_op << link.op_id
        linked_hub << link.hub_id
        bcf = bcf_by_wp[link.op_id]
        hub = hub_by_id[link.hub_id]
        sync_issue_link(link, bcf, hub) if bcf && hub
      end

      bcf_issues.each do |bcf|
        next if linked_op.include?(bcf.work_package_id.to_s)

        # Topic-Guid aus OpenProject = Hub-Issue-Id (gleiche Guid auf beiden Seiten).
        result = client.create_issue(@project.id, issue_payload(bcf).merge(id: bcf.uuid))
        hub = result[:issue]
        link = links("issue").create!(op_id: bcf.work_package_id.to_s, hub_id: hub[:id])
        if result[:existing]
          sync_issue_link(link, bcf, hub)
        else
          link.update!(op_version: bcf.work_package.lock_version.to_s, hub_version: hub[:updatedAt])
          sync_comments(link, bcf.work_package, hub)
        end
        linked_hub << hub[:id]
      end

      hub_issues.each do |hub|
        next if linked_hub.include?(hub[:id])

        work_package = pull_new_issue(hub)
        next unless work_package

        link = links("issue").create!(op_id: work_package.id.to_s, hub_id: hub[:id],
                                      op_version: work_package.lock_version.to_s, hub_version: hub[:updatedAt])
        sync_comments(link, work_package, hub)
      end
    end

    def sync_issue_link(link, bcf, hub)
      work_package = bcf.work_package
      op_changed = work_package.lock_version.to_s != link.op_version
      hub_changed = hub[:updatedAt] != link.hub_version

      if op_changed || hub_changed
        if op_changed && (!hub_changed || newer?(work_package.updated_at, hub[:updatedAt]))
          updated = client.update_issue(@project.id, hub[:id], issue_payload(bcf))[:issue]
          link.update!(op_version: work_package.lock_version.to_s, hub_version: updated[:updatedAt])
        else
          apply_hub_issue(bcf, hub)
          link.update!(op_version: work_package.reload.lock_version.to_s, hub_version: hub[:updatedAt])
        end
      end
      sync_comments(link, work_package, hub)
    end

    def issue_payload(bcf)
      work_package = bcf.work_package
      {
        title: work_package.subject,
        body: work_package.description.to_s,
        state: work_package.closed? ? "closed" : "open",
        guids: op_guids(bcf),
        author: author_hash(work_package.author)
      }
    end

    # Betroffene Objekte aus allen Viewpoints: Auswahl, bei "alles aus außer"
    # auch die sichtbaren Ausnahmen.
    def op_guids(bcf)
      bcf.viewpoints.flat_map do |viewpoint|
        components = viewpoint.json_viewpoint&.dig("components") || {}
        selection = Array(components["selection"]).filter_map { |c| c["ifc_guid"] }
        visibility = components["visibility"] || {}
        visible = visibility["default_visibility"] == true ? [] : Array(visibility["exceptions"]).filter_map { |c| c["ifc_guid"] }
        selection + visible
      end.uniq.first(MAX_GUIDS)
    end

    def apply_hub_issue(bcf, hub)
      work_package = bcf.work_package
      attributes = {}
      attributes[:subject] = hub[:title] if hub[:title].present? && hub[:title] != work_package.subject
      attributes[:description] = hub[:body].to_s if hub[:body].to_s != work_package.description.to_s
      closed = hub[:state] == "closed"
      attributes[:status] = closed ? closed_status : open_status if closed != work_package.closed?
      update_work_package(work_package, attributes.compact) if attributes.compact.any?

      guids = Array(hub[:guids])
      add_viewpoint(bcf, guids) if guids.any? && !(guids - op_guids(bcf)).empty?
    end

    def update_work_package(work_package, attributes)
      result = as_system do
        ::WorkPackages::UpdateService.new(user: User.system, model: work_package).call(**attributes)
      end
      # Workflow erlaubt den Statuswechsel nicht: den Rest trotzdem übernehmen.
      if result.failure? && attributes.key?(:status)
        work_package.reload
        return update_work_package(work_package, attributes.except(:status)) if attributes.except(:status).any?
      end
      log_failure("Arbeitspaket ##{work_package.id} aktualisieren", result)
    end

    def pull_new_issue(hub)
      closed = hub[:state] == "closed"
      result = as_system do
        ::WorkPackages::CreateService.new(user: User.system)
                                     .call(project: @project,
                                           type: issue_type,
                                           subject: hub[:title],
                                           description: hub[:body].to_s,
                                           status: closed ? closed_status : open_status)
      end
      log_failure("BCF-Thema #{hub[:title]} anlegen", result)
      return nil unless result.success?

      work_package = result.result
      bcf = ::Bim::Bcf::Issue.create!(work_package:, uuid: hub[:id])
      add_viewpoint(bcf, Array(hub[:guids])) if Array(hub[:guids]).any?
      work_package.reload
    end

    # Viewpoint mit den Hub-GUIDs als Auswahl — so markiert OpenProjects
    # Viewer die betroffenen Objekte. Neutrale Kamera, keine Momentaufnahme.
    def add_viewpoint(bcf, guids)
      uuid = SecureRandom.uuid
      ::Bim::Bcf::Viewpoint.create!(
        issue: bcf,
        uuid:,
        viewpoint_name: "#{uuid}.bcfv",
        json_viewpoint: {
          "guid" => uuid,
          "components" => {
            "selection" => guids.first(MAX_GUIDS).map { |guid| { "ifc_guid" => guid } },
            "visibility" => { "default_visibility" => true }
          },
          "perspective_camera" => DEFAULT_CAMERA
        }
      )
    end

    def issue_type
      types = @project.types
      types.find_by(name: %w[Issue Aufgabe]) || types.order(:position).first
    end

    def closed_status
      Status.where(is_closed: true).order(:position).first
    end

    def open_status
      Status.where(is_default: true).first || Status.where(is_closed: false).order(:position).first
    end

    # ---- Kommentare --------------------------------------------------------

    # Journal-Notizen <-> Hub-Kommentare. Nur Neues wird übertragen;
    # Bearbeiten/Löschen nicht. Interne Kommentare bleiben in OpenProject.
    def sync_comments(issue_link, work_package, hub)
      journals = work_package.journals.where.not(notes: [nil, ""])
      journals = journals.where(internal: false) if Journal.column_names.include?("internal")
      comment_links = links("comment")
      linked_journals = comment_links.where(op_id: journals.map { |j| j.id.to_s }).pluck(:op_id).to_set
      hub_comments = Array(hub[:comments])
      linked_hub = comment_links.where(hub_id: hub_comments.map { |c| c[:id] }).pluck(:hub_id).to_set

      journals.each do |journal|
        next if linked_journals.include?(journal.id.to_s)

        created = client.create_comment(@project.id, hub[:id], body: journal.notes, author: author_hash(journal.user))
        comment_links.create!(op_id: journal.id.to_s, hub_id: created[:id])
      end

      added_notes = false
      hub_comments.each do |comment|
        next if linked_hub.include?(comment[:id])

        journal = add_note(work_package, comment)
        next unless journal

        comment_links.create!(op_id: journal.id.to_s, hub_id: comment[:id])
        added_notes = true
      end
      # Eigene Notizen erhöhen lock_version — das ist keine inhaltliche Änderung.
      issue_link.update!(op_version: work_package.reload.lock_version.to_s) if added_notes
    end

    def add_note(work_package, comment)
      author = comment.dig(:author, :openprojectUserId).presence && User.active.find_by(id: comment[:author][:openprojectUserId])
      user = author if author&.allowed_in_project?(:add_work_package_comments, @project)
      notes = comment[:body].to_s
      notes = "**#{comment.dig(:author, :name)}** (IFC Hub):\n\n#{notes}" unless user
      user ||= User.system

      result = User.execute_as(user) do
        ::AddWorkPackageNoteService.new(user:, work_package:).call(notes, send_notifications: true)
      end
      log_failure("Kommentar an ##{work_package.id}", result)
      result.success? ? result.result : nil
    end

    def log_failure(action, result)
      return if result.success?

      Rails.logger.warn("IFC Hub Abgleich (#{@project.identifier}): #{action} fehlgeschlagen: " \
                        "#{result.errors.full_messages.join(', ')}")
    end
  end
end
