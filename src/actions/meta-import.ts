'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isConfigured, metaEnv } from '@/lib/meta/config';
import {
  importMetaLeads,
  listFormsWithCounts,
  type FormSummary,
  type ImportReport,
} from '@/lib/meta/import-core';
import { isPipelineKind, type PipelineKind } from '@/types/pipeline';
import type { ActionResult } from './leads';

/**
 * Server Actions da importação histórica de Lead Ads do Meta (Fase 11).
 * Restritas a admin/CEO. Reusam o núcleo livre de Next em import-core.ts
 * (o mesmo usado pelo script CLI).
 */

async function requireAdminOrCeo(): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  return me?.role === 'admin';
}

/** Token/página da Meta para importação (Instagram first, WhatsApp fallback). */
function resolveCredentials(): { token: string; pageId: string } | null {
  const token = isConfigured(metaEnv.instagramPageToken)
    ? metaEnv.instagramPageToken
    : metaEnv.whatsappToken;
  const pageId = metaEnv.instagramPageId;
  if (!isConfigured(token) || !isConfigured(pageId)) return null;
  return { token: token as string, pageId: pageId as string };
}

/** Lista formulários ativos com contagem e data do último lead. */
export async function getImportForms(): Promise<ActionResult<FormSummary[]>> {
  if (!(await requireAdminOrCeo())) return { ok: false, error: 'Acesso restrito ao admin' };
  const creds = resolveCredentials();
  if (!creds) return { ok: false, error: 'Credenciais da Meta não configuradas' };
  try {
    const forms = await listFormsWithCounts(creds.token, creds.pageId);
    return { ok: true, data: forms };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha ao listar formulários' };
  }
}

export interface RunImportInput {
  formId?: string | null;
  since?: string | null;
  limit?: number | null;
  pipeline: string;
  stage: string;
  dryRun: boolean;
}

/** Executa a importação e devolve o relatório completo. */
export async function runMetaImport(input: RunImportInput): Promise<ActionResult<ImportReport>> {
  if (!(await requireAdminOrCeo())) return { ok: false, error: 'Acesso restrito ao admin' };
  const creds = resolveCredentials();
  if (!creds) return { ok: false, error: 'Credenciais da Meta não configuradas' };

  const pipeline: PipelineKind = isPipelineKind(input.pipeline) ? input.pipeline : 'comercial';
  const stage = input.stage?.trim() || 'novo_lead';

  try {
    const report = await importMetaLeads(createAdminClient(), {
      token: creds.token,
      pageId: creds.pageId,
      formId: input.formId ?? null,
      since: input.since ?? null,
      limit: input.limit ?? null,
      pipeline,
      stage,
      dryRun: input.dryRun,
    });
    return { ok: true, data: report };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Falha na importação' };
  }
}
