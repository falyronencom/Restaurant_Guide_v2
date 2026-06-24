/**
 * MapPreview — env-gated static-map rendering + deep-link into our own map.
 *
 * MapPreview is a sync Server Component (pure props + a process.env read, no
 * I/O), so it renders directly under RTL. This locks the integration the URL
 * unit tests can't see: the key in YANDEX_MAPS_API_KEY actually reaches the
 * <img>, its absence falls back to the address placeholder (no broken map
 * request), coordinate-less input renders nothing, and the card links INTO our
 * interactive map (?view=map&focus=…), not out to external Yandex Maps
 * (Slice D part 1).
 */
import { render } from '@testing-library/react';

import { MapPreview } from '@/components/establishment/MapPreview';

const COORDS = {
  latitude: 53.902284,
  longitude: 27.561831,
  address: 'пр. Независимости, 1',
  citySlug: 'minsk',
  slug: 'test-cafe',
};

describe('MapPreview — static-map rendering', () => {
  const original = process.env.YANDEX_MAPS_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.YANDEX_MAPS_API_KEY;
    else process.env.YANDEX_MAPS_API_KEY = original;
  });

  it('renders the Yandex static-map image when the API key is set', () => {
    process.env.YANDEX_MAPS_API_KEY = 'test-key';
    const { container } = render(<MapPreview {...COORDS} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toContain('static-maps.yandex.ru/v1');
    expect(img!.getAttribute('src')).toContain('apikey=test-key');
  });

  it('deep-links into our interactive map, centred + focused on this place', () => {
    process.env.YANDEX_MAPS_API_KEY = 'test-key';
    const { container } = render(<MapPreview {...COORDS} />);

    const href = container.querySelector('a')!.getAttribute('href') ?? '';
    expect(href).toContain('/minsk?');
    expect(href).toContain('view=map');
    expect(href).toContain('focus=test-cafe');
    expect(href).toContain(`flat=${COORDS.latitude}`);
    expect(href).toContain(`flng=${COORDS.longitude}`);
    // Stays in-app: no external Yandex Maps hop.
    expect(href).not.toContain('yandex.by/maps');
  });

  it('falls back to the placeholder (no map image) when the key is absent', () => {
    delete process.env.YANDEX_MAPS_API_KEY;
    const { container } = render(<MapPreview {...COORDS} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('Открыть на карте');
  });

  it('renders nothing without coordinates', () => {
    process.env.YANDEX_MAPS_API_KEY = 'test-key';
    const { container } = render(
      <MapPreview {...COORDS} latitude={null} longitude={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
