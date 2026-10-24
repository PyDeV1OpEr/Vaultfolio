import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase is optional. When env credentials exist the app runs in cloud
 * mode (auth + Postgres + RLS); otherwise it starts in clearly-labeled
 * demo mode. The anon key is a public key by design; RLS enforces privacy.
 */
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseConfigured) throw new Error('Supabase is not configured');
  client ??= createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
