-- Migration: 0005_rpc_search_path
-- Harden the feature-write RPCs by pinning search_path (fixes the linter's
-- function_search_path_mutable warning). `public` for our tables, `extensions`
-- for PostGIS functions (st_geomfromgeojson, st_setsrid, st_multi).

alter function public.create_location(jsonb, text, text, text, uuid)
  set search_path = public, extensions;
alter function public.update_location_geometry(uuid, jsonb)
  set search_path = public, extensions;
alter function public.create_route(jsonb, text, text, uuid, text)
  set search_path = public, extensions;
alter function public.update_route_geometry(uuid, jsonb)
  set search_path = public, extensions;
alter function public.create_territory(jsonb, uuid)
  set search_path = public, extensions;
alter function public.update_territory_geometry(uuid, jsonb)
  set search_path = public, extensions;
