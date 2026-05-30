-- Migration: 0011_route_class
-- Classify routes by prominence/secrecy: major | minor | secret. Distinct from
-- `purpose` (trade/common/owner) and `status` (intact/damaged/destroyed). Class
-- feeds styling and the derived network graph (major routes are faster/higher
-- capacity; secret routes are slower, hidden paths).

alter table public.routes
  add column if not exists route_class text not null default 'minor'
    check (route_class in ('major', 'minor', 'secret'));

comment on column public.routes.route_class is 'Prominence/secrecy: major|minor|secret. Feeds styling + graph speed.';

-- Append route_class to the GeoJSON view (CREATE OR REPLACE allows trailing add).
create or replace view public.routes_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, kind, owner_faction_id,
         status, mode_ids, purpose, created_at, updated_at, route_class
  from public.routes;

-- Seed: the long-haul trade rails are major; the damaged road is minor; the
-- severed trail is secret.
update public.routes set route_class = 'major' where kind = 'rail';
update public.routes set route_class = 'minor' where kind = 'road';
update public.routes set route_class = 'secret' where kind = 'trail';
