'use client';

import { useEffect, useState } from 'react';
import { GAUGE_COLORS, type GaugeColor } from '@/components/leads/gauge-card';
import { cn } from '@/lib/utils/cn';

export type GaugeDeltaTone = 'up' | 'down' | 'flat';

const DELTA_CLASSES: Record<GaugeDeltaTone, string> = {
  up: 'bg-emerald-50 text-emerald-700',
  down: 'bg-red-50 text-red-700',
  flat: 'bg-brand-50 text-brand-500',
};

const DELTA_ARROW: Record<GaugeDeltaTone, string> = { up: '↑', down: '↓', flat: '→' };

// Geometria do anel (viewBox 0 0 64 64): raio 28, circunferência 2πr.
const RING_RADIUS = 28;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

interface CircleGaugeCardProps {
  /** Valor já formatado, exibido no centro do círculo. */
  display: string;
  /** Preenchimento do anel (0..1). */
  fraction: number;
  color: GaugeColor;
  label: string;
  /** Critério exato da métrica, exibido em texto pequeno sob o label. */
  description: string;
  /** Delta vs período anterior, exibido como badge inline ao lado do label. */
  delta?: { text: string; tone: GaugeDeltaTone };
}

/**
 * Card de gauge horizontal: círculo COMPLETO à esquerda (anel preenchido via
 * stroke-dasharray, com o número centralizado por position absolute dentro do
 * wrapper do SVG) e, à direita, label + badge de delta na mesma linha e a
 * descrição abaixo. Padrão único dos KPIs Macro e do Ciclo de Matrícula — anima
 * do zero até o valor ao montar, como o GaugeCard de /leads.
 */
export function CircleGaugeCard({
  display,
  fraction,
  color,
  label,
  description,
  delta,
}: CircleGaugeCardProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { stroke, text } = GAUGE_COLORS[color];
  const clamped = Math.max(0, Math.min(1, fraction));
  const dash = mounted ? clamped * RING_LENGTH : 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-100 bg-white p-4">
      <div className="relative h-16 w-16 shrink-0">
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx={32} cy={32} r={RING_RADIUS} fill="none" stroke="#e8e6df" strokeWidth={7} />
          <circle
            cx={32}
            cy={32}
            r={RING_RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${RING_LENGTH}`}
            style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.34,1.56,.64,1)' }}
          />
        </svg>
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center font-bold tabular-nums',
            display.length > 5 ? 'text-[11px]' : 'text-sm',
            text,
          )}
        >
          {display}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <p className="text-sm font-bold leading-tight text-brand-700">{label}</p>
          {delta && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                DELTA_CLASSES[delta.tone],
              )}
              title="vs período anterior"
            >
              {DELTA_ARROW[delta.tone]}
              {delta.text}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] leading-tight text-brand-400">{description}</p>
      </div>
    </div>
  );
}
