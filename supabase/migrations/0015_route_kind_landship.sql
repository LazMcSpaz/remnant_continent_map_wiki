-- Migration: 0015_route_kind_landship
-- Add 'landship' as a route kind. Landship routes are hover paths that route
-- around terrain; they only support the Landship travel mode in the UI.

alter table public.routes drop constraint if exists routes_kind_check;
alter table public.routes
  add constraint routes_kind_check check (kind in ('rail', 'road', 'trail', 'landship'));
