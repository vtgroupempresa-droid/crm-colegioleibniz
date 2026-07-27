'use client';

import { useEffect, useState } from 'react';

/** Densidade dos cards do board: linha única escaneável vs. layout completo. */
export type BoardDensity = 'compact' | 'comfortable';

const STORAGE_KEY = 'kanban-density';

/**
 * Preferência de densidade do Kanban, persistida no localStorage por navegador.
 * Padrão 'compact'. Lida após montar para evitar mismatch de hidratação
 * (mesmo padrão da sidebar recolhida).
 */
export function useBoardDensity(): [BoardDensity, (next: BoardDensity) => void] {
  const [density, setDensity] = useState<BoardDensity>('compact');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'comfortable' || stored === 'compact') setDensity(stored);
  }, []);

  function update(next: BoardDensity) {
    setDensity(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return [density, update];
}
