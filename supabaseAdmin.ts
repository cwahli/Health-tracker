import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Safe WebSocket polyfill for Node < 22 realtime initialization without bundling ws into browser
if (typeof window === 'undefined' && typeof (globalThis as any).WebSocket === 'undefined') {
  try {
    // @ts-ignore
    const ws = typeof require !== 'undefined' ? require('ws') : null;
    if (ws) (globalThis as any).WebSocket = ws;
  } catch {
    (globalThis as any).WebSocket = class WebSocket {};
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured: boolean = !!(supabaseUrl && supabaseServiceRoleKey);

export const supabaseAdmin: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;
