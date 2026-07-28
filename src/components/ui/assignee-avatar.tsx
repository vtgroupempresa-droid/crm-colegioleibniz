/** Cor do avatar por cargo do responsável. */
const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-brand-600',
  comercial: 'bg-emerald-500',
};

/** Iniciais: primeira letra do primeiro e do último nome (ex.: "Ana Bruna" → "AB"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/**
 * Bolinha com as iniciais do responsável (cor por role) — usada no card do
 * Kanban. Sem responsável → bolinha cinza com "?". Tooltip nativo com o nome.
 */
export function AssigneeAvatar({
  name,
  role,
  size = 'sm',
}: {
  name: string | null;
  role: string | null;
  size?: 'sm' | 'xs';
}) {
  const dim = size === 'xs' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]';
  if (!name) {
    return (
      <span
        className={`flex ${dim} items-center justify-center rounded-full bg-brand-200 font-semibold text-brand-500`}
        title="Sem responsável"
      >
        ?
      </span>
    );
  }
  const color = (role && ROLE_COLORS[role]) || 'bg-brand-400';
  return (
    <span
      className={`flex ${dim} items-center justify-center rounded-full ${color} font-semibold text-white`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
