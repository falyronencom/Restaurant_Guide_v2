/**
 * Description — Server Component (Brief 4).
 *
 * Renders establishment description as a native `<details>/<summary>` block.
 * On the web we keep it expanded by default (per Booking convention — больше
 * экранного пространства, чем на mobile). The `<details>` element is native
 * HTML — collapse/expand works without JavaScript. Server-only.
 */

export function Description({ text }: { text: string }) {
  return (
    <details
      // Brief 4 default-open per design discussion; user can collapse if long.
      open
      className='group rounded-l border border-border bg-background p-l'
    >
      <summary className='cursor-pointer list-none text-display-s font-display marker:hidden'>
        <span className='inline-flex items-center gap-s'>
          Описание
          <span
            aria-hidden='true'
            className='text-headline-l text-muted-foreground transition-transform group-open:rotate-180'
          >
            ⌄
          </span>
        </span>
      </summary>
      <div className='mt-m whitespace-pre-line text-body-l text-foreground'>
        {text}
      </div>
    </details>
  );
}
