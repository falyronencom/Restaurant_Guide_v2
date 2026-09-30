/**
 * JSON-LD не выпускает текст из <script type="application/ld+json">.
 *
 * Три компонента вставляли JSON-LD через `dangerouslySetInnerHTML` с голым
 * JSON.stringify, а он не экранирует `</script>`: текст, закрывающий тег,
 * становился разметкой страницы (внешний обзор 23.09.2026, #2; основа —
 * воспроизведение из итога обзора). Источники текста — все чужие:
 *   - отзыв пишет любой пользователь, виден сразу (reviews.is_visible DEFAULT true);
 *   - название и описание карточки — партнёр, правки одобренной карточки
 *     уходят без модерации;
 *   - названия позиций меню — выход OCR-модели по фото партнёра.
 *
 * Проверка идёт путём настоящей атаки: серверный рендер в HTML-строку и
 * HTML-парсер браузера (DOMParser). Клиентский render() из testing-library
 * этот путь не проходит — он кладёт строку через innerHTML, где разбор другой.
 * Утверждается безопасное поведение: ровно один <script>, и полезная нагрузка
 * при этом доходит как данные (JSON.parse возвращает исходный текст).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { MenuBlock } from '@/components/establishment/MenuBlock';
import { RestaurantSchema } from '@/components/establishment/RestaurantSchema';
import { ReviewSchema } from '@/components/establishment/ReviewSchema';
import type {
  PublicEstablishmentDetail,
  PublicMenuItem,
  PublicReview,
} from '@/lib/api/types';

const BREAKOUT = '</script><script>window.__pwned = document.cookie</script>';
// Разделители строк U+2028/U+2029 — законный JSON, но не всякий JS-парсер их
// в строке принимает; экранируются заодно (руководство Next по JSON-LD).
// Через fromCharCode, а не escape-последовательностью в исходнике: сырой
// U+2028 в коде — конец строки, и в литерале регулярного выражения он ломает разбор.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const SEPARATORS = `строка${LS}раздел${PS}конец`;

const establishment = {
  id: 'est-1', slug: 'testo', name: 'Тесто', description: null, city: 'Минск', city_slug: 'minsk',
  address: 'ул. Тестовая 1', latitude: null, longitude: null, phone: null, website: null,
  categories: ['Ресторан'], category_slug: 'restorany', cuisines: [], price_range: null,
  working_hours: null, attributes: null, status: 'active', primary_image_url: null,
  review_count: 1, average_rating: 5, favorite_count: 0, booking_enabled: false,
  has_promotion: false, promotion_count: 0, published_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  email: null, special_hours: null, view_count: 0, media: [], promotions: [],
} as PublicEstablishmentDetail;

const review = {
  id: 'rev-1', establishment_id: 'est-1', rating: 5,
  content: `Вкусно!${BREAKOUT}`,
  partner_response: null, partner_response_at: null, is_edited: false,
  created_at: '2026-02-01T12:00:00.000Z', updated_at: '2026-02-01T12:00:00.000Z',
  author: { id: 'u-1', name: 'Иван', avatar_url: null },
} as PublicReview;

const menuItem: PublicMenuItem = {
  id: 'i1', establishment_id: 'est-1', item_name: `Драники${BREAKOUT}`, price_byn: 12.5,
  category_raw: `Горячее${SEPARATORS}`, position: 0, quality_tier: 'clean',
};

/** Серверный рендер → HTML-парсер браузера → все <script> документа. */
const scriptsAfterSsr = (element: ReactElement) => {
  const html = renderToStaticMarkup(element);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
    'text/html',
  );
  return { html, scripts: Array.from(doc.querySelectorAll('script')) };
};

describe.each([
  {
    name: 'ReviewSchema — текст отзыва',
    element: (
      <ReviewSchema establishment={establishment} reviews={[review]} citySlug='minsk' categorySlug='restorany' />
    ),
    payload: (json: { review: { reviewBody: string }[] }) => json.review[0].reviewBody,
    expected: review.content,
  },
  {
    name: 'RestaurantSchema — название и адрес карточки',
    element: (
      <RestaurantSchema
        establishment={{ ...establishment, name: `Тесто${BREAKOUT}`, address: `ул. Тестовая 1${SEPARATORS}` }}
        citySlug='minsk'
        categorySlug='restorany'
      />
    ),
    payload: (json: { name: string; address: { streetAddress: string } }) =>
      `${json.name}|${json.address.streetAddress}`,
    expected: `Тесто${BREAKOUT}|ул. Тестовая 1${SEPARATORS}`,
  },
  {
    name: 'MenuBlock — позиции меню из OCR',
    element: <MenuBlock menuItems={[menuItem]} menuPhotos={[]} pdfFallbacks={[]} establishmentName='Тесто' />,
    payload: (json: { hasMenuSection: { name: string; hasMenuItem: { name: string }[] }[] }) =>
      `${json.hasMenuSection[0].name}|${json.hasMenuSection[0].hasMenuItem[0].name}`,
    expected: `Горячее${SEPARATORS}|Драники${BREAKOUT}`,
  },
])('$name', ({ element, payload, expected }) => {
  test('текст не выходит из <script type="application/ld+json">', () => {
    const { scripts } = scriptsAfterSsr(element);

    expect(scripts.map((s) => s.type)).toEqual(['application/ld+json']);
  });

  test('текст доходит как данные: JSON разбирается и возвращает исходную строку', () => {
    const { scripts } = scriptsAfterSsr(element);

    expect(payload(JSON.parse(scripts[0].textContent ?? ''))).toBe(expected);
  });

  test('в разметке один конец тега, а внутри JSON-LD нет ни «<», ни сырых U+2028/U+2029', () => {
    const { html } = scriptsAfterSsr(element);
    const open = '<script type="application/ld+json">';
    const start = html.indexOf(open) + open.length;
    const body = html.slice(start, html.indexOf('</script>', start));

    // Счёт по всей строке, а не по вырезанному телу: вырезка остановилась бы
    // на внедрённом </script> и «<» внутри не увидела бы никогда.
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('<');
    expect({ LS: body.includes(LS), PS: body.includes(PS) }).toEqual({ LS: false, PS: false });
  });
});
