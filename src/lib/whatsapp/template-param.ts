import { firstNameOf } from '@/lib/utils/format';

/**
 * Parâmetro de template da Meta não aceita quebra de linha/tab nem 4+ espaços
 * seguidos — achata um texto gerado pela IA para caber numa variável ({{mensagem}}).
 * client-safe (função pura).
 */
export function flattenForTemplateParam(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * Remove travessão/meia-risca do texto gerado pela IA — regra da casa (Pedro,
 * 2026-07-24): travessão é PROIBIDO em qualquer mensagem (a Helena abusava).
 * Após fim de frase vira espaço; no meio da frase vira vírgula; travessão de
 * abertura some. client-safe (função pura).
 */
export function stripEmDashes(text: string): string {
  let out = text.replace(/([.!?…])\s*[—–]\s*/g, '$1 ');
  out = out.replace(/^\s*[—–]\s*/gm, '');
  out = out.replace(/\s*[—–]+\s*/g, ', ');
  return out
    .replace(/,\s*([,.!?…])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Normaliza para comparação sem acento e sem caixa. */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR');
}

// "Oi", "Olá,", "Ei!", "Bom dia"… no INÍCIO do texto.
const GREETING_RE = /^(?:oi+|ol[áa]|ei|opa|bom dia|boa tarde|boa noite)(?=$|[\s,!.?…])[\s,!.?…]*/i;
// Título no início ("Dra.", "Dr(a).", "Doutora"…).
const HONORIFIC_RE = /^(?:dr\(a\)|dra|dr|doutora|doutor)\.?(?=$|[\s,!.?…])[\s,!.?…]*/i;
// "tudo bem?", "como vai?"… logo após a saudação.
const WELLBEING_RE = /^(?:tudo bem|tudo bom|td bem|como vai|como você está|como voce esta)[\s,!.?…]*/i;

/**
 * Remove do INÍCIO de um texto gerado pela IA a saudação redundante (oi/olá +
 * título + nome do lead + "tudo bem?"). Usado quando o texto entra na variável
 * {{mensagem}} de um template flexível cuja casca JÁ cumprimenta pelo nome —
 * caso real: saiu "Oi, Dr(a). Tatiane, tudo bem? … Oi Tatiane, fiquei
 * pensando…" (saudação e nome duplicados). Se a limpeza esvaziar o texto,
 * devolve o original (nunca destrói conteúdo).
 */
export function stripRedundantGreeting(text: string, leadName?: string | null): string {
  const original = text.trim();
  const first = firstNameOf(leadName);
  const nameTokens = new Set(
    (leadName ?? '')
      .split(/\s+/)
      .map(fold)
      .filter((t) => t.length > 0 && /\p{L}/u.test(t)),
  );
  if (first) nameTokens.add(fold(first));

  let out = original;
  for (let i = 0; i < 3; i += 1) {
    const before = out;
    out = out.replace(GREETING_RE, '');
    out = out.replace(HONORIFIC_RE, '');
    // Nome do lead (qualquer token do nome completo) no início.
    const word = out.match(/^([\p{L}'’-]+)[\s,!.?…]*/u);
    if (word && word[1] && nameTokens.has(fold(word[1]))) {
      out = out.slice(word[0].length);
    }
    out = out.replace(WELLBEING_RE, '');
    if (out === before) break;
  }
  out = out.trim();
  if (out.length < 10) return original;
  return out.charAt(0).toLocaleUpperCase('pt-BR') + out.slice(1);
}
