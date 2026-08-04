import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendOfficialInteractiveList,
  sendOfficialMessage,
  type OfficialInteractiveList,
} from '@/lib/whatsapp/official-client';
import type { OfficialVia } from '@/lib/meta/client';
import type { Database, Json, Tables } from '@/types/database';
import type { MessageType } from '@/types/chat';

type DbClient = SupabaseClient<Database>;
type BotSession = Tables<'conversation_bot_sessions'>;

export type LeibnizBotState =
  | 'awaiting_sector'
  | 'sales_awaiting_name'
  | 'sales_awaiting_interest'
  | 'sales_awaiting_segment'
  | 'sales_awaiting_age_or_grade'
  | 'sales_awaiting_next_step'
  | 'sales_awaiting_faq'
  | 'sales_awaiting_visit_availability'
  | 'sales_awaiting_student_data'
  | 'human_handoff'
  | 'completed';

interface BotContext {
  responsibleName?: string;
  interest?: string;
  segment?: string;
  ageOrGrade?: string;
  availability?: string;
}

interface BotInbound {
  conversationId: string;
  leadId: string | null;
  whatsappInstanceId: string;
  from: string;
  contactName: string | null;
  isNewConversation: boolean;
  botEnabled: boolean;
  via: OfficialVia;
  message: {
    type: MessageType;
    content: string | null;
    interactiveId: string | null;
  };
}

const ACTIVE_STATES = new Set<LeibnizBotState>([
  'awaiting_sector',
  'sales_awaiting_name',
  'sales_awaiting_interest',
  'sales_awaiting_segment',
  'sales_awaiting_age_or_grade',
  'sales_awaiting_next_step',
  'sales_awaiting_faq',
  'sales_awaiting_visit_availability',
  'sales_awaiting_student_data',
]);

const SECTOR_OPTIONS = [
  {
    slug: 'comercial',
    id: 'sector:comercial',
    title: 'Comercial e Matrículas',
    description: 'Vagas, visitas e proposta pedagógica',
  },
  {
    slug: 'educacao_infantil',
    id: 'sector:educacao_infantil',
    title: 'Educação Infantil',
    description: 'Coordenação da Educação Infantil',
  },
  {
    slug: 'fundamental_anos_iniciais',
    id: 'sector:fundamental_anos_iniciais',
    title: 'Fundamental I',
    description: 'Coordenação do 1º ao 5º ano',
  },
  {
    slug: 'fundamental_anos_finais_medio',
    id: 'sector:fundamental_anos_finais_medio',
    title: 'Fundamental II e Médio',
    description: 'Coordenação do 6º ano ao Ensino Médio',
  },
  {
    slug: 'secretaria',
    id: 'sector:secretaria',
    title: 'Secretaria',
    description: 'Documentos, matrícula e vida escolar',
  },
  {
    slug: 'financeiro',
    id: 'sector:financeiro',
    title: 'Financeiro',
    description: 'Mensalidades, boletos e condições',
  },
  {
    slug: 'marketing',
    id: 'sector:marketing',
    title: 'Marketing',
    description: 'Parcerias, eventos e comunicação',
  },
] as const;

const SECTOR_MENU: OfficialInteractiveList = {
  header: 'Colégio Leibniz',
  body: 'Olá! 👋 Para direcionar você sem espera, escolha o setor com quem deseja conversar:',
  footer: 'Sua conversa ficará visível apenas para a equipe escolhida.',
  button: 'Escolher setor',
  sections: [
    {
      title: 'Setores',
      rows: SECTOR_OPTIONS.map(({ id, title, description }) => ({ id, title, description })),
    },
  ],
};

const INTEREST_MENU: OfficialInteractiveList = {
  body: 'Agora me conta: você está buscando informações para:',
  button: 'Escolher opção',
  sections: [
    {
      rows: [
        { id: 'sales:matricula', title: 'Matricular meu filho(a)', description: 'Próximo ano letivo' },
        { id: 'sales:transferencia', title: 'Transferir de escola', description: 'Conhecer vagas e proposta' },
        { id: 'sales:conhecer', title: 'Só conhecer o colégio', description: 'Sem compromisso' },
        { id: 'sales:outro_assunto', title: 'Já sou responsável', description: 'Escolher outro setor' },
      ],
    },
  ],
};

