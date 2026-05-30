-- Migration: 0002_geojson_views
-- PostgREST returns PostGIS geometry as WKB hex by default. The client wants
-- GeoJSON. These views expose each spatial table's geometry as a GeoJSON jsonb
-- `geometry` column (plus the scalar columns), so the frontend can assemble
-- GeoJSON FeatureCollections directly.
--
-- security_invoker = true (PG15+) so the underlying tables' RLS applies to the
-- view — the views do not widen access.

create view public.locations_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, name, old_world_name, type,
         faction_id, resource_overrides, created_at, updated_at
  from public.locations;

create view public.routes_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, kind, owner_faction_id,
         status, mode_ids, purpose, created_at, updated_at
  from public.routes;

create view public.territories_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, faction_id, style,
         created_at, updated_at
  from public.territories;

create view public.notes_geojson with (security_invoker = true) as
  select id, st_asgeojson(geom)::jsonb as geometry, target_type, target_id,
         body, tags, links, created_at, updated_at
  from public.notes;

create view public.world_settings_geojson with (security_invoker = true) as
  select id, st_asgeojson(pole_geom)::jsonb as pole_geometry, season,
         global_temp_offset, created_at, updated_at
  from public.world_settings;
