/**
 * Geração e download de CSV no client (Fase 6 — "Exportar CSV" por seção).
 *
 * O Pedro abre esses arquivos no Excel/Sheets para devolver ao marketing.
 * Usamos `;` como separador (padrão pt-BR do Excel) e BOM UTF-8 para que
 * acentos não quebrem ao abrir no Excel do Windows.
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Aspas duplas escapadas + envolve em aspas se houver separador/quebra/aspas.
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(';'));
  return lines.join('\r\n');
}

export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly CsvCell[][],
): void {
  const csv = toCsv(headers, rows);
  // BOM (U+FEFF) para o Excel detectar UTF-8.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
