'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getLeadForms, previewTestLeadAds, type TestLeadPreview } from '@/actions/meta-integrations';
import type { LeadForm } from '@/lib/meta/client';
import type { MetaConfigStatus } from '@/lib/meta/config';

interface MetaPanelsProps {
  status: MetaConfigStatus;
}

function StatusBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge tone="success">Conectado</Badge>
  ) : (
    <Badge tone="warning">Não configurado</Badge>
  );
}

/** Webhook URL completo (somente no client). */
function useWebhookUrl(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/api/meta/webhook`;
}

function NotConfiguredHint() {
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Credenciais ainda não configuradas. Adicione as variáveis da Meta no{' '}
      <code>.env.local</code> (veja <code>.env.example</code>) e reinicie o app. A estrutura já
      está pronta — assim que as credenciais chegarem, tudo passa a funcionar.
    </p>
  );
}

function LeadAdsTab({ status }: { status: MetaConfigStatus }) {
  const webhookUrl = useWebhookUrl();
  const [forms, setForms] = useState<LeadForm[] | null>(null);
  const [testLead, setTestLead] = useState<TestLeadPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadForms() {
    startTransition(async () => {
      const result = await getLeadForms();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data.configured) {
        toast.message('Meta não configurada — sem formulários para listar ainda.');
        setForms([]);
        return;
      }
      setForms(result.data.forms);
    });
  }

  function runTest() {
    startTransition(async () => {
      const result = await previewTestLeadAds();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setTestLead(result.data);
      toast.success('Teste executado (lead fictício, não gravado)');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Webhook do Lead Ads</p>
          <StatusBadge ok={status.verifyTokenConfigured && status.appConfigured} />
        </div>
        <div className="flex flex-col gap-1 text-xs text-brand-500">
          <span>
            URL: <code className="text-brand-700">{webhookUrl}</code>
          </span>
          <span>
            Token de verificação: {status.verifyTokenConfigured ? 'definido ✓' : 'pendente'}
          </span>
          <span>App secret (assinatura): {status.appConfigured ? 'definido ✓' : 'pendente'}</span>
        </div>
        {!status.appConfigured && <NotConfiguredHint />}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Formulários ativos</p>
          <Button size="sm" variant="secondary" onClick={loadForms} disabled={isPending}>
            Carregar formulários
          </Button>
        </div>
        {forms === null ? (
          <p className="text-xs text-brand-400">
            Clique em &quot;Carregar formulários&quot; para listar os formulários da conta.
          </p>
        ) : forms.length === 0 ? (
          <p className="text-xs text-brand-400">
            Nenhum formulário disponível (conta não conectada ou sem formulários).
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-brand-50">
            {forms.map((form) => (
              <li key={form.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-brand-700">{form.name}</span>
                <Badge tone={form.status === 'ACTIVE' ? 'success' : 'neutral'}>{form.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Testar webhook</p>
          <Button size="sm" onClick={runTest} disabled={isPending}>
            Testar com lead fictício
          </Button>
        </div>
        {testLead && (
          <div className="rounded-md border border-brand-100 bg-brand-50/50 p-3 text-xs">
            <p className="font-medium text-brand-700">{testLead.name}</p>
            <p className="text-brand-500">
              {testLead.phone} · {testLead.email} · origem {testLead.source}
            </p>
            <p className="mt-1 text-brand-500">
              ad_creative: <span className="font-medium text-brand-700">{testLead.adCreative}</span>
              {testLead.campaignTheme && (
                <>
                  {' '}
                  · tema: <span className="font-medium text-brand-700">{testLead.campaignTheme}</span>
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {testLead.tags.map((t) => (
                <Badge key={t} tone="info">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function WhatsappTab({ status }: { status: MetaConfigStatus }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Conexão do WhatsApp</p>
          <StatusBadge ok={status.whatsappConfigured} />
        </div>
        <div className="flex flex-col gap-1 text-xs text-brand-500">
          <span>
            Phone Number ID:{' '}
            <code className="text-brand-700">{status.whatsappPhoneNumberId ?? 'pendente'}</code>
          </span>
        </div>
        {!status.whatsappConfigured ? (
          <NotConfiguredHint />
        ) : (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Atenção: o token exibido no painel da Meta expira em 24h. Para produção, gere um token
            permanente via Business Manager → Usuários do Sistema (permissões
            whatsapp_business_messaging + whatsapp_business_management).
          </p>
        )}
      </Card>
    </div>
  );
}

function InstagramTab({ status }: { status: MetaConfigStatus }) {
  function reconnect() {
    toast.message(
      status.instagramConfigured
        ? 'Reconexão disponível quando integrarmos o OAuth da Meta.'
        : 'Configure as credenciais do Instagram no .env.local primeiro.',
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-medium text-brand-700">Conexão do Instagram</p>
          <StatusBadge ok={status.instagramConfigured} />
        </div>
        <div className="flex flex-col gap-1 text-xs text-brand-500">
          <span>
            Página vinculada:{' '}
            <code className="text-brand-700">{status.instagramPageId ?? 'pendente'}</code>
          </span>
        </div>
        {!status.instagramConfigured && <NotConfiguredHint />}
        <div>
          <Button size="sm" variant="secondary" onClick={reconnect}>
            Reconectar
          </Button>
        </div>
      </Card>
    </div>
  );
}

export function MetaPanels({ status }: MetaPanelsProps) {
  const tabs: TabItem[] = [
    { id: 'leadads', label: 'Lead Ads', content: <LeadAdsTab status={status} /> },
    { id: 'whatsapp', label: 'WhatsApp', content: <WhatsappTab status={status} /> },
    { id: 'instagram', label: 'Instagram', content: <InstagramTab status={status} /> },
  ];
  return <Tabs items={tabs} />;
}
