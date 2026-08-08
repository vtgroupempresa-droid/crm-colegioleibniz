import { describe, expect, it } from 'vitest';
import { BOT_SESSION_TTL_MS, isBotSessionExpired } from './bot-session';

describe('isBotSessionExpired', () => {
  const now = Date.parse('2026-08-08T15:00:00.000Z');

  it('mantém uma triagem recente', () => {
    expect(isBotSessionExpired(new Date(now - BOT_SESSION_TTL_MS + 1).toISOString(), now)).toBe(
      false,
    );
  });

  it('reinicia a triagem depois de 24 horas', () => {
    expect(isBotSessionExpired(new Date(now - BOT_SESSION_TTL_MS).toISOString(), now)).toBe(true);
  });

  it('trata datas inválidas como sessão expirada', () => {
    expect(isBotSessionExpired('data-inválida', now)).toBe(true);
  });
});
