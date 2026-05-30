# ADR 0005 — Cloudflare Pages static deploy

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Shipping the Phase 1/2 app for real use.

## Context

The frontend is a Vite SPA with no server-side code; all state lives in Supabase
and is reached directly from the browser. We need hosting that serves static
assets, builds from Git, and lets us set build-time env + security headers.

## Decision

Deploy `web/` to **Cloudflare Pages** as a static build.

- Root directory `web`, build `npm run build`, output `web/dist`.
- Config lives in the repo, not just the dashboard:
  - `web/public/_headers` — CSP + hardening headers (Vite copies to
    `dist/_headers`, which Pages applies). CSP is scoped to the actual sources
    (Supabase https/wss, OSM tiles, MapLibre blob workers + WebGL).
  - `web/.node-version` — pins the build Node (22.x).
  - `docs/deploy.md` — exact dashboard settings + env vars.
- Secrets posture: only the Supabase **publishable** key and other `VITE_*`
  values are set as Pages env; the `service_role` key is never deployed. This is
  safe because writes are gated by Postgres RLS, not by key secrecy.

## Consequences

- No server runtime to operate; scaling and TLS are handled by Pages.
- The deploy is only as safe as the RLS policies — which are still the
  permissive Phase 1 posture. **Public exposure makes the ADR 0002 auth
  hardening a prerequisite, not a nice-to-have**; that work follows this ADR.
- Changing a `VITE_*` host requires a matching CSP edit in `_headers`; called
  out in the file and the deploy doc.
- Database migrations are applied to Supabase out-of-band, not by the Pages
  build; `supabase/migrations/` remains the source of truth.

## Not chosen

- Cloudflare Workers / Pages Functions: no need yet — there's no server logic.
  The Phase 4 simulation could later run as a Worker or a Supabase Edge
  Function, but that's out of scope here.
