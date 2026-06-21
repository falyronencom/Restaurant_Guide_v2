/**
 * Attributes — Server Component.
 *
 * Renders active boolean attribute keys as warm-beige pills with a brand line
 * icon (the shared AmenityIcon — same lucide set as the catalog filter pills).
 *
 * Empty-state — if attributes is null/empty/all-false, renders nothing.
 */

import { AmenityIcon } from '@/components/AmenityIcon';
import {
  ATTRIBUTE_LABELS,
  extractActiveAttributes,
} from '@/lib/establishment-helpers';

export function Attributes({ attributes }: { attributes: unknown }) {
  const active = extractActiveAttributes(attributes);

  if (active.length === 0) return null;

  return (
    <div className='flex flex-col gap-3.5'>
      <h2 className='font-display text-[20px] font-semibold'>Атрибуты</h2>
      <ul className='flex flex-wrap gap-2.5'>
        {active.map((key) => {
          const label = ATTRIBUTE_LABELS[key];
          if (!label) return null;
          return (
            <li
              key={key}
              className='inline-flex items-center gap-2 rounded-m bg-figma-bg-warm px-4 py-3 text-body-m font-medium text-foreground'
            >
              <AmenityIcon slug={key} size={18} className='text-brand' />
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
