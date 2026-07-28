'use client';

import { cn } from '@/lib/utils/cn';

/**
 * Interruptor mestre liga/desliga de uma IA (componente controlado — o editor
 * é dono do estado). Desligado = a IA não responde ninguém; ligado = a IA opera.
 * O clique dispara `onToggle`, que salva na hora (controle total pelo painel).
 */
export function AiMasterSwitch({
  enabled,
  pending,
  onToggle,
  openaiConfigured,
}: {
  enabled: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
  openaiConfigured: boolean;
}) {
  const blocked = !enabled && !openaiConfigured;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4',
        enabled ? 'border-emerald-200 bg-emerald-50' : 'border-brand-200 bg-brand-50',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-bold',
            enabled ? 'bg-emerald-600 text-white' : 'bg-brand-300 text-brand-700',
          )}
        >
          {enabled ? 'IA LIGADA' : 'IA DESLIGADA'}
        </span>
        <p className="text-sm text-brand-600">
          {enabled
            ? 'A IA está operando com leads reais.'
            : 'A IA não responde ninguém enquanto estiver desligada.'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        disabled={pending || blocked}
        role="switch"
        aria-checked={enabled}
        className={cn(
          'focus-ring relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          enabled ? 'bg-emerald-600' : 'bg-brand-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform',
            enabled ? 'translate-x-9' : 'translate-x-1',
          )}
        />
      </button>

      {blocked && (
        <p className="w-full text-xs text-amber-700">
          Para ligar, é preciso configurar a chave da OpenAI (OPENAI_API_KEY) no ambiente.
        </p>
      )}
    </div>
  );
}
