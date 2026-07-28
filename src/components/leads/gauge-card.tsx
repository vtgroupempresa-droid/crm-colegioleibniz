'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

export type GaugeColor = 'blue' | 'red' | 'amber' | 'green' | 'purple';

export const GAUGE_COLORS: Record<GaugeColor, { stroke: string; text: string }> = {
  blue: { stroke: '#0284c7', text: 'text-sky-700' },
  red: { stroke: '#dc2626', text: 'text-red-600' },
  amber: { stroke: '#d97706', text: 'text-amber-600' },
  green: { stroke: '#059669', text: 'text-emerald-600' },
  purple: { stroke: '#7c3aed', text: 'text-violet-600' },
};

export type GaugePillTone = 'up' | 'down' | 'alert' | 'warn' | 'neutral';

const PILL_CLASSES: Record<GaugePillTone, string> = {
  up: 'bg-emerald-100 text-emerald-800',
  down: 'bg-red-100 text-red-800',
  alert: 'bg-red-100 text-red-800',
  warn: 'bg-amber-100 text-amber-800',
  neutral: 'bg-brand-100 text-brand-500',
};

// Geometria do arco semicircular (viewBox 0 0 120 64): raio 48, centro (60,58).
const ARC_RADIUS = 48;
const ARC_PATH = 'M 12 58 A 48 48 0 0 1 108 58';
const ARC_LENGTH = Math.PI * ARC_RADIUS;

interface GaugeCardProps {
  value: number;
  /** Referência para o preenchimento do arco (value/max, clampado em 1). */
  max: number;
  color: GaugeColor;
  label: string;
  /** Critério exato da métrica, exibido em texto pequeno sob o label. */
  description: string;
  /** Omitida nos mini dashboards das abas do financeiro (só label+descrição). */
  pill?: { text: string; tone: GaugePillTone };
  /** Texto formatado no lugar do número cru (ex.: "R$ 21,6k") — dashboard financeiro. */
  display?: string;
}

/**
 * Card do mini-dashboard de /leads: gauge SVG em meia-lua que anima do zero até
 * o valor ao montar (stroke-dasharray com easing de "agulha se ajustando").
 * O número fica em posição absoluta dentro de um wrapper de altura fixa —
 * nunca sobrepõe o arco nem depende de margin negativa.
 */
export function GaugeCard({ value, max, color, label, description, pill, display }: GaugeCardProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { stroke, text } = GAUGE_COLORS[color];
  const fraction = max > 0 ? Math.min(1, value / max) : 0;
  const dash = mounted ? fraction * ARC_LENGTH : 0;

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-brand-100 bg-white p-4">
      <div className="relative h-16 w-[120px]">
        <svg viewBox="0 0 120 64" className="h-full w-full" aria-hidden="true">
          <path
            d={ARC_PATH}
            fill="none"
            stroke="#e8e6df"
            strokeWidth={10}
            strokeLinecap="round"
          />
          <path
            d={ARC_PATH}
            fill="none"
            stroke={stroke}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${ARC_LENGTH}`}
            style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.34,1.56,.64,1)' }}
          />
        </svg>
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 text-center font-bold',
            display ? 'text-xl' : 'text-2xl tabular-nums',
            text,
          )}
        >
          {display ?? value.toLocaleString('pt-BR')}
        </span>
      </div>
      <p className="text-sm font-bold text-brand-700">{label}</p>
      <p className="text-center text-[11px] leading-tight text-brand-400">{description}</p>
      {pill && (
        <span
          className={cn(
            'mt-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-tight',
            PILL_CLASSES[pill.tone],
          )}
        >
          {pill.text}
        </span>
      )}
    </div>
  );
}
