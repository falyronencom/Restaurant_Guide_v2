'use client';

import type { ReactNode } from 'react';

import { reportCallTap } from '@/lib/track-call';

/**
 * The establishment's phone number as a link that opens the dialer and counts
 * the tap for the partner's «Звонки». Client leaf: the cards around it stay
 * Server Components.
 */
export function PhoneCallLink({
  establishmentId,
  phone,
  className,
  children,
}: {
  establishmentId: string;
  phone: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`tel:${phone.replace(/\s/g, '')}`}
      className={className}
      onClick={() => reportCallTap(establishmentId)}
    >
      {children}
    </a>
  );
}
