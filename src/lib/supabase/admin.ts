import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Cliente Supabase com a service role key — IGNORA RLS.
 *
 * Uso restrito ao servidor (Server Actions, Route Handlers de webhook, Edge
 * Functions) em operações que precisam escrever em nome de outro usuário ou
 * sem sessão autenticada, como:
 *  - criar notificações para o SDR/closer/CEO responsável (createNotification);
 *  - criar leads via webhook público (sem usuário logado).
 *
 * NUNCA importar a partir de código client ('use client'). O `server-only`
 * garante erro de build se isso acontecer.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function createAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para o admin client.',
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
