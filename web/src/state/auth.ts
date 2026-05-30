// Authentication for the private atlas (email + password via Supabase Auth).
//
// The deployed app is fully private: anon has no RLS access, so the data layer
// returns nothing until a user signs in. This module is the session boundary —
// it exposes the current user, sign-in/out, and a subscription so the UI (the
// login gate in main.ts) can react to auth changes.

import type { Session, User } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

export interface AuthState {
  user: User | null;
  session: Session | null;
}

/** Current session, or null. Reads Supabase's persisted session. */
export async function getSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session ?? null;
}

/** Sign in with email + password. Throws with a readable message on failure. */
export async function signIn(email: string, password: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("No backend configured.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/**
 * Subscribe to auth changes. Fires immediately is NOT guaranteed by Supabase,
 * so callers should also check getSession() once on boot. Returns an
 * unsubscribe function.
 */
export function onAuthChange(handler: (session: Session | null) => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}
