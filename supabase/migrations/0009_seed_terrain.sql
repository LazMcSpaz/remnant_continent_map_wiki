-- Migration: 0009_seed_terrain
-- Two sample terrain regions over the corridor so the new authored area layer
-- has content to render and round-trip. Idempotent: skips if any region exists.

insert into public.terrain_regions
  (geom, name, elevation_m, slope_deg, aspect_deg, land_cover, soil_fertility, soil_drainage, surface_water, wind_exposure, solar_exposure)
select * from (values
  (st_multi(st_setsrid(st_geomfromtext('POLYGON((-96.5 39.0,-93.5 39.0,-93.5 41.8,-96.5 41.8,-96.5 39.0))'),4326))::geometry(MultiPolygon,4326),
   'Missouri Lowlands', 320::numeric, 2::numeric, 180::numeric, 'cropland', 78::numeric, 'well', 70::numeric, 45::numeric, 60::numeric),
  (st_multi(st_setsrid(st_geomfromtext('POLYGON((-105.5 38.5,-100.0 38.5,-100.0 41.0,-105.5 41.0,-105.5 38.5))'),4326))::geometry(MultiPolygon,4326),
   'High Plains', 1600::numeric, 5::numeric, 90::numeric, 'grassland', 40::numeric, 'moderate', 25::numeric, 85::numeric, 80::numeric)
) as v
where not exists (select 1 from public.terrain_regions limit 1);
