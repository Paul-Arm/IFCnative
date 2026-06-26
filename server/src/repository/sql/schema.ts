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
  created_at text not null
);

create table if not exists projects (
  id uuid primary key,
  slug text unique not null,
  name text not null,
  owner_id uuid not null references users(id),
  created_at text not null
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
  unique (project_id, slug)
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
`;

export function schemaStatements(): string[] {
  return SCHEMA_SQL.split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
