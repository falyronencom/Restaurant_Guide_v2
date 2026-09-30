/**
 * JSON for the body of a <script type="application/ld+json">.
 *
 * Inside <script> the HTML parser looks only for the end of the tag, and
 * JSON.stringify leaves `</script>` as it is: the text of a review, of a card
 * or of an OCR'd menu item closed the tag and ran as page markup (external
 * review 23.09.2026, #2). Every «<» therefore becomes its JSON escape (u003c) —
 * the tag cannot be closed and «<!--» cannot open a comment — and so do the
 * line separators U+2028/U+2029, as the Next.js JSON-LD guide advises
 * (node_modules/next/dist/docs/01-app/02-guides/json-ld.md). The output is still
 * the same JSON: JSON.parse returns the input unchanged.
 *
 * Its only caller is components/JsonLdScript.tsx — the one place web/src hands
 * a string to dangerouslySetInnerHTML (guard: __tests__/html-sink-guard.test.ts).
 */

// fromCharCode, not an escape in the source: a raw U+2028 in code ends the line.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function serializeJsonLd(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
}
