import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Lê `is_demo` do lead. Usado por Server Actions para herdar o flag em
 * activities/contact_attempts/appointments/deals criados na mesma transação.
 *
 * Se o lead não existir ou der erro, retorna `false` (produção) — segurança
 * por default para evitar contaminação acidental do ambiente real.
 */
export async function getLeadDemoFlag(leadId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from('leads')
    .select('is_demo')
    .eq('id', leadId)
    .maybeSingle();
  return data?.is_demo ?? false;
}
