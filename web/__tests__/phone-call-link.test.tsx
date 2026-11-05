/*
 * The phone link on the establishment page: opens the dialer and counts the tap
 * for the partner's «Звонки». The number must reach a phone: on a phone the
 * InfoCard is the only place with it (the sidebar's button is desktop-only), so
 * both places are checked through the components the page really renders.
 */

import { fireEvent, render, screen } from '@testing-library/react';

import { ContactSidebar } from '@/components/establishment/ContactSidebar';
import { InfoCard } from '@/components/establishment/InfoCard';
import { PhoneCallLink } from '@/components/establishment/PhoneCallLink';
import type { PublicEstablishmentDetail } from '@/lib/api/types';

jest.mock('@/components/establishment/MapPreview', () => ({
  MapPreview: () => null,
}));

const ID = '11111111-1111-4111-8111-111111111111';

const establishment = {
  id: ID,
  name: 'Васильки',
  address: 'пр. Независимости, 43',
  city: 'Минск',
  phone: '+375 29 123 45 67',
  average_rating: null,
  review_count: 0,
  price_range: null,
  working_hours: null,
  website: null,
  latitude: null,
  longitude: null,
} as unknown as PublicEstablishmentDetail;

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ status: 204 });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const tap = (link: HTMLElement) => {
  // jsdom has no dialer to navigate to; the handler is what is under test.
  link.addEventListener('click', (event) => event.preventDefault());
  fireEvent.click(link);
};

describe('PhoneCallLink', () => {
  it('opens the dialer with the number without spaces', () => {
    render(
      <PhoneCallLink establishmentId={ID} phone='+375 29 123 45 67'>
        позвонить
      </PhoneCallLink>,
    );

    expect(screen.getByRole('link', { name: 'позвонить' })).toHaveAttribute(
      'href',
      'tel:+375291234567',
    );
  });

  it('a tap posts to the site’s own route, surviving the page losing focus', () => {
    render(
      <PhoneCallLink establishmentId={ID} phone='+375 29 123 45 67'>
        позвонить
      </PhoneCallLink>,
    );

    tap(screen.getByRole('link', { name: 'позвонить' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/establishments/${ID}/track-call`);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
  });

  it('nothing is counted until the tap', () => {
    render(
      <PhoneCallLink establishmentId={ID} phone='+375 29 123 45 67'>
        позвонить
      </PhoneCallLink>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failing request or a broken fetch does not reach the visitor', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(
      <PhoneCallLink establishmentId={ID} phone='+375 29 123 45 67'>
        позвонить
      </PhoneCallLink>,
    );
    const link = screen.getByRole('link', { name: 'позвонить' });

    expect(() => tap(link)).not.toThrow();
    await Promise.resolve();

    global.fetch = (() => {
      throw new Error('no fetch');
    }) as unknown as typeof fetch;
    expect(() => tap(link)).not.toThrow();
  });
});

describe.each([
  ['InfoCard — the only number on a phone', InfoCard],
  ['ContactSidebar — the desktop button', ContactSidebar],
])('%s', (_title, Card) => {
  it('the number is a link and its tap is counted', () => {
    render(<Card establishment={establishment} />);

    const link = screen.getByRole('link', { name: /\+375 29 123 45 67/ });
    expect(link).toHaveAttribute('href', 'tel:+375291234567');

    tap(link);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/establishments/${ID}/track-call`,
    );
  });

  it('no phone — no link', () => {
    render(<Card establishment={{ ...establishment, phone: null }} />);

    expect(screen.queryByRole('link', { name: /\+375/ })).toBeNull();
  });
});
