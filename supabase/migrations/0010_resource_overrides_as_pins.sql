-- Migration: 0010_resource_overrides_as_pins
-- City resources are now DERIVED from geography (web/src/derived/resources.ts),
-- and resource_overrides act as PINS over those baselines (the README's model).
-- The earlier seed (0006) set full arbitrary overrides on every city, which
-- would mask the new baselines entirely. Clear them so baselines show through,
-- and keep ONE deliberate, narratable pin: Denvar's fusion energy — the
-- README's own example of an override ("the Versari have fusion so energy is a
-- non-issue"). Idempotent enough for a fresh apply.

update public.locations set resource_overrides = '{}'::jsonb
  where name in ('Omara', 'Lincorr', 'Kansit', 'Desmoin');

update public.locations set resource_overrides = '{"energy": 95}'::jsonb
  where name = 'Denvar';
