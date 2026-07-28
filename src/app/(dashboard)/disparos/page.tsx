import { listBroadcastTemplates, listOfficialBroadcastTargets } from '@/actions/broadcasts';
import { BroadcastComposer } from '@/components/broadcasts/broadcast-composer';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Disparos · CRM Colégio Leibniz' };

/**
 * Disparos de template oficial (Meta) em lote — v1: leads que entraram em
 * contato pela instância oficial do WhatsApp. O template sai aprovado pela
 * Meta, então entrega mesmo fora da janela de 24h.
 */
export default async function DisparosPage() {
  const [templates, targets] = await Promise.all([
    listBroadcastTemplates(),
    listOfficialBroadcastTargets(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-2xl font-semibold text-brand-700">Disparos</h2>
        <p className="mt-1 text-sm text-brand-500">
          Envie um template oficial do WhatsApp para vários leads de uma vez. Por enquanto, o
          público é quem já falou com o número oficial (Cloud API).
        </p>
      </header>
      <BroadcastComposer templates={templates} initialTargets={targets} />
    </div>
  );
}
