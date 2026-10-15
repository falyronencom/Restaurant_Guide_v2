'use client';

import Image from 'next/image';
import { useState } from 'react';

import type { AvatarSource } from '@/lib/avatar-source';
import { cn } from '@/lib/utils';

/*
 * ReviewAvatar — the author circle of ReviewCard: the photo the server card
 * chose (lib/avatar-source decides where it may come from; a refused address
 * never reaches this island), the colored initial otherwise — and also when the
 * photo fails to load. That fallback needs the browser's onError, hence a
 * client island inside the server card; next/image re-requests the photo after
 * hydration when onError is set, so a failure that happened before hydration
 * still reaches it.
 */

// Stable avatar tint by author name (design uses a small varied palette).
const AVATAR_COLORS = [
  'bg-brand',
  'bg-success-status',
  'bg-figma-navy',
  'bg-[#A07A52]',
] as const;

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function ReviewAvatar({
  name,
  photo,
}: {
  name: string;
  photo: AvatarSource | null;
}) {
  // The address that failed rather than a flag: a card re-rendered with
  // another photo shows it instead of keeping the letter.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = photo && photo.src !== failedSrc ? photo : null;

  return (
    <div
      className={cn(
        'relative flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-full font-display text-[16px] font-bold text-text-on-primary',
        avatarColor(name),
      )}
    >
      {shown ? (
        <Image
          src={shown.src}
          alt={name}
          fill
          sizes='42px'
          unoptimized={!shown.optimized}
          // A sign-in photo comes straight from Google/Yandex: they see the
          // guest's address but need not see which page asked (both serve
          // without a Referer — checked 12.10.2026).
          referrerPolicy='no-referrer'
          className='object-cover'
          onError={() => setFailedSrc(shown.src)}
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}
