export const BOT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function isBotSessionExpired(updatedAt: string, now = Date.now()): boolean {
  const timestamp = new Date(updatedAt).getTime();
  return !Number.isFinite(timestamp) || now - timestamp >= BOT_SESSION_TTL_MS;
}
