'use client';

import type { ReactNode } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';

/*
 * Shows its children to the author of the review(s) it wraps, to no one else
 * (thread «Отзыв без текста», Trunk's decision 22.11.2026): the card shows
 * reviews with text to everyone (В1), and an author's own review of one
 * rating to that author alone, so they can see, edit and delete it.
 *
 * Ownership resolves client-side — the ISR detail page reads no cookies,
 * mirroring WriteReviewCta / OwnReviewControls — so on the server and for any
 * other visitor this renders nothing. `authorIds`: any of them; a switched-off
 * author (null) matches no one.
 */
export function OnlyForAuthor({
  authorIds,
  children,
}: {
  authorIds: (string | null)[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !authorIds.some((id) => id !== null && id === user.id)) {
    return null;
  }
  return <>{children}</>;
}
