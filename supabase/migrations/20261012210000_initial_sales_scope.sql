-- SalesScope production schema. All business records remain JSON documents so
-- the application can evolve collection fields without destructive migrations.
create table if not exists public.workspaces (
  id uuid primary key,
  settings jsonb not null,
  demo boolean not null default false
);

create table if not exists public.users (
  id uuid primary key,
  email text unique,
  name text not null,
  password text
);

create table if not exists public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'rep', 'viewer')),
  primary key (workspace_id, user_id)
);

create table if not exists public.sessions (
  token text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  expires bigint not null
);

create table if not exists public.records (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null,
  data jsonb not null,
  version integer not null check (version > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists records_scope on public.records(workspace_id, kind);

create table if not exists public.events (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  record_id uuid,
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  data jsonb,
  created_at timestamptz not null
);
create index if not exists event_scope on public.events(workspace_id, record_id);

create table if not exists public.invitations (
  token text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'rep', 'viewer')),
  expires bigint not null,
  used boolean not null default false
);

create table if not exists public.imports (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_key text not null,
  result jsonb not null,
  unique(workspace_id, source_key)
);

-- The server is the authenticated data boundary. Do not expose these tables to
-- the anonymous PostgREST role; production server credentials remain Vercel-only.
revoke all on all tables in schema public from anon, authenticated;
