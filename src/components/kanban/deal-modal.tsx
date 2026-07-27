'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { closeDeal, getLeadEnrollmentDefaults } from '@/actions/deals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatBRL } from '@/lib/utils/format';
import {
  EDUCATION_LEVELS,
  EDUCATION_LEVEL_LABELS,
  SCHOOL_YEARS_BY_LEVEL,
  type EducationLevel,
} from '@/types/lead';

interface DealModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
}

const PAYMENT_METHODS = ['pix', 'boleto', 'cartao_credito', 'transferencia', 'dinheiro'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  boleto: 'Boleto',
  cartao_credito: 'Cartão de crédito',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
};

const today = () => new Date().toISOString().slice(0, 10);
/** Ano letivo padrão: a matrícula fechada hoje vale para o ano seguinte. */
const nextSchoolYear = () => String(new Date().getFullYear() + 1);

const num = (value: string): number => {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Modal de fechamento de matrícula. Pré-preenche os dados do aluno com o que já
 * está no cadastro do responsável (nome do filho, nível de ensino, ano escolar)
 * — a secretaria só confirma e informa os valores. Ao salvar, `closeDeal` grava
 * a matrícula, move o lead para "Cliente Fechado" e notifica os admins.
 */
export function DealModal({ open, onClose, leadId, leadName }: DealModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  const [studentName, setStudentName] = useState('');
  const [educationLevel, setEducationLevel] = useState<EducationLevel | ''>('');
  const [schoolYear, setSchoolYear] = useState('');
  const [enrollmentYear, setEnrollmentYear] = useState(nextSchoolYear());
  const [contractValue, setContractValue] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [discountPct, setDiscountPct] = useState('');
  const [installments, setInstallments] = useState('12');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [signedAt, setSignedAt] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setSignedAt(today());
    setEnrollmentYear(nextSchoolYear());
    setLoading(true);
    getLeadEnrollmentDefaults(leadId)
      .then((defaults) => {
        if (!defaults) return;
        setStudentName(defaults.childName ?? '');
        setEducationLevel(defaults.educationLevel ?? '');
        setSchoolYear(defaults.schoolYear ?? '');
      })
      .finally(() => setLoading(false));
  }, [open, leadId]);

  const yearOptions = educationLevel ? SCHOOL_YEARS_BY_LEVEL[educationLevel] : [];

  function handleLevelChange(value: string) {
    const level = value as EducationLevel | '';
    setEducationLevel(level);
    // Ano escolar depende do nível — limpa se não pertencer ao novo nível.
    if (level && !SCHOOL_YEARS_BY_LEVEL[level].includes(schoolYear)) setSchoolYear('');
  }

  /** Mensalidade sugerida quando a anuidade é preenchida e a parcela ainda não. */
  const suggestedMonthly = (() => {
    const total = num(contractValue);
    const parts = Number(installments) || 0;
    if (total <= 0 || parts <= 0) return null;
    return total / parts;
  })();

  function handleSubmit() {
    if (!studentName.trim()) {
      toast.error('Informe o nome do aluno.');
      return;
    }
    if (!educationLevel) {
      toast.error('Selecione o nível de ensino.');
      return;
    }
    if (!schoolYear) {
      toast.error('Selecione o ano escolar.');
      return;
    }

    startTransition(async () => {
      const result = await closeDeal({
        leadId,
        studentName: studentName.trim(),
        educationLevel,
        schoolYear,
        enrollmentYear,
        contractValue: num(contractValue),
        monthlyValue: monthlyValue ? num(monthlyValue) : null,
        discountPct: discountPct ? num(discountPct) : null,
        installments: installments ? Number(installments) : null,
        paymentMethod: paymentMethod || null,
        signedAt,
        notes: notes.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error ?? 'Não foi possível registrar a matrícula.');
        return;
      }
      toast.success(`Matrícula de ${studentName.trim()} registrada!`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Fechar matrícula · ${leadName}`}>
      {loading ? (
        <p className="py-8 text-center text-sm text-brand-400">Carregando dados do cadastro…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-400">
              Aluno
            </p>
            <div className="flex flex-col gap-3">
              <Input
                label="Nome do aluno"
                name="student-name"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="Nome completo"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Nível de ensino"
                  name="education-level"
                  value={educationLevel}
                  onChange={(e) => handleLevelChange(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {EDUCATION_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {EDUCATION_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Ano escolar"
                  name="school-year"
                  value={schoolYear}
                  onChange={(e) => setSchoolYear(e.target.value)}
                  disabled={!educationLevel}
                >
                  <option value="">Selecione…</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                label="Ano letivo"
                name="enrollment-year"
                value={enrollmentYear}
                onChange={(e) => setEnrollmentYear(e.target.value)}
                className="w-32"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="rounded-md border border-brand-100 bg-brand-50 p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-400">
              Valores
            </p>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Anuidade (R$)"
                  name="contract-value"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
                <Input
                  label="Desconto (%)"
                  name="discount-pct"
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Parcelas"
                  name="installments"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value)}
                  inputMode="numeric"
                />
                <Input
                  label="Mensalidade (R$)"
                  name="monthly-value"
                  value={monthlyValue}
                  onChange={(e) => setMonthlyValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={suggestedMonthly ? suggestedMonthly.toFixed(2) : '0,00'}
                />
              </div>
              {suggestedMonthly !== null && !monthlyValue && (
                <button
                  type="button"
                  onClick={() => setMonthlyValue(suggestedMonthly.toFixed(2))}
                  className="focus-ring self-start text-xs font-medium text-brand-600 underline"
                >
                  Usar {formatBRL(suggestedMonthly)} por mês
                </button>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Forma de pagamento"
                  name="payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                >
                  <option value="">Selecione…</option>
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Data da matrícula"
                  name="signed-at"
                  type="date"
                  value={signedAt}
                  onChange={(e) => setSignedAt(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Textarea
            label="Observações"
            name="deal-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Combinados, condições especiais, irmãos matriculados…"
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Registrando…' : 'Registrar matrícula'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
