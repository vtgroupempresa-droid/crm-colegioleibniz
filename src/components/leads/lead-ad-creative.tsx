'use client';

/**
 * Criativo do anúncio que trouxe o lead — bloco em destaque da seção "Origem do
 * lead". Versão enxuta: mostra o nome do anúncio/criativo vindo da atribuição
 * Meta. (O preview oficial da Meta e a capa do vídeo dependiam do módulo de
 * Meta Ads do CRM original; quando a integração Traffic AI entrar, este card
 * pode voltar a buscar o preview sob demanda.)
 */
export function LeadAdCreative({ adId, adName }: { adId: string; adName: string | null }) {
  if (!adName) return null;
  void adId;

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-xl border border-brand-100 bg-brand-50/60 p-3.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-500">
        Criativo
      </span>
      <span className="break-all text-[13px] font-medium leading-[1.45] text-brand-800">
        {adName}
      </span>
    </div>
  );
}
