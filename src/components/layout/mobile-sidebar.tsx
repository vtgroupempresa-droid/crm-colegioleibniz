'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MenuIcon, XIcon } from '@/components/ui/icons';
import { Sidebar } from './sidebar';
import type { UserRole } from '@/types/user';

interface MobileSidebarProps {
  userName: string;
  userRole: UserRole;
  chatUnread?: number;
}

/**
 * Menu mobile (< md): a sidebar sai do fluxo e vira uma gaveta lateral aberta
 * pelo botão hambúrguer no canto superior esquerdo do header. Fecha ao navegar,
 * ao tocar no backdrop ou no X.
 */
export function MobileSidebar({ userName, userRole, chatUnread = 0 }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Fecha ao trocar de rota (link da gaveta ou navegação por trás).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="focus-ring -ml-1 flex h-10 w-10 items-center justify-center rounded-md text-brand-600 hover:bg-brand-100 md:hidden"
      >
        <MenuIcon size={22} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
          <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              userName={userName}
              userRole={userRole}
              chatUnread={chatUnread}
              variant="drawer"
              onNavigate={() => setOpen(false)}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar menu"
              className="focus-ring absolute right-2 top-4 flex h-10 w-10 items-center justify-center rounded-md text-brand-500 hover:bg-brand-100"
            >
              <XIcon size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
