/**
 * Attributes — Server Component (Brief 4).
 *
 * Renders boolean attribute keys (delivery/wifi/terrace/parking/live_music/
 * kids_zone/banquet/pets_allowed/smoking) as an icon-pill grid. Booking-style:
 * outlined rectangles, icon left + label right, responsive wrapping grid.
 *
 * Empty-state — if attributes object is null/empty/all-false, the section
 * renders nothing (caller may choose to omit the wrapper section entirely).
 * Mobile fallback (showing default amenities when none present) is NOT ported
 * — that's a mobile UX accommodation; on the web we prefer honest absence.
 */

import {
  ATTRIBUTE_ICONS,
  ATTRIBUTE_LABELS,
  extractActiveAttributes,
} from '@/lib/establishment-helpers';

export function Attributes({ attributes }: { attributes: unknown }) {
  const active = extractActiveAttributes(attributes);

  if (active.length === 0) return null;

  return (
    <div className='flex flex-col gap-m'>
      <h2 className='text-display-s font-display'>Атрибуты</h2>
      <ul className='grid grid-cols-2 gap-s sm:grid-cols-3 lg:grid-cols-4'>
        {active.map((key) => {
          const Icon = ATTRIBUTE_ICONS[key];
          const label = ATTRIBUTE_LABELS[key];
          if (!Icon || !label) return null;
          return (
            <li
              key={key}
              className='flex items-center gap-s rounded-m border border-border bg-background px-m py-s'
            >
              <Icon
                className='size-5 shrink-0 text-foreground'
                aria-hidden='true'
              />
              <span className='text-body-m text-foreground'>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
