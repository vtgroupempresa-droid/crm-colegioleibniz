import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

/** Credenciais ficam numa tabela sem acesso para anon/authenticated. */
export async function getWhatsappInstanceAccessToken(
  admin: DbClient,
  whatsappInstanceId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('whatsapp_instance_credentials')
    .select('access_token')
    .eq('whatsapp_instance_id', whatsappInstanceId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler credencial da linha: ${error.message}`);
  return data?.access_token ?? null;
}

export async function saveWhatsappInstanceAccessToken(
  admin: DbClient,
  whatsappInstanceId: string,
  accessToken: string,
): Promise<void> {
  const { error } = await admin.from('whatsapp_instance_credentials').upsert(
    {
      whatsapp_instance_id: whatsappInstanceId,
      access_token: accessToken,
    },
    { onConflict: 'whatsapp_instance_id' },
  );
  if (error) throw new Error(`Falha ao salvar credencial da linha: ${error.message}`);
}

export async function listWhatsappInstanceCredentialPreviews(
  admin: DbClient,
): Promise<Map<string, { hasToken: boolean; tokenPreview: string | null }>> {
  const { data, error } = await admin
    .from('whatsapp_instance_credentials')
    .select('whatsapp_instance_id, access_token');
  if (error) throw new Error(`Falha ao listar credenciais das linhas: ${error.message}`);

  return new Map(
    (data ?? []).map((row) => [
      row.whatsapp_instance_id,
      {
        hasToken: Boolean(row.access_token),
        tokenPreview: row.access_token ? `…${row.access_token.slice(-4)}` : null,
      },
    ]),
  );
}
