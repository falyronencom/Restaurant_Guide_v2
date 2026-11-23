/**
 * The sections of a card in the cabinet — the row under the card's header
 * (components/cabinet/card/CardSectionNav). One list: the next parts of the
 * thread add «Отзывы», «Статистика», «Акции» as one line each, with their
 * pages under app/(cabinet)/cabinet/[id]/<segment>.
 */

export const CARD_SECTIONS = [
  { segment: 'edit', label: 'Карточка' },
  { segment: 'menu', label: 'Меню' },
] as const;

export type CardSectionSegment = (typeof CARD_SECTIONS)[number]['segment'];

export function cardSectionHref(id: string, segment: CardSectionSegment): string {
  return `/cabinet/${encodeURIComponent(id)}/${segment}`;
}

/** The section a cabinet path belongs to — /cabinet/<id>/<segment>[/…] — or null. */
export function cardSectionOf(pathname: string | null): CardSectionSegment | null {
  const segment = pathname?.split('/')[3];
  return CARD_SECTIONS.find((s) => s.segment === segment)?.segment ?? null;
}
