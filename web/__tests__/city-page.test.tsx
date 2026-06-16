/**
 * FOUNDATIONAL PATTERN — testing an async React Server Component.
 *
 * Per the installed Next's own guide (node_modules/next/dist/docs/01-app/
 * 02-guides/testing/jest.md): "async Server Components ... Jest currently does
 * not support them" inside the React render tree. The working, non-hacky unit
 * pattern — used here — is:
 *
 *   1. Mock the data layer at the API-CLIENT boundary (@/lib/api/endpoints/*),
 *      NOT the network. The Server Component then runs its REAL logic.
 *   2. Invoke the async component as a function and `await` its returned
 *      element:  const ui = await CityPage({ params: Promise.resolve({...}) })
 *   3. render(ui) with React Testing Library and assert on the DOM.
 *
 * `params` is a Promise in Next 16 (Discovery Q4c) — we pass Promise.resolve.
 * This pattern transfers 1:1 to richer pages (e.g. the [slug] detail page);
 * CityPage is the foundational target because its children are synchronous,
 * so the awaited element tree renders cleanly under RTL.
 */
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';

import CityPage from '@/app/(public)/[city]/page';
import { getMetadata, validateCitySlug } from '@/lib/api/endpoints/metadata';

// notFound() throws in real Next to halt rendering — mirror that so the
// invalid-slug branch is observable as a rejection.
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// The mock boundary: the typed API client. Bare jest.fn()s (return values set
// per test) — avoids the resetMocks factory-wipe trap (Foxtrot-1).
jest.mock('@/lib/api/endpoints/metadata', () => ({
  getMetadata: jest.fn(),
  validateCitySlug: jest.fn(),
  validateCategorySlug: jest.fn(),
}));

const mockMetadata = {
  cities: [{ slug: 'minsk', name: 'Минск' }],
  categories: [
    { slug: 'restorany', name: 'Рестораны' },
    { slug: 'bary', name: 'Бары' },
  ],
  cuisines: [],
};

describe('CityPage — async Server Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the city heading and a link per known category', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(true);
    (getMetadata as jest.Mock).mockResolvedValue(mockMetadata);

    const ui = await CityPage({ params: Promise.resolve({ city: 'minsk' }) });
    render(ui);

    // h1 shows the Russian display name resolved from metadata, NOT the raw
    // slug ('minsk') — mirrors generateMetadata's title resolution.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Минск',
    );
    expect(screen.getByRole('link', { name: 'Рестораны' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Бары' })).toBeInTheDocument();
    expect(validateCitySlug).toHaveBeenCalledWith('minsk');
  });

  it('calls notFound() for an unknown city slug', async () => {
    (validateCitySlug as jest.Mock).mockResolvedValue(false);

    await expect(
      CityPage({ params: Promise.resolve({ city: 'atlantis' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(notFound).toHaveBeenCalledTimes(1);
    // Short-circuits before fetching page data.
    expect(getMetadata).not.toHaveBeenCalled();
  });
});
