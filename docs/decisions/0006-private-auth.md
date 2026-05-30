# ADR 0006 — Private access via Supabase Auth (email + password)

- **Status:** Accepted
- **Date:** 2026-05-30
- **Context:** Hardening before/with the public Cloudflare Pages deploy.

## Context

ADR 0002 left a permissive Phase-1 RLS posture and flagged auth as a
prerequisite for public exposure. With the Pages deploy (ADR 0005), the
publishable key ships in the bundle, so access control must be real. Chosen
model: **fully private** (no anonymous access at all) with **email + password**
sign-in — simplest for a solo author, no third-party provider config.

## Decision

Defence in two layers:

1. **Database** — RLS on all 11 authored tables with `authenticated`-only
   policies (anon default-denied); `security_invoker` views; write RPCs are
   SECURITY INVOKER with `EXECUTE` revoked from anon. Verified: anon can neither
   read nor write nor call the RPCs. No schema change was needed — the Phase 1
   policies were already authenticated-scoped; this ADR confirms and documents
   that they are the access boundary.

2. **Frontend** — a login gate (`state/auth.ts`, `state/login-gate.ts`) that
   blocks the app until a Supabase session exists; the map boots only after
   sign-in, and sign-out reloads to a data-free state.

## Out-of-band settings (cannot be codified)

The model is only safe once these Supabase **dashboard** settings are applied
(documented in `docs/auth.md`):

- **Public sign-ups OFF** — otherwise any visitor could self-register and, under
  the current "authenticated = full access" policies, edit everything. This is
  the critical setting.
- Account(s) created manually; email provider enabled; Site/Redirect URLs set to
  the Pages domain.

## Consequences

- The deployed site shows only a login screen to the public; data is
  inaccessible to anon by both RLS and UI.
- Access is currently all-or-nothing per authenticated user. Owner-only writes
  (an allowlist / `auth.uid()` check in policies) remain a future tightening and
  would be additive to the policies, not a rebuild.
- "Offline viewer" mode (no `VITE_SUPABASE_*`) still boots without a gate, since
  there is no backend to protect — useful for local UI work.
