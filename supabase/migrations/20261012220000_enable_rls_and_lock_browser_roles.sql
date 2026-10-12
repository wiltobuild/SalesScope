-- The application server is the tenant/session authorization boundary.  These
-- tables must never be accessible through the browser-facing Supabase roles.
alter table public.workspaces enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.sessions enable row level security;
alter table public.records enable row level security;
alter table public.events enable row level security;
alter table public.invitations enable row level security;
alter table public.imports enable row level security;

revoke all on all tables in schema public from anon, authenticated;
