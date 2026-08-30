/**
 * Schema for the SQL repository. Statements are idempotent (IF NOT EXISTS) and
 * separated by `;` so they can be applied one-by-one through the SqlClient
 * (works on both pg and PGlite, which differ on multi-statement queries).
 *
 * Heavy IFC blobs live in the object store (Azure Blob); this schema holds
 * metadata plus the deduped entity manifest and the diff cache.
 */
export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  created_at text not null,
  is_admin int not null default 0
);

create table if not exists projects (
  id uuid primary key,
  slug text unique not null,
  name text not null,
  owner_id uuid not null references users(id),
  created_at text not null,
  visibility text not null default 'public'
);

create table if not exists project_members (
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role text not null,
  primary key (project_id, user_id)
);

create table if not exists models (
  id uuid primary key,
  project_id uuid not null references projects(id),
  slug text not null,
  name text not null,
  visibility text not null,
  default_branch text not null,
  created_at text not null,
  folder text not null default '',
  kind text not null default 'ifc',
  unique (project_id, slug)
);

create table if not exists project_folders (
  project_id uuid not null references projects(id),
  path text not null,
  primary key (project_id, path)
);

create table if not exists branches (
  id uuid primary key,
  model_id uuid not null references models(id),
  name text not null,
  head_commit_id uuid,
  unique (model_id, name)
);

create table if not exists commits (
  id uuid primary key,
  model_id uuid not null references models(id),
  branch_name text not null,
  parent_commit_id uuid,
  manifest_hash text not null,
  blob_key text not null,
  schema text not null,
  author_id uuid not null references users(id),
  message text not null default '',
  created_at text not null,
  entity_count int not null,
  added int not null,
  removed int not null,
  modified int not null
);
create index if not exists commits_model_idx on commits(model_id);

create table if not exists entity_objects (
  entity_hash text primary key,
  entity_type text not null,
  name text not null,
  payload text not null
);

create table if not exists commit_entities (
  commit_id uuid not null references commits(id),
  global_id text not null,
  entity_hash text not null references entity_objects(entity_hash),
  primary key (commit_id, global_id)
);
create index if not exists commit_entities_commit_idx on commit_entities(commit_id);

create table if not exists diffs_cache (
  from_commit uuid not null,
  to_commit uuid not null,
  summary jsonb not null,
  primary key (from_commit, to_commit)
);

create table if not exists labels (
  id uuid primary key,
  project_id uuid not null references projects(id),
  name text not null,
  color text not null,
  unique (project_id, name)
);

create table if not exists issues (
  id uuid primary key,
  project_id uuid not null references projects(id),
  number int not null,
  title text not null,
  body text not null default '',
  state text not null default 'open',
  kind text not null default 'virtual',
  author_id uuid not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (project_id, number)
);
create index if not exists issues_project_idx on issues(project_id);

create table if not exists issue_assignees (
  issue_id uuid not null references issues(id),
  user_id uuid not null references users(id),
  primary key (issue_id, user_id)
);

create table if not exists issue_models (
  issue_id uuid not null references issues(id),
  model_id uuid not null references models(id),
  found_commit_id uuid,
  fixed_commit_id uuid,
  primary key (issue_id, model_id)
);

create table if not exists issue_label_links (
  issue_id uuid not null references issues(id),
  label_id uuid not null references labels(id),
  primary key (issue_id, label_id)
);

create table if not exists issue_guids (
  issue_id uuid not null references issues(id),
  guid text not null,
  primary key (issue_id, guid)
);

create table if not exists issue_comments (
  id uuid primary key,
  issue_id uuid not null references issues(id),
  author_id uuid not null references users(id),
  body text not null,
  created_at text not null
);
create index if not exists issue_comments_issue_idx on issue_comments(issue_id);

create table if not exists library_files (
  id uuid primary key,
  name text not null,
  kind text not null,
  file_key text not null,
  file_name text not null,
  owner_id uuid not null,
  created_at text not null
);

create table if not exists actions (
  id uuid primary key,
  project_id uuid not null references projects(id),
  name text not null,
  kind text not null,
  file_key text not null,
  file_name text not null,
  library_file_id uuid references library_files(id),
  scope_folder text,
  scope_model_id uuid references models(id),
  run_on_commit int not null default 0,
  created_at text not null
);
create index if not exists actions_project_idx on actions(project_id);

create table if not exists action_runs (
  id uuid primary key,
  project_id uuid not null references projects(id),
  action_id uuid not null references actions(id),
  model_id uuid not null references models(id),
  commit_id uuid not null references commits(id),
  number int not null,
  status text not null,
  summary text not null default '',
  log text not null default '',
  triggered_by uuid not null,
  created_at text not null,
  started_at text,
  finished_at text,
  failed_guids text not null default '[]',
  unique (project_id, number)
);
create index if not exists action_runs_project_idx on action_runs(project_id);
create index if not exists action_runs_commit_idx on action_runs(commit_id);
`;

export function schemaStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
