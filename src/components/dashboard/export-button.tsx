'use client';

import { downloadCsv, type CsvCell } from '@/lib/dashboard/csv';
import { cn } from '@/lib/utils/cn';

interface ExportButtonProps {
  filename: string;
  headers: readonly string[];
  rows: readonly CsvCell[][];
  label?: string;
  className?: string;
}

/**
 * Botão "Exportar CSV" usado em cada seção do dashboard. Recebe os dados já
 * tabulados (headers + rows) e gera o arquivo no client — o Pedro devolve isso
 * pro marketing.
 */
export function ExportButton({
  filename,
  headers,
  rows,
  label = 'Exportar CSV',
  className,
}: ExportButtonProps) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, headers, rows)}
      disabled={rows.length === 0}
      className={cn(
        'focus-ring inline-flex items-center gap-1.5 rounded-md border border-brand-200 px-2.5 py-1 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