const SEGMENT_MENU: OfficialInteractiveList = {
  body: 'Perfeito! Para qual etapa você está buscando vaga?',
  button: 'Escolher etapa',
  sections: [
    {
      rows: [
        { id: 'segment:infantil', title: 'Educação Infantil' },
        { id: 'segment:fundamental_1', title: 'Fundamental I', description: '1º ao 5º ano' },
        { id: 'segment:fundamental_2', title: 'Fundamental II', description: '6º ao 9º ano' },
        { id: 'segment:medio', title: 'Ensino Médio', description: '1ª e 2ª série' },
        { id: 'segment:pre_enem', title: '3º ano / Terceirão', description: 'Preparatório' },
      ],
    },
  ],
};

const NEXT_STEP_MENU: OfficialInteractiveList = {
  body: 'Como você prefere continuar?',
  button: 'Próximo passo',
  sections: [
    {
      rows: [
        { id: 'next:visit', title: 'Agendar uma visita', description: 'Conhecer o colégio de perto' },
        { id: 'next:documents', title: 'Matrícula e documentos', description: 'Falar com a Secretaria' },
        { id: 'next:faq', title: 'Tenho outra dúvida', description: 'Ver perguntas frequentes' },
        { id: 'next:human', title: 'Falar com a equipe', description: 'Atendimento humano' },
      ],
    },
  ],
};

const FAQ_MENU: OfficialInteractiveList = {
  body: 'Qual assunto você quer consultar?',
  button: 'Ver assuntos',
  sections: [
    {
      rows: [
        { id: 'faq:schedule', title: 'Horário das aulas' },
        { id: 'faq:uniform', title: 'Uniforme' },
        { id: 'faq:tutoring', title: 'Reforço e monitoria' },
        { id: 'faq:enem', title: 'ENEM e vestibulares' },
        { id: 'faq:price', title: 'Valores e condições' },
        { id: 'faq:transport', title: 'Transporte ou bolsas' },
        { id: 'faq:location', title: 'Localização' },
        { id: 'faq:assessment', title: 'Avaliação e notas' },
        { id: 'faq:team', title: 'Falar com a equipe' },
      ],
    },
  ],
};

function sessionContext(raw: Json): BotContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as BotContext;
}

