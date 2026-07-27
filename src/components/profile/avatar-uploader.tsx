'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';

interface AvatarUploaderProps {
  userId: string;
  name: string;
  currentUrl: string | null;
  /** Chamado com a nova URL pública após upload bem-sucedido. */
  onUploaded: (url: string) => void;
  size?: number;
}

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Upload de avatar para o bucket `avatars` do Supabase Storage.
 * Grava em `${userId}/avatar-<timestamp>.<ext>` (pasta = uid, exigido pelo RLS).
 * Reutilizado em /perfil e no onboarding.
 */
export function AvatarUploader({ userId, name, currentUrl, onUploaded, size = 80 }: AvatarUploaderProps) {
  const [preview, setPreview] = useState<string | null>(currentUrl);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('Imagem muito grande (máx. 2MB).');
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      setPreview(data.publicUrl);
      onUploaded(data.publicUrl);
      toast.success('Foto atualizada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha no upload.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={name}
          width={size}
          height={size}
          className="rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="flex items-center justify-center rounded-full bg-brand-700 font-semibold text-canvas"
          style={{ width: size, height: size, fontSize: size / 2.5 }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}

      <label
        className={cn(
          'focus-ring inline-flex h-10 cursor-pointer items-center rounded-md bg-brand-100 px-4 text-sm font-medium text-brand-700 hover:bg-brand-200',
          uploading && 'cursor-wait opacity-60',
        )}
      >
        {uploading ? 'Enviando...' : 'Alterar foto'}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={handleFile}
        />
      </label>
    </div>
  );
}
