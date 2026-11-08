/**
 * Часы работы на странице заведения: таблица в InfoCard и разметка для поисковиков.
 *
 * Решение Координатора 06.11.2026: день без данных — не выходной. И ни гость, ни
 * поисковик не должны получить «25:99» или пустое время, которые мог сохранить
 * кабинет: разметка schema.org с таким временем — мусор в выдаче.
 */
import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';

import { InfoCard } from '@/components/establishment/InfoCard';
import { RestaurantSchema } from '@/components/establishment/RestaurantSchema';
import type { PublicEstablishmentDetail } from '@/lib/api/types';
import { normalizeWorkingHours } from '@/lib/establishment-helpers';

jest.mock('@/components/establishment/MapPreview', () => ({
  MapPreview: () => null,
}));

const NO_TIMES = { is_open: true, open: '', close: '' };

const establishment = (workingHours: unknown) =>
  ({
    id: 'est-1',
    slug: 'testo',
    name: 'Тесто',
    address: 'ул. Тестовая 1',
    city: 'Минск',
    phone: null,
    price_range: null,
    working_hours: workingHours,
    categories: ['Ресторан'],
    cuisines: [],
    latitude: null,
    longitude: null,
    primary_image_url: null,
    booking_enabled: false,
    review_count: 0,
    average_rating: null,
  }) as unknown as PublicEstablishmentDetail;

/** Строки таблицы часов: «Пн:» → «10:00 – 22:00». */
function rows(): Record<string, string> {
  const table = screen.getByRole('table', { hidden: true });
  return Object.fromEntries(
    within(table)
      .getAllByRole('row', { hidden: true })
      .map((row) => {
        const [day, time] = within(row).getAllByRole('cell', { hidden: true });
        return [day.textContent, time.textContent];
      }),
  );
}

describe('InfoCard — таблица часов', () => {
  it('выходной и день без данных — разные строки', () => {
    render(
      <InfoCard
        establishment={establishment({
          monday: '10:00-22:00',
          tuesday: { is_open: false },
          wednesday: NO_TIMES,
          friday: 'abc',
        })}
      />,
    );

    expect(rows()).toEqual({
      'Пн:': '10:00 – 22:00',
      'Вт:': 'Выходной',
      'Ср–Вс:': 'Не указано',
    });
  });

  it('время не попадает на страницу как есть: «25:99» — «Не указано»', () => {
    render(
      <InfoCard
        establishment={establishment({
          monday: { open: '25:99', close: '22:00' },
          tuesday: '10:00-22:00',
        })}
      />,
    );

    expect(rows()['Пн:']).toBe('Не указано');
    expect(screen.queryByText(/25:99/)).not.toBeInTheDocument();
  });

  it('вся неделя без данных — блока часов нет, а не «Не указано» семь раз', () => {
    render(<InfoCard establishment={establishment(Object.fromEntries(
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .map((day) => [day, NO_TIMES]),
    ))}
    />);

    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Сегодня')).not.toBeInTheDocument();
  });
});

describe('RestaurantSchema — часы в разметке', () => {
  function openingHours(workingHours: unknown) {
    const html = renderToStaticMarkup(
      <RestaurantSchema
        establishment={establishment(workingHours)}
        citySlug="minsk"
        categorySlug="restorany"
      />,
    );
    const json = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '{}';
    return JSON.parse(json).openingHoursSpecification;
  }

  it('в разметку идут только дни с обоими правильными временами', () => {
    expect(
      openingHours({
        monday: '10:00-22:00',
        tuesday: NO_TIMES,
        wednesday: { open: '25:99', close: '22:00' },
        thursday: { is_open: false },
        friday: { is_open: true, open: '12:00', close: '02:00' },
        saturday: 'abc',
        sunday: { open: 10, close: 22 },
      }),
    ).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '10:00', closes: '22:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Friday', opens: '12:00', closes: '02:00' },
    ]);
  });

  it('ни одного такого дня — поля нет', () => {
    expect(openingHours({ monday: NO_TIMES })).toBeUndefined();
    expect(openingHours(null)).toBeUndefined();
  });
});

describe('normalizeWorkingHours', () => {
  it('день — выходной или с обоими временами, остальное null', () => {
    expect(
      normalizeWorkingHours({
        monday: { open: '9:00', close: '22:00:00' },
        tuesday: { is_open: false, open: '10:00', close: '22:00' },
        wednesday: NO_TIMES,
        thursday: '25:99-abc',
      }),
    ).toMatchObject({
      monday: { is_open: true, open: '09:00', close: '22:00' },
      tuesday: { is_open: false },
      wednesday: null,
      thursday: null,
      friday: null,
    });
  });

  it('ничего не прочитано — null', () => {
    expect(normalizeWorkingHours({ monday: NO_TIMES })).toBeNull();
    expect(normalizeWorkingHours({})).toBeNull();
    expect(normalizeWorkingHours(null)).toBeNull();
    expect(normalizeWorkingHours('10:00-22:00')).toBeNull();
  });
});
