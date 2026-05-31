-- Migration: 0014_break_faction
-- A blockade or toll can be controlled by a faction (who mans the gate / holds
-- the barricade). Nullable — natural barriers usually have no owner.

alter table public.route_breaks
  add column if not exists faction_id uuid references public.factions(id) on delete set null;

create or replace view public.route_breaks_geojson with (security_invoker = true) as
  select id, route_id, st_asgeojson(geom)::jsonb as geometry,
         position, kind, label, active, created_at, updated_at, faction_id
  from public.route_breaks;
