-- Migration: 0003_seed_sample_data
-- A small, real-geography seed so the map renders something and the derived
-- network graph has nodes/edges to build. Names follow the README's
-- old-world ↔ new-world convention (Omaha ↔ Omara, Kansas City ↔ Kansit).
-- Idempotent-ish: only inserts when the locations table is empty.

do $$
declare
  f_versari uuid;
  f_free    uuid;
begin
  if exists (select 1 from public.locations limit 1) then
    raise notice 'locations not empty — skipping seed';
    return;
  end if;

  insert into public.factions (name, color) values
    ('The Versari', '#6ea8fe') returning id into f_versari;
  insert into public.factions (name, color) values
    ('Free Cities of the Corridor', '#e0af68') returning id into f_free;

  insert into public.travel_modes (label, speed_kph) values
    ('Landship', 45), ('Rail', 90), ('On foot', 5);

  -- Cities (lon, lat). new-world name + real-world old_world_name.
  insert into public.locations (geom, name, old_world_name, type, faction_id) values
    (st_setsrid(st_makepoint(-95.94, 41.26), 4326), 'Omara',   'Omaha',       'city', f_versari),
    (st_setsrid(st_makepoint(-96.70, 40.81), 4326), 'Lincorr', 'Lincoln',     'city', f_versari),
    (st_setsrid(st_makepoint(-94.58, 39.10), 4326), 'Kansit',  'Kansas City', 'city', f_free),
    (st_setsrid(st_makepoint(-93.62, 41.59), 4326), 'Desmoin', 'Des Moines',  'city', f_free),
    (st_setsrid(st_makepoint(-104.99, 39.74), 4326),'Denvar',  'Denver',      'city', f_versari);

  -- Routes. Endpoints match city coordinates so the graph builder snaps cleanly.
  -- Kansit sits on the Missouri crossing — the README's expected chokepoint.
  insert into public.routes (geom, kind, status, owner_faction_id, purpose) values
    (st_setsrid(st_makeline(st_makepoint(-95.94,41.26), st_makepoint(-94.58,39.10)),4326),
       'rail',  'intact',    f_free,    'trade'),   -- Omara → Kansit (river crossing)
    (st_setsrid(st_makeline(st_makepoint(-95.94,41.26), st_makepoint(-96.70,40.81)),4326),
       'road',  'intact',    f_versari, 'common'),  -- Omara → Lincorr
    (st_setsrid(st_makeline(st_makepoint(-95.94,41.26), st_makepoint(-93.62,41.59)),4326),
       'road',  'damaged',   f_free,    'trade'),   -- Omara → Desmoin (damaged)
    (st_setsrid(st_makeline(st_makepoint(-94.58,39.10), st_makepoint(-104.99,39.74)),4326),
       'rail',  'intact',    f_versari, 'trade'),   -- Kansit → Denvar (long haul)
    (st_setsrid(st_makeline(st_makepoint(-96.70,40.81), st_makepoint(-104.99,39.74)),4326),
       'trail', 'destroyed', null,      'owner');   -- Lincorr → Denvar (severed)
end $$;