function normalizeText(value: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function sectorSlugFromMessage(interactiveId: string | null, content: string | null): string | null {
  if (interactiveId?.startsWith('sector:')) return interactiveId.slice('sector:'.length);
  const text = normalizeText(content);
  const match = SECTOR_OPTIONS.find((option) => {
    const terms: Record<string, string[]> = {
      comercial: ['comercial', 'matricula', 'venda', 'vaga'],
      educacao_infantil: ['infantil', 'crianca pequena'],
      fundamental_anos_iniciais: ['fundamental i', 'fundamental 1', 'anos iniciais'],
      fundamental_anos_finais_medio: [
        'fundamental ii',
        'fundamental 2',
        'anos finais',
        'ensino medio',
        'terceirao',
      ],
      secretaria: ['secretaria', 'documento', 'historico escolar'],
      financeiro: ['financeiro', 'boleto', 'mensalidade', 'pagamento'],
      marketing: ['marketing', 'parceria', 'evento', 'divulgacao'],
    };
    return terms[option.slug].some((term) => text.includes(term));
  });
  return match?.slug ?? null;
}

async function updateSession(
  admin: DbClient,
  conversationId: string,
  patch: Partial<BotSession>,
): Promise<void> {
  await admin.from('conversation_bot_sessions').update(patch).eq('conversation_id', conversationId);
}

async function recordBotOutbound(
  admin: DbClient,
  input: {
    conversationId: string;
    type: 'text' | 'interactive';
    content: string;
    externalMessageId: string | null;
    delivered: boolean;
    state: LeibnizBotState;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from('messages').insert({
    conversation_id: input.conversationId,
    direction: 'outbound',
    type: input.type,
    content: input.content,
    external_message_id: input.externalMessageId,
    status: input.delivered ? 'sent' : 'failed',
    sender_type: 'bot',
    sent_by: null,
    sent_at: now,
    metadata: { bot: { state: input.state } } as unknown as Json,
  });
  await admin
    .from('conversations')
    .update({ last_message_at: now })
    .eq('id', input.conversationId);
  await updateSession(admin, input.conversationId, { last_bot_message_at: now });
}

async function sendBotText(
  admin: DbClient,
  input: Pick<BotInbound, 'conversationId' | 'from' | 'via'>,
  state: LeibnizBotState,
  content: string,
): Promise<boolean> {
  const result = await sendOfficialMessage(input.from, { type: 'text', content }, input.via);
  await recordBotOutbound(admin, {
    conversationId: input.conversationId,
    type: 'text',
    content,
    externalMessageId: result.ok ? result.data.messageId : null,
    delivered: result.ok,
    state,
  });
  if (!result.ok) console.error('[leibniz-bot] falha no envio:', result.error);
  return result.ok;
}

async function sendBotList(
  admin: DbClient,
  input: Pick<BotInbound, 'conversationId' | 'from' | 'via'>,
  state: LeibnizBotState,
  list: OfficialInteractiveList,
): Promise<boolean> {
  const result = await sendOfficialInteractiveList(input.from, list, input.via);
  await recordBotOutbound(admin, {
    conversationId: input.conversationId,
    type: 'interactive',
    content: list.body,
    externalMessageId: result.ok ? result.data.messageId : null,
    delivered: result.ok,
    state,
  });
  if (!result.ok) console.error('[leibniz-bot] falha na lista:', result.error);
  return result.ok;
}

async function notifySector(
  admin: DbClient,
  sectorId: string,
  title: string,
  body: string,
  leadId: string | null,
): Promise<void> {
  const { data: users } = await admin.from('user_profiles').select('id').eq('sector_id', sectorId);
  if (!users?.length) return;
  await admin.from('notifications').insert(
    users.map((user) => ({
      user_id: user.id,
      type: 'novo_lead' as const,
      title,
      body,
      lead_id: leadId,
    })),
  );
}

async function transferToSector(
  admin: DbClient,
  input: BotInbound,
  slug: string,
  reason: string,
): Promise<{ id: string; name: string } | null> {
  const [{ data: sector }, { data: conversation }] = await Promise.all([
    admin.from('sectors').select('id, name').eq('slug', slug).eq('is_active', true).maybeSingle(),
    admin.from('conversations').select('sector_id').eq('id', input.conversationId).maybeSingle(),
  ]);
  if (!sector) return null;

  const { error } = await admin
    .from('conversations')
    .update({ sector_id: sector.id, assigned_to: null, status: 'open' })
    .eq('id', input.conversationId);
  if (error) return null;

  await admin.from('conversation_sector_transfers').insert({
    conversation_id: input.conversationId,
    from_sector_id: conversation?.sector_id ?? null,
    to_sector_id: sector.id,
    source: 'bot',
    reason,
  });
  await updateSession(admin, input.conversationId, {
    selected_sector_id: sector.id,
    routed_at: new Date().toISOString(),
  });
  return sector;
}

async function handoff(
  admin: DbClient,
  input: BotInbound,
  slug: string,
  reason: string,
  message?: string,
): Promise<void> {
  const sector = await transferToSector(admin, input, slug, reason);
  if (!sector) {
    await sendBotText(
      admin,
      input,
      'human_handoff',
      'Não consegui concluir o direcionamento agora. Nossa equipe comercial já foi avisada e vai continuar por aqui.',
    );
    return;
  }

  await updateSession(admin, input.conversationId, {
    state: 'human_handoff',
    fallback_count: 0,
  });
  await sendBotText(
    admin,
    input,
    'human_handoff',
    message ??
      `Pronto! Encaminhei sua conversa para ${sector.name}. A equipe recebeu seu histórico e continuará o atendimento por aqui.`,
  );
  await notifySector(
    admin,
    sector.id,
    `Nova conversa · ${sector.name}`,
    `${input.contactName ?? input.from} aguarda atendimento. Motivo: ${reason}.`,
    input.leadId,
  );
}

function differentialsFor(segment: string | undefined): string {
  const base =
    'Ótimo! Veja alguns diferenciais do Leibniz:\n\n📐 Intensificação em Matemática e Língua Portuguesa\n🌎 Projeto Bilíngue com 5 aulas semanais de inglês\n💰 Educação Financeira\n🎭 Teatro e 🤖 Robótica\n🌳 Projeto Raízes e Câmara de Avanço de Matemática\n⚽ Atividades extracurriculares.';
  if (segment === 'infantil') {
    return `${base}\n\n📖 O gosto pela leitura começa com obras lúdicas e adequadas à idade.\n📋 Gestor de Tarefas com a família sempre informada.`;
  }
  if (segment === 'fundamental_1') {
    return `${base}\n\n📖 Banca Literária: 12 obras por ano, com leitura, repertório e apresentação oral.`;
  }
  return `${base}\n\n📖 Banca Literária: 12 obras por ano.\n✍️ Redação modelo ENEM.\n🎯 Simulados com correção TRI.\n📋 Gestor de Tarefas com acompanhamento contínuo da família.`;
}

function scheduleAnswer(segment: string | undefined): string {
  if (segment === 'infantil') {
    return 'Educação Infantil:\n• Matutino: 7h às 11h30\n• Vespertino: 13h às 17h30';
  }
  if (segment === 'fundamental_1') {
    return 'Fundamental I:\n• Matutino: 7h às 12h10\n• Vespertino: 13h às 18h10';
  }
  if (segment === 'fundamental_2') {
    return 'Fundamental II:\n• Segunda a sexta: 7h às 12h20\n• Segunda também à tarde: 14h às 17h40';
  }
  if (segment === 'medio' || segment === 'pre_enem') {
    return 'Ensino Médio e Terceirão:\n• Segunda a sexta: 7h às 12h20\n• Terça e quarta também à tarde: 14h às 17h40, com monitorias e apoio de base.';
  }
  return 'Para informar o horário correto, preciso saber primeiro a etapa de ensino. Vou mostrar as opções novamente.';
}

async function answerFaq(
  admin: DbClient,
  input: BotInbound,
  session: BotSession,
  id: string | null,
): Promise<void> {
  const context = sessionContext(session.context);
  switch (id) {
    case 'faq:price':
      await handoff(
        admin,
        input,
        'financeiro',
        'Solicitação de valores ou condições',
        'Vou encaminhar você ao Financeiro para receber os valores e condições atualizados, sem risco de informação incorreta.',
      );
      return;
    case 'faq:transport':
      await handoff(
        admin,
        input,
        'secretaria',
        'Dúvida sobre transporte ou bolsa',
        'Vou encaminhar você à Secretaria para confirmar essa informação corretamente.',
      );
      return;
    case 'faq:assessment': {
      const educationSector =
        context.segment === 'infantil'
          ? 'educacao_infantil'
          : context.segment === 'fundamental_1'
            ? 'fundamental_anos_iniciais'
            : 'fundamental_anos_finais_medio';
      await handoff(
        admin,
        input,
        educationSector,
        'Dúvida pedagógica sobre avaliação e notas',
        'O colégio trabalha com avaliações parciais e globais por bimestre, tarefas em ciclos, redação e projetos pedagógicos. Encaminhei sua conversa à coordenação para detalhar conforme a série.',
      );
      return;
    }
    case 'faq:team':
      await updateSession(admin, input.conversationId, {
        state: 'awaiting_sector',
        fallback_count: 0,
      });
      await sendBotList(admin, input, 'awaiting_sector', SECTOR_MENU);
      return;
    case 'faq:schedule':
      await sendBotText(admin, input, 'sales_awaiting_next_step', scheduleAnswer(context.segment));
      break;
    case 'faq:uniform':
      await sendBotText(
        admin,
        input,
        'sales_awaiting_next_step',
        'Sim. O uniforme completo é obrigatório durante toda a permanência na escola: camiseta personalizada, calça ou bermuda do colégio e calçado fechado.',
      );
      break;
    case 'faq:tutoring':
      await sendBotText(
        admin,
        input,
        'sales_awaiting_next_step',
        'Temos monitorias de Matemática, Física, Química, Biologia e Língua Portuguesa. No Ensino Médio e Terceirão, elas integram o turno estendido.',
      );
      break;
    case 'faq:enem':
      await sendBotText(
        admin,
        input,
        'sales_awaiting_next_step',
        'A preparação inclui redação no modelo ENEM, simulados com correção TRI e parceria com o Sistema Farias Brito. No 3º ano, há simulados nos modelos ENEM, UNICAMP e UNESP.',
      );
      break;
    case 'faq:location':
      await sendBotText(
        admin,
        input,
        'sales_awaiting_next_step',
        'Estamos em Rondonópolis, MT. A equipe pode enviar a localização exata e ajudar a agendar sua visita.',
      );
      break;
    default:
      await sendBotList(admin, input, 'sales_awaiting_faq', FAQ_MENU);
      return;
  }
  await updateSession(admin, input.conversationId, {
    state: 'sales_awaiting_next_step',
    fallback_count: 0,
  });
  await sendBotList(admin, input, 'sales_awaiting_next_step', NEXT_STEP_MENU);
}

async function fallback(
  admin: DbClient,
  input: BotInbound,
  session: BotSession,
  menu: OfficialInteractiveList,
): Promise<void> {
  const nextCount = session.fallback_count + 1;
  if (nextCount >= 2) {
    await handoff(
      admin,
      input,
      sessionContext(session.context).segment === 'infantil'
        ? 'educacao_infantil'
        : 'comercial',
      'Duas tentativas sem compreensão',
      'Vou passar você para um de nossos atendentes, assim ninguém fica sem resposta. A equipe continuará por aqui.',
    );
    return;
  }
  await updateSession(admin, input.conversationId, { fallback_count: nextCount });
  await sendBotText(
    admin,
    input,
    session.state as LeibnizBotState,
    'Desculpa, não entendi bem 🙏 Escolha uma das opções abaixo ou reformule sua mensagem.',
  );
  await sendBotList(admin, input, session.state as LeibnizBotState, menu);
}

/** Decide se a notificação humana deve ser suprimida enquanto o bot conduz o fluxo. */
export async function isLeibnizBotHandling(
  admin: DbClient,
  conversationId: string,
  isNewConversation: boolean,
  botEnabled: boolean,
): Promise<boolean> {
  if (!botEnabled) return false;
  if (isNewConversation) return true;
  const { data } = await admin
    .from('conversation_bot_sessions')
    .select('state')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  return data ? ACTIVE_STATES.has(data.state as LeibnizBotState) : false;
}

/** Processa uma mensagem recebida usando o roteiro institucional determinístico. */
export async function handleLeibnizBotInbound(admin: DbClient, input: BotInbound): Promise<void> {
  if (!input.botEnabled) return;

  let { data: session } = await admin
    .from('conversation_bot_sessions')
    .select('*')
    .eq('conversation_id', input.conversationId)
    .maybeSingle();

  if (!session) {
    if (!input.isNewConversation) return;
    const created = await admin
      .from('conversation_bot_sessions')
      .insert({
        conversation_id: input.conversationId,
        whatsapp_instance_id: input.whatsappInstanceId,
        state: 'awaiting_sector',
      })
      .select('*')
      .single();
    if (!created.data) return;
    session = created.data;
    await sendBotList(admin, input, 'awaiting_sector', SECTOR_MENU);
    return;
  }

  const state = session.state as LeibnizBotState;
  if (!ACTIVE_STATES.has(state)) return;
  const text = input.message.content?.trim() ?? '';
  const choice = input.message.interactiveId;
  const context = sessionContext(session.context);

  if (normalizeText(text).includes('falar com atendente') || normalizeText(text) === 'humano') {
    await handoff(admin, input, 'comercial', 'Pedido explícito de atendimento humano');
    return;
  }

  if (state === 'awaiting_sector') {
    const slug = sectorSlugFromMessage(choice, text);
    if (!slug) {
      await fallback(admin, input, session, SECTOR_MENU);
      return;
    }
    if (slug !== 'comercial') {
      await handoff(admin, input, slug, `Setor escolhido no menu: ${slug}`);
      return;
    }
    await transferToSector(admin, input, 'comercial', 'Comercial escolhido no menu inicial');
    await updateSession(admin, input.conversationId, {
      state: 'sales_awaiting_name',
      fallback_count: 0,
    });
    await sendBotText(
      admin,
      input,
      'sales_awaiting_name',
      'Que bom que você chegou ao Colégio Leibniz — Uma Escola de Resultados de Alto Impacto. 🎓\n\nEu sou o assistente virtual do colégio. Para começar, qual é o seu nome?',
    );
    return;
  }

  if (state === 'sales_awaiting_name') {
    if (text.length < 2 || text.length > 100) {
      await fallback(admin, input, session, INTEREST_MENU);
      return;
    }
    const responsibleName = text.replace(/\s+/g, ' ');
    const nextContext = { ...context, responsibleName };
    await Promise.all([
      input.leadId
        ? admin.from('leads').update({ name: responsibleName }).eq('id', input.leadId)
        : Promise.resolve(),
      admin
        .from('conversations')
        .update({ contact_name: responsibleName })
        .eq('id', input.conversationId),
      updateSession(admin, input.conversationId, {
        state: 'sales_awaiting_interest',
        context: nextContext as unknown as Json,
        fallback_count: 0,
      }),
    ]);
    await sendBotText(
      admin,
      input,
      'sales_awaiting_interest',
      `${responsibleName}, antes de mais nada, deixa eu te contar rapidinho quem é o Leibniz 🎓\n\nSomos uma Escola de Resultados de Alto Impacto, com intensificação em Matemática e Língua Portuguesa, Projeto Bilíngue, Educação Financeira, Teatro, Robótica, Banca Literária e acompanhamento constante da família.`,
    );
    await sendBotList(admin, input, 'sales_awaiting_interest', INTEREST_MENU);
    return;
  }

  if (state === 'sales_awaiting_interest') {
    if (choice === 'sales:outro_assunto') {
      await updateSession(admin, input.conversationId, {
        state: 'awaiting_sector',
        fallback_count: 0,
      });
      await sendBotList(admin, input, 'awaiting_sector', SECTOR_MENU);
      return;
    }
    const interest = choice?.startsWith('sales:') ? choice.slice('sales:'.length) : null;
    if (!interest || !['matricula', 'transferencia', 'conhecer'].includes(interest)) {
      await fallback(admin, input, session, INTEREST_MENU);
      return;
    }
    await updateSession(admin, input.conversationId, {
      state: 'sales_awaiting_segment',
      context: { ...context, interest } as unknown as Json,
      fallback_count: 0,
    });
    await sendBotList(admin, input, 'sales_awaiting_segment', SEGMENT_MENU);
    return;
  }

  if (state === 'sales_awaiting_segment') {
    const segment = choice?.startsWith('segment:') ? choice.slice('segment:'.length) : null;
    if (!segment || !['infantil', 'fundamental_1', 'fundamental_2', 'medio', 'pre_enem'].includes(segment)) {
      await fallback(admin, input, session, SEGMENT_MENU);
      return;
    }
    if (input.leadId) {
      await admin
        .from('leads')
        .update({ education_level: segment as Database['public']['Enums']['education_level'] })
        .eq('id', input.leadId);
    }
    await updateSession(admin, input.conversationId, {
      state: 'sales_awaiting_age_or_grade',
      context: { ...context, segment } as unknown as Json,
      fallback_count: 0,
    });
    await sendBotText(
      admin,
      input,
      'sales_awaiting_age_or_grade',
      'E qual é a idade ou a série atual do aluno(a)?',
    );
    return;
  }

  if (state === 'sales_awaiting_age_or_grade') {
    if (text.length < 1 || text.length > 80) {
      await fallback(admin, input, session, NEXT_STEP_MENU);
      return;
    }
    const age = Number(text.match(/\d{1,2}/)?.[0]);
    if (input.leadId) {
      await admin
        .from('leads')
        .update({
          ...(Number.isInteger(age) && age >= 1 && age <= 25 ? { child_age: age } : {}),
          school_year: text,
        })
        .eq('id', input.leadId);
    }
    const nextContext = { ...context, ageOrGrade: text };
    await updateSession(admin, input.conversationId, {
      state: 'sales_awaiting_next_step',
      context: nextContext as unknown as Json,
      fallback_count: 0,
    });
    await sendBotText(admin, input, 'sales_awaiting_next_step', differentialsFor(context.segment));
    await sendBotList(admin, input, 'sales_awaiting_next_step', NEXT_STEP_MENU);
    return;
  }

  if (state === 'sales_awaiting_next_step') {
    if (choice === 'next:documents') {
      await handoff(
        admin,
        input,
        'secretaria',
        'Matrícula e documentos',
        'A Secretaria vai passar a lista atualizada de documentos e orientar os próximos passos. Encaminhei a conversa com tudo o que você já informou.',
      );
      return;
    }
    if (choice === 'next:human') {
      await handoff(admin, input, 'comercial', 'Pedido de atendimento comercial humano');
      return;
    }
    if (choice === 'next:faq') {
      await updateSession(admin, input.conversationId, {
        state: 'sales_awaiting_faq',
        fallback_count: 0,
      });
      await sendBotList(admin, input, 'sales_awaiting_faq', FAQ_MENU);
      return;
    }
    if (choice === 'next:visit') {
      await updateSession(admin, input.conversationId, {
        state: 'sales_awaiting_visit_availability',
        fallback_count: 0,
      });
      await sendBotText(
        admin,
        input,
        'sales_awaiting_visit_availability',
        'Combinado! Informe dois ou três horários que funcionam melhor para você, com dia da semana e período (manhã ou tarde).',
      );
      return;
    }
    await fallback(admin, input, session, NEXT_STEP_MENU);
    return;
  }

  if (state === 'sales_awaiting_faq') {
    await answerFaq(admin, input, session, choice);
    return;
  }

  if (state === 'sales_awaiting_visit_availability') {
    if (text.length < 4 || text.length > 500) {
      await fallback(admin, input, session, NEXT_STEP_MENU);
      return;
    }
    await updateSession(admin, input.conversationId, {
      state: 'sales_awaiting_student_data',
      context: { ...context, availability: text } as unknown as Json,
      fallback_count: 0,
    });
    await sendBotText(
      admin,
      input,
      'sales_awaiting_student_data',
      'Anotado! Para agilizar a confirmação, envie:\n• Nome completo do aluno(a)\n• Telefone para contato\n• E-mail (opcional)',
    );
    return;
  }

  if (state === 'sales_awaiting_student_data') {
    if (text.length < 3 || text.length > 1000) {
      await fallback(admin, input, session, NEXT_STEP_MENU);
      return;
    }
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
    const firstLine = text
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean);
    const childName = firstLine?.replace(/^(aluno|nome|filho|filha)\s*[:\-]\s*/i, '') ?? null;
    if (input.leadId) {
      const { data: lead } = await admin
        .from('leads')
        .select('is_demo, stage')
        .eq('id', input.leadId)
        .maybeSingle();
      await admin
        .from('leads')
        .update({
          child_name: childName,
          ...(email ? { email } : {}),
          qualification_status: 'quer_agendar_visita',
          qualification_next_action: 'agendar_visita',
          qualification_note: `Disponibilidade informada pelo bot: ${context.availability ?? 'não informada'}`,
          ...(lead?.stage === 'novo_lead' ? { stage: 'primeiro_contato' } : {}),
        })
        .eq('id', input.leadId);
      await admin.from('activities').insert({
        lead_id: input.leadId,
        user_id: null,
        type: 'system',
        title: 'Visita solicitada pelo WhatsApp',
        description: `Disponibilidade: ${context.availability ?? 'não informada'}\nDados enviados: ${text}`,
        is_demo: lead?.is_demo ?? false,
        metadata: {
          source: 'leibniz_bot',
          availability: context.availability ?? null,
        } as unknown as Json,
      });
    }
    await handoff(
      admin,
      input,
      'comercial',
      'Família qualificada solicitou agendamento de visita',
      `Perfeito, ${context.responsibleName ?? 'obrigado(a)'}! Registrei os dados e os horários sugeridos. A equipe comercial vai confirmar a visita por aqui.`,
    );
  }
}
