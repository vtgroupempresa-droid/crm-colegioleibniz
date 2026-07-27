'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

interface TabsProps {
  items: readonly TabItem[];
  defaultTabId?: string;
}

export function Tabs({ items, defaultTabId }: TabsProps) {
  const initial = defaultTabId ?? items[0]?.id ?? '';
  const [active, setActive] = useState(initial);
  const current = items.find((i) => i.id === active) ?? items[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-brand-100">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActive(item.id)}
            className={cn(
              'focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              active === item.id
                ? 'border-brand-700 text-brand-700'
                : 'border-transparent text-brand-400 hover:text-brand-600',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
