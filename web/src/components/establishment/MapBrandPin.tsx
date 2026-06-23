import { Utensils } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Brand establishment map pin — the web mirror of the mobile canvas marker
 * (mobile/lib/widgets/map/map_marker_painter.dart): a brand-orange teardrop
 * with a white border, a white fork-and-knife glyph, and a soft drop shadow.
 * Replaces the generic lucide MapPin on the location map.
 *
 * Decorative (aria-hidden). The tip is at the bottom of the 40×48 box, so a
 * caller anchors that point to the mapped location — e.g. pass
 * `-translate-y-full` so the tip sits on the map centre. The outer span is its
 * own positioning context (the fork-knife is absolutely centred on the disc);
 * `cn` lets a caller's `absolute` override the base `relative` without losing
 * that context.
 */
export function MapBrandPin({ className }: { className?: string }) {
  return (
    <span
      className={cn('relative inline-block h-12 w-10', className)}
      aria-hidden='true'
    >
      <svg viewBox='0 0 40 48' className='h-12 w-10 drop-shadow-md'>
        <path
          d='M20 2C12.27 2 6 8.27 6 16c0 10.5 14 28 14 28s14-17.5 14-28C34 8.27 27.73 2 20 2z'
          className='fill-brand'
          stroke='#fff'
          strokeWidth='3'
        />
      </svg>
      <Utensils
        size={17}
        strokeWidth={2.4}
        className='absolute left-1/2 top-[16px] -translate-x-1/2 -translate-y-1/2 text-white'
      />
    </span>
  );
}
