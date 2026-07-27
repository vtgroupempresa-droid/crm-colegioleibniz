import type { LeadSource } from '@/types/lead';

/**
 * Cores por origem do lead — mesma associação semântica das pills de /leads
 * (meta_ads azul, whatsapp verde, instagram rosa, orgânico roxo, indicação
 * âmbar, presencial/telefone teal). Fontes sem cor própria caem no cinza
 * neutro, como "Reentrada".
 */
export const SOURCE_DOT_CLASSES: Partial<Record<LeadSource, string>> = {
  meta_ads: 'bg-sky-500',
  whatsapp: 'bg-emerald-500',
  instagram: 'bg-pink-500',
  telefone: 'bg-teal-500',
  presencial: 'bg-teal-600',
  site: 'bg-indigo-500',
  organico: 'bg-violet-500',
  indicacao: 'bg-amber-500',
  evento: 'bg-orange-500',
};

export const SOURCE_DOT_DEFAULT = 'bg-brand-300';

export const SOURCE_TEXT_CLASSES: Partial<Record<LeadSource, string>> = {
  meta_ads: 'text-sky-700',
  whatsapp: 'text-emerald-700',
  instagram: 'text-pink-700',
  telefone: 'text-teal-700',
  presencial: 'text-teal-700',
  site: 'text-indigo-700',
  organico: 'text-violet-700',
  indicacao: 'text-amber-700',
  evento: 'text-orange-700',
};

export const SOURCE_TEXT_DEFAULT = 'text-brand-600';
