# Auth & access control

The deployed atlas is **fully private**: nothing is visible until you sign in
(email + password via Supabase Auth). This is enforced in two layers.

## 1. Database (already in place)

- **RLS** is enabled on all 11 authored tables; every policy targets the
  `authenticated` role only, so the `anon` role (the publishable key used before
  login) is **default-denied** on every read and write.
- The `*_geojson` views are `security_invoker`, so they inherit the same RLS.
- The write RPCs (`create_*`, `update_*_geometry`) are **SECURITY INVOKER** with
  `EXECUTE` revoked from `anon` — RLS applies, and anon can't call them.

Net effect: the publishable key in the shipped bundle can read/write **nothing**
until a real user session exists.

## 2. Frontend (login gate)

- `src/state/auth.ts` — session + sign-in/out over Supabase Auth.
- `src/state/login-gate.ts` — a full-screen gate shown until a session exists.
- `main.ts` boots the map only after a session is present; sign-out reloads to a
  clean, data-free state. A "Sign out" button sits in the header.

## ⚠️ Required Supabase dashboard settings

These are **project settings**, not SQL — they cannot be set from the repo or a
migration, and the private model is **not safe until they are done**:

1. **Disable public sign-ups.**
   Authentication → Sign In / Providers (or Settings) →
   **"Allow new users to sign up" = OFF.**
   With RLS granting every authenticated user full access, leaving sign-ups on
   would let any visitor self-register and edit the world. This is the single
   most important setting.

2. **Create your account manually.**
   Authentication → Users → **Add user** (set email + password). Repeat for any
   trusted collaborator. (Or temporarily enable sign-up, register, then disable.)

3. **Enable email auth, disable others** you don't use
   (Authentication → Providers): Email = ON; leave OAuth providers off unless
   wanted.

4. **URL configuration** (Authentication → URL Configuration): set Site URL to
   the Cloudflare Pages URL and add it to Redirect URLs. (Password sign-in
   doesn't strictly need redirects, but set it for correctness / future
   magic-link or OAuth.)

## Future tightening (optional)

The current model is "any authenticated user has full read/write" — fine for a
solo author or a small trusted group. To go to **owner-only writes** later, add
an `owner`/allowlist check to the RLS policies (e.g. `auth.uid() = ANY(...)`).
Tracked as a follow-up; not needed for a private single-author deploy.
