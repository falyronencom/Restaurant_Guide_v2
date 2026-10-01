/**
 * Кнопка «Удалить» в кабинете — только у черновика и у отклонённой карточки,
 * которая ещё не была на сайте (внешний обзор 23.09.2026, #4a; ревью 30.09 и
 * решение Координатора 01.10.2026). То же правило, что у сервера
 * (DELETE … status IN ('draft', 'rejected') AND published_at IS NULL) и у
 * mobile.
 *
 * «Отклонена» бывает и у карточки, которая уже была на сайте: приостановка →
 * повторная отправка → отказ модератора. У неё отзывы, избранное и брони
 * гостей; сервер такую не удалит, поэтому кнопки у неё нет. Признак «была на
 * сайте» — published_at из списка кабинета: его ставит первое одобрение, и
 * ничто его не сбрасывает.
 */
import { render, screen } from '@testing-library/react';

import { EstablishmentVignette } from '@/components/cabinet/EstablishmentVignette';
import type {
  EstablishmentStatus,
  PartnerEstablishmentListing,
} from '@/lib/api/types';

const NAME = 'Кофейня у моста';

const card = (
  status: EstablishmentStatus,
  published_at: string | null,
): PartnerEstablishmentListing => ({
  id: 'est-1',
  partner_id: 'partner-1',
  name: NAME,
  description: null,
  city: 'Минск',
  address: 'ул. Немига, 5',
  latitude: null,
  longitude: null,
  phone: null,
  email: null,
  website: null,
  categories: ['Кофейня'],
  cuisines: [],
  price_range: null,
  status,
  subscription_tier: null,
  view_count: 0,
  favorite_count: 0,
  review_count: 0,
  average_rating: null,
  base_score: null,
  moderation_notes: null,
  primary_photo: null,
  created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  published_at,
});

/** Все статусы, которые кабинет знает (EstablishmentStatus). */
const STATUSES: EstablishmentStatus[] = [
  'draft',
  'pending',
  'active',
  'rejected',
  'suspended',
];

describe('EstablishmentVignette — кнопка удаления', () => {
  it('есть только у черновика и отклонённой карточки, которой не было на сайте', () => {
    const outcomes: Record<string, boolean> = {};
    for (const status of STATUSES) {
      for (const published of [false, true]) {
        const { unmount } = render(
          <EstablishmentVignette
            establishment={card(status, published ? '2026-07-20T10:00:00.000Z' : null)}
            onDeleted={() => {}}
          />,
        );
        outcomes[`${status}${published ? ' + была на сайте' : ''}`] =
          screen.queryByRole('button', { name: `Удалить «${NAME}»` }) !== null;
        unmount();
      }
    }

    expect(outcomes).toEqual({
      draft: true,
      'draft + была на сайте': false,
      pending: false,
      'pending + была на сайте': false,
      active: false,
      'active + была на сайте': false,
      rejected: true,
      'rejected + была на сайте': false,
      suspended: false,
      'suspended + была на сайте': false,
    });
  });
});
