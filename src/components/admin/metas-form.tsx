'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getDashboardConfig, upsertDashboardConfig } from '@/actions/dashboard-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatBRL } from '@/lib/utils/format';

const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

interface ChannelRow {
  key: string;
  value: string;
}

interface MetasFormProps {
  initialMes: number;
  initialAno: number;
}

/**
 * Formulário de metas e investimentos por mês (Fase 6). Alimenta as barras de
 * meta e os KPIs de CAC/ROAS do Dashboard CEO. Ao trocar mês/ano, carrega o
 * registro existente (se houver) via Server Action.
 */
export function MetasForm({ initialMes, initialAno }: MetasFormProps) {
  const router = useRouter();
  const [mes, setMes] = useState(initialMes);
  const [ano, setAno] = useState(initialAno);

  const [metaLeads, setMetaLeads] = useState('');
  const [metaAgendamentos, setMetaAgendamentos] = useState('');
  const [metaVendas, setMetaVendas] = useState('');
  const [metaFaturamento, setMetaFaturamento] = useState('');
  const [investTotal, setInvestTotal] = useState('');
  const [channels, setChannels] = useState<ChannelRow[]>([]);

  const [isLoading, startLoad] = useTransition();
  const [isSaving, startSave] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const cfg = await getDashboardConfig(mes, ano);
      setMetaLeads(cfg ? String(cfg.meta_leads) : '');
      setMetaAgendamentos(cfg ? String(cfg.meta_agendamentos) : '');
      setMetaVendas(cfg ? String(cfg.meta_vendas) : '');
      setMetaFaturamento(cfg ? String(cfg.meta_faturamento) : '');
      setInvestTotal(cfg ? String(cfg.investimento_total_ads) : '');
      const canal = (cfg?.investimento_por_canal ?? {}) as Record<string, number>;
      const rows = Object.entries(canal).map(([key, value]) => ({ key, value: String(value) }));
      setChannels(rows);
    });
  }, [mes, ano]);

  const channelsTotal = channels.reduce((acc, c) => acc + (Number(c.value) || 0), 0);

  function updateChannel(index: number, patch: Partial<ChannelRow>) {
    setChannels((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addChannel() {
    setChannels((prev) => [...prev, { key: '', value: '' }]);
  }

  function removeChannel(index: number) {
    setChannels((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const investimento_por_canal: Record<string, number> = {};
    for (const { key, value } of channels) {
      const k = key.trim();
      if (!k) continue;
      investimento_por_canal[k] = Number(value) || 0;
    }
    startSave(async () => {
      const result = await upsertDashboardConfig({
        mes,
        ano,
        meta_leads: Number(metaLeads) || 0,
        meta_agendamentos: Number(metaAgendamentos) || 0,
        meta_vendas: Number(metaVendas) || 0,
        meta_faturamento: Number(metaFaturamento) || 0,
        investimento_total_ads: Number(investTotal) || 0,
        investimento_por_canal,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Metas de ${MESES[mes - 1]}/${ano} salvas`);
      router.refresh();
    });
  }

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
        <Select
          label="Mês"
          value={mes}
          onChange={(e) => setMes(Number(e.target.value))}
          disabled={isLoading || isSaving}
        >
          {MESES.map((nome, i) => (
            <option key={nome} value={i + 1}>
              {nome}
            </option>
          ))}
        </Select>
        <Select
          label="Ano"
          value={ano}
          onChange={(e) => setAno(Number(e.target.value))}
          disabled={isLoading || isSaving}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Input
          label="Meta de leads"
          type="number"
          min={0}
          step="1"
          value={metaLeads}
          onChange={(e) => setMetaLeads(e.target.value)}
        />
        <Input
          label="Meta de agendamentos"
          type="number"
          min={0}
          step="1"
          value={metaAgendamentos}
          onChange={(e) => setMetaAgendamentos(e.target.value)}
        />
        <Input
          label="Meta de vendas"
          type="number"
          min={0}
          step="1"
          value={metaVendas}
          onChange={(e) => setMetaVendas(e.target.value)}
        />
        <Input
          label="Meta de faturamento (R$)"
          type="number"
          min={0}
          step="0.01"
          value={metaFaturamento}
          onChange={(e) => setMetaFaturamento(e.target.value)}
        />
      </div>

      <Input
        label="Investimento total em ads (R$)"
        type="number"
        min={0}
        step="0.01"
        value={investTotal}
        onChange={(e) => setInvestTotal(e.target.value)}
        className="sm:max-w-xs"
      />

      <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">
            Investimento por canal
          </p>
          <button
            type="button"
            onClick={addChannel}
            className="focus-ring rounded-md border border-brand-200 bg-white px-2 py-1 text-xs text-brand-600 hover:bg-brand-100"
          >
            + Adicionar canal
          </button>
        </div>

        {channels.length === 0 ? (
          <p className="mt-2 text-xs text-brand-400">
            Nenhum canal detalhado. Ex.: meta_ads, linkedin, indicacao.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {channels.map((row, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) => updateChannel(i, { key: e.target.value })}
                  placeholder="canal (ex: meta_ads)"
                  className="focus-ring h-9 flex-1 rounded-md border border-brand-200 bg-white px-2 text-sm text-brand-700"
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.value}
                  onChange={(e) => updateChannel(i, { value: e.target.value })}
                  placeholder="R$"
                  className="focus-ring h-9 w-32 rounded-md border border-brand-200 bg-white px-2 text-sm text-brand-700"
                />
                <button
                  type="button"
                  onClick={() => removeChannel(i)}
                  className="focus-ring rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  aria-label="Remover canal"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {channels.length > 0 && (
          <p className="mt-2 text-xs text-brand-500">
            Soma por canal: <strong>{formatBRL(channelsTotal)}</strong>
            {Number(investTotal) > 0 && channelsTotal !== Number(investTotal) && (
              <span className="ml-1 text-amber-700">
                (difere do total informado: {formatBRL(Number(investTotal))})
              </span>
            )}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSaving || isLoading}>
          {isSaving ? 'Salvando...' : 'Salvar metas'}
        </Button>
        {isLoading && <span className="text-xs text-brand-400">Carregando mês...</span>}
      </div>
    </form>
  );
}
