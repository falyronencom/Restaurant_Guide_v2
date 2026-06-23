/**
 * MapPreview — env-gated static-map rendering.
 *
 * MapPreview is a sync Server Component (pure props + a process.env read, no
 * I/O), so it renders directly under RTL. This locks the integration the URL
 * unit tests can't see: the key in YANDEX_MAPS_API_KEY actually reaches the
 * <img>, its absence falls back to the address placeholder (no broken map
 * request), and coordinate-less input renders nothing.
 */
import { render } from '@testing-library/react';

import { MapPreview } from '@/components/establishment/MapPreview';

const COORDS = {
  latitude: 53.902284,
  longitude: 27.561831,
  address: 'пр. Независимости, 1',
  city: 'Минск',
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

  it('falls back to the placeholder (no map image) when the key is absent', () => {
    delete process.env.YANDEX_MAPS_API_KEY;
    const { container } = render(<MapPreview {...COORDS} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('Открыть на Яндекс.Картах');
  });

  it('renders nothing without coordinates', () => {
    process.env.YANDEX_MAPS_API_KEY = 'test-key';
    const { container } = render(
      <MapPreview {...COORDS} latitude={null} longitude={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
