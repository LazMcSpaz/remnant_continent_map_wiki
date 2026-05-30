# Deploy — Cloudflare Pages

The app is a static SPA built by Vite (`web/`), so it deploys to Cloudflare
Pages as plain static assets — no server runtime. All persistence goes to
Supabase from the browser, gated by Postgres RLS.

## Project settings (Pages → Create → Connect to Git)

| Setting | Value |
|---------|-------|
| Production branch | `main` (or your release branch) |
| Framework preset | None / Vite |
| **Root directory** | `web` |
| **Build command** | `npm run build` |
| **Build output directory** | `web/dist` |
| Node version | pinned by `web/.node-version` (22.x) |

`npm run build` runs `tsc --noEmit && vite build`, so a type error fails the
deploy — intended.

## Environment variables (Pages → Settings → Environment variables)

Set these for **Production** (and Preview if you use it). They are build-time
`VITE_*` vars baked into the bundle:

| Var | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (never the service_role key) |
| `VITE_MAP_STYLE_URL` | optional MapLibre vector style URL (else raster OSM fallback) |
| `VITE_RASTER_TILE_URL` | optional override of the raster tile template |

The anon/publishable key is safe in the client by design — it's protected by
RLS. The secret `service_role` key must never be set here or committed.

> If you point any `VITE_*` host somewhere new (a different tile host, a hosted
> style, a custom Supabase domain), update the CSP in `web/public/_headers` to
> allow it, or the browser will block the request.

## Security headers

`web/public/_headers` ships a CSP and hardening headers; Vite copies it to
`dist/_headers`, which Cloudflare Pages applies automatically. It is scoped to
the app's default sources (Supabase, OSM tiles, MapLibre blob workers/WebGL).

## Auth (REQUIRED before sharing the URL)

The app is fully private. Before the deployed URL is reachable by others, apply
the Supabase dashboard settings in **`docs/auth.md`** — most importantly
**disable public sign-ups** and create your account manually. Without that, any
visitor could self-register and get full edit access. Also set:

- Authentication → URL Configuration → **Site URL** + **Redirect URLs**:
  `https://<your-project>.pages.dev` and any custom domain.

## Local production check

```bash
cd web
npm run build
npm run preview   # serves dist/ exactly as deployed
```

## Notes

- Routing is hash-based (`#map`, `#/...`), so no SPA rewrite rule is required;
  every path resolves to `index.html` already.
- Migrations are not part of the Pages deploy — apply them to Supabase
  separately (MCP, the Supabase CLI, or the SQL editor). `supabase/migrations/`
  is the source of truth.
