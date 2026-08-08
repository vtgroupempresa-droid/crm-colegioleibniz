import { vi, describe, expect, it } from 'vitest';

vi.mock('server-only', () => ({}));

import { chatMediaObjectPath } from './media';

describe('chatMediaObjectPath', () => {
  it('reconhece caminhos internos do bucket privado', () => {
    expect(chatMediaObjectPath('conversation-id/anexo.pdf')).toBe('conversation-id/anexo.pdf');
  });

  it('converte URLs públicas legadas em caminhos internos', () => {
    expect(
      chatMediaObjectPath(
        'https://project.supabase.co/storage/v1/object/public/chat-media/conversation-id/foto.jpg',
      ),
    ).toBe('conversation-id/foto.jpg');
  });

  it('não tenta assinar URLs externas', () => {
    expect(chatMediaObjectPath('https://cdn.example.com/foto.jpg')).toBeNull();
  });
});
