/**
 * @jest-environment node
 */
/*
 * The card page asks lib/known-slugs.ts first (thread «Расходы посторонних»,
 * point 5, 03.11.2026): «not found» and a redirect to the card's own address
 * come without a call for the card — in the body and in the metadata alike —
 * and the verdict is asked for the address as requested.
 */
import { notFound, permanentRedirect } from 'next/navigation';

import EstablishmentPage, { generateMetadata } from '@/app/(public)/[city]/[category]/[slug]/page';
import { getBySlug } from '@/lib/api/endpoints/establishments';
import { getMetadata, validateCategorySlug, validateCitySlug } from '@/lib/api/endpoints/metadata';
import { slugVerdict } from '@/lib/known-slugs';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
jest.mock('@/lib/api/endpoints/establishments', () => ({
  getBySlug: jest.fn(),
  getMenuItems: jest.fn(),
  getReviews: jest.fn(),
}));
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));
jest.mock('@/lib/known-slugs', () => ({ slugVerdict: jest.fn() }));

const verdict = slugVerdict as jest.Mock;
const P = (city: string, category: string, slug: string) => Promise.resolve({ city, category, slug });

beforeEach(() => {
  jest.clearAllMocks();
  (getMetadata as jest.Mock).mockResolvedValue({ cities: [], categories: [], cuisines: [] });
  (validateCitySlug as jest.Mock).mockResolvedValue(true);
  (validateCategorySlug as jest.Mock).mockResolvedValue(true);
});

describe('a card under a foreign address, past the allowance', () => {
  beforeEach(() => {
    verdict.mockResolvedValue({ kind: 'redirect', path: '/minsk/restaurants/kofe-taym' });
  });

  it('the body redirects to the card\'s own address without asking for the card', async () => {
    await expect(EstablishmentPage({ params: P('grodno', 'bars', 'kofe-taym') })).rejects.toThrow('NEXT_REDIRECT');

    expect(permanentRedirect).toHaveBeenCalledWith('/minsk/restaurants/kofe-taym');
    expect(verdict).toHaveBeenCalledWith('kofe-taym', '/grodno/bars/kofe-taym');
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('the metadata points at the own address, without asking for the card', async () => {
    const meta = await generateMetadata({ params: P('grodno', 'bars', 'kofe-taym-2') });

    expect(meta.alternates).toEqual({ canonical: '/minsk/restaurants/kofe-taym' });
    expect(getBySlug).not.toHaveBeenCalled();
  });
});

describe('a slug the site does not ask about', () => {
  beforeEach(() => {
    verdict.mockResolvedValue({ kind: 'not-found' });
  });

  it('the body is «не найдено» without asking for the card', async () => {
    await expect(EstablishmentPage({ params: P('minsk', 'restaurants', 'net-takogo') })).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalled();
    expect(getBySlug).not.toHaveBeenCalled();
  });

  it('the tab says «Заведение не найдено»', async () => {
    const meta = await generateMetadata({ params: P('minsk', 'restaurants', 'net-takogo-2') });

    expect(meta.title).toBe('Заведение не найдено');
    expect(getBySlug).not.toHaveBeenCalled();
  });
});
