'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type BoardSearchState = [string, (next: string) => void];

const BoardSearchContext = createContext<BoardSearchState | null>(null);

/**
 * Termo de busca do board compartilhado entre a barra de filtros ("Buscar lead
 * nesta visão...") e o campo secundário do sub-header — os dois controlam a
 * MESMA busca em tempo real do Kanban. Provider client que envolve a subárvore
 * server de /oportunidades (o estado sobrevive à troca de aba/filtro).
 */
export function BoardSearchProvider({ children }: { children: ReactNode }) {
  const state = useState('');
  return <BoardSearchContext.Provider value={state}>{children}</BoardSearchContext.Provider>;
}

/**
 * Retorna o [term, setTerm] compartilhado, ou null fora do provider — quem
 * consome cai num estado local próprio nesse caso (board usado avulso).
 */
export function useBoardSearchTerm(): BoardSearchState | null {
  return useContext(BoardSearchContext);
}
