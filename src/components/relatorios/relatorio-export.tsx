'use client';

import { ExportButton } from '@/components/dashboard/export-button';
import type { CsvCell } from '@/lib/dashboard/csv';
import type { RelatorioRow } from '@/actions/relatorios';

const HEADERS = [
  'Data de entrada',
  'Responsável (lead)',
  'Nível de ensino',
  'Etapa',
  'Valor da matrícula',
  'Campanha',
  'Anúncio',
  'Atendente',
  'Fechado por',
] as const;

// Data e valor em formato pt-BR para o Excel ler direto (separador `;`).
const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});
const MONEY_FMT = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface RelatorioExportProps {
  rows: readonly RelatorioRow[];
  filename: string;
}

/**
 * Gera o CSV do relatório a partir das linhas já carregadas no server. Reusa o
 * ExportButton do dashboard (BOM UTF-8 + `;`, abre no Excel/Sheets).
 */
export function RelatorioExport({ rows, filename }: RelatorioExportProps) {
  const csvRows: CsvCell[][] = rows.map((r) => [
    DATE_FMT.format(new Date(r.createdAt)),
    r.name,
    r.educationLabel ?? '',
    r.stageLabel,
    MONEY_FMT.format(r.valorMatricula),
    r.campanha ?? '',
    r.anuncio ?? '',
    r.responsavelName ?? '',
    r.fechadoPorName ?? '',
  ]);

  return <ExportButton filename={filename} headers={HEADERS} rows={csvRows} />;
}
