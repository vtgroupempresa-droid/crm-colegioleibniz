import { Badge } from '@/components/ui/badge';
import {
  TEMPERATURE_LABELS,
  leadTemperature,
  type LeadTemperature,
} from '@/lib/leads/temperature';

const TEMPERATURE_TONE: Record<LeadTemperature, 'danger' | 'warning' | 'info' | 'neutral'> = {
  superquente: 'danger',
  quente: 'warning',
  morno: 'info',
  frio: 'neutral',
};

/** Selo de temperatura (GHL) no card/drawer. Não renderiza nada se sem temperatura. */
export function TemperatureBadge({ tags }: { tags: readonly string[] | null | undefined }) {
  const temp = leadTemperature(tags);
  if (!temp) return null;
  return <Badge tone={TEMPERATURE_TONE[temp]}>{TEMPERATURE_LABELS[temp]}</Badge>;
}
