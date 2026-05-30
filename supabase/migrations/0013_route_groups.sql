-- Migration: 0013_route_groups
-- Named corridors: a route group bundles several route segments under one name
-- + labels (e.g. "The King's Road"). Many-to-many, so a corridor spans many
-- segments AND a segment can belong to several corridors.
--
-- A corridor's length/travel/closed status are DERIVED at runtime from its
-- members (web/src/derived) — nothing aggregated is stored here. Crucially, a
-- corridor is considered CLOSED if any member route is severed (active break or
-- destroyed), so a single blocked segment closes the whole named route.

create table public.route_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  labels      text[] not null default '{}',
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.route_groups is 'Named corridor bundling several route segments; aggregate state is derived from members.';

create table public.route_group_members (
  group_id  uuid not null references public.route_groups(id) on delete cascade,
  route_id  uuid not null references public.routes(id) on delete cascade,
  primary key (group_id, route_id)
);

create index route_group_members_route_idx on public.route_group_members (route_id);

create trigger route_groups_set_updated_at
  before update on public.route_groups
  for each row execute function extensions.moddatetime(updated_at);

alter table public.route_groups enable row level security;
alter table public.route_group_members enable row level security;
create policy route_groups_authenticated_all on public.route_groups
  for all to authenticated using (true) with check (true);
create policy route_group_members_authenticated_all on public.route_group_members
  for all to authenticated using (true) with check (true);
