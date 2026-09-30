import { serializeJsonLd } from '@/lib/json-ld';

/**
 * JsonLdScript — Schema.org JSON-LD as a standalone <script> (Server Component).
 *
 * The one place in web/src that hands a string to dangerouslySetInnerHTML, and
 * that string always comes from serializeJsonLd: the payload carries text other
 * people write — reviews, card names and addresses, OCR'd menu items — and bare
 * JSON.stringify let it close the tag (external review 23.09.2026, #2).
 * Guard: __tests__/html-sink-guard.test.ts.
 */
export function JsonLdScript({ data }: { data: object }) {
  return (
    <script
      type='application/ld+json'
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
