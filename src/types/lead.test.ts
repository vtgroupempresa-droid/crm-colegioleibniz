import { describe, expect, it } from 'vitest';
import { parseMetaLeadEntries } from './lead';

describe('parseMetaLeadEntries', () => {
  it('preserva atribuição e respostas por submissão', () => {
    const entries = parseMetaLeadEntries([
      {
        at: '2026-08-08T12:00:00.000Z',
        kind: 'first',
        leadgenId: 'leadgen-1',
        campaignId: 'campaign-1',
        campaignName: 'Matrículas 2027',
        formAnswers: [{ question: 'serie_do_aluno', answer: '6º ano' }],
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.formAnswers).toEqual([{ question: 'serie_do_aluno', answer: '6º ano' }]);
  });

  it('ignora entradas inválidas e normaliza reentrada', () => {
    expect(
      parseMetaLeadEntries([null, {}, { at: '2026-08-08T12:00:00.000Z', kind: 'reentry' }]),
    ).toMatchObject([{ kind: 'reentry', formAnswers: [] }]);
  });
});
