/**
 * Headings of the catalog's «не найдено» pages. One string serves both the
 * page heading (not-found.tsx) and the browser tab (generateMetadata of the
 * page that calls notFound()), so the two cannot drift apart. Without the tab
 * title the tab showed the raw address: «urban-kitchen — bobruisk | Nirivio».
 */
export const NOT_FOUND_TITLE = {
  city: 'Город не найден',
  category: 'Категория не найдена',
  establishment: 'Заведение не найдено',
} as const;
