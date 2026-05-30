// Supabase client — the persistence boundary for the AUTHORED layer.
//
// Config comes from Vite env (see web/.env.example). The client is created
// lazily and only when both URL and key are present, so the app still runs as a
// pure map viewer with no backend configured (Phase 1 works offline-first).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let attempted = false;

/** Returns the Supabase URL + publishable key from env, or null if unset. */
function readCredentials(): { url: string; key: string } | null {
  const env = import.meta.env;
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const key =
    typeof env.VITE_SUPABASE_ANON_KEY === "string" ? env.VITE_SUPABASE_ANON_KEY.trim() : "";
  if (url === "" || key === "") return null;
  return { url, key };
}

/**
 * Get the shared Supabase client, or null when no backend is configured.
 * Callers must handle the null case (offline / viewer-only mode).
 */
export function getSupabase(): SupabaseClient | null {
  if (attempted) return client;
  attempted = true;
  const creds = readCredentials();
  if (!creds) {
    console.info("[supabase] No VITE_SUPABASE_URL/ANON_KEY set — running without a backend.");
    return null;
  }
  client = createClient(creds.url, creds.key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

/** True when a backend is configured and reachable for this session. */
export function hasBackend(): boolean {
  return getSupabase() !== null;
}
