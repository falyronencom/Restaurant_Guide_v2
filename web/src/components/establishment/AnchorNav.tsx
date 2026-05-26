'use client';

/**
 * AnchorNav — Client island (Brief 4).
 *
 * Booking-style sticky section navigation. Renders horizontal anchor link row,
 * highlights the currently-visible section via IntersectionObserver.
 *
 * `'use client'` justification:
 *   - useState/useEffect required for active-section tracking
 *   - IntersectionObserver is a browser API, не существует на сервере
 *   - Sticky positioning itself — CSS-only (handled by parent / this nav's
 *     className `sticky top-0`), не требует JS; only the active-highlight
 *     does.
 *
 * Without JS the nav still renders + scrolls to anchors on click (native
 * browser behaviour) — just без active highlight. Progressive enhancement.
 *
 * Per Brief 3 OpenStatusBadge pattern: read external system (DOM positions)
 * via useEffect-on-mount, set local state from result.
 */

import { useEffect, useState } from 'react';

type AnchorItem = {
  id: string;
  label: string;
  /** Optional suffix like '(N)' for reviews count. */
  suffix?: string;
};

export function AnchorNav({ items }: { items: AnchorItem[] }) {
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) return;

    const elements = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el != null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the topmost section that's currently intersecting.
        // Sort intersecting entries by their boundingClientRect.top.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Trigger when section's top reaches ~30% from viewport top —
        // gives reasonable "active" semantics as user scrolls down.
        rootMargin: '-30% 0px -60% 0px',
        threshold: 0,
      },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label='Разделы заведения'
      className='sticky top-0 z-10 -mx-l overflow-x-auto border-b border-border bg-background/95 px-l py-s backdrop-blur'
      style={{ scrollbarWidth: 'none' }}
    >
      <ul className='flex gap-l whitespace-nowrap'>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={
                  isActive
                    ? 'inline-flex items-center gap-1 border-b-2 border-brand pb-s text-body-m font-medium text-foreground'
                    : 'inline-flex items-center gap-1 border-b-2 border-transparent pb-s text-body-m text-muted-foreground transition-colors hover:text-foreground'
                }
                aria-current={isActive ? 'true' : undefined}
              >
                {item.label}
                {item.suffix ? (
                  <span className='text-muted-foreground'>{item.suffix}</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
