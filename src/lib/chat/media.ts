import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type DbClient = SupabaseClient<Database>;

const PUBLIC_MARKER = '/storage/v1/object/public/chat-media/';
const SIGNED_MARKER = '/storage/v1/object/sign/chat-media/';

/** Retorna o caminho interno quando a URL pertence ao bucket chat-media. */
export function chatMediaObjectPath(value: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, '');

  const publicIndex = value.indexOf(PUBLIC_MARKER);
  if (publicIndex >= 0) {
    return decodeURIComponent(value.slice(publicIndex + PUBLIC_MARKER.length).split('?')[0] ?? '');
  }
  const signedIndex = value.indexOf(SIGNED_MARKER);
  if (signedIndex >= 0) {
    return decodeURIComponent(value.slice(signedIndex + SIGNED_MARKER.length).split('?')[0] ?? '');
  }
  return null;
}

/** Assina apenas objetos internos; URLs externas permanecem inalteradas. */
export async function signChatMediaUrl(
  admin: DbClient,
  value: string | null,
  expiresInSeconds = 60 * 60,
): Promise<string | null> {
  const path = chatMediaObjectPath(value);
  if (!path) return value;

  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
