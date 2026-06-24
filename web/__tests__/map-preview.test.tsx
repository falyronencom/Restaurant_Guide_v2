/**
 * MapPreview — env-gated static-map rendering + in-page overlay trigger.
 *
 * MapPreview is a sync Server Component (pure props + a process.env read, no
 * I/O) that renders the static-map image and wraps it in the MapPreviewTrigger
 * client button. These tests lock the integration the URL unit tests can't see:
 * the key in YANDEX_MAPS_API_KEY actually reaches the <img>, its absence falls
 * back to the address placeholder (no broken map request), coordinate-less input
 * renders nothing, and the preview is a button that opens our in-page map
 * overlay (?map=1) — NOT a link out to external Yandex Maps nor away to the
 * catalog (D-2A).
 */
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MapPreview } from '@/components/establishment/MapPreview';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

const COORDS = {
  latitude: 53.902284,
  longitude: 27.561831,
  address: 'пр. Независимости, 1',
};

describe('MapPreview — static-map rendering', () => {
  const original = process.env.YANDEX_MAPS_API_KEY;

  beforeEach(() => {
    mockPush.mockClear();
  });

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

  it('is a button that opens the in-page map overlay (?map=1), not a link out', async () => {
    process.env.YANDEX_MAPS_API_KEY = 'test-key';
    const { container } = render(<MapPreview {...COORDS} />);

    // No anchor: it neither hops to external Yandex Maps nor navigates to the
    // catalog — it opens our overlay in place.
    expect(container.querySelector('a')).toBeNull();
    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await userEvent.click(button!);
    expect(mockPush).toHaveBeenCalledTimes(1);
    const [url, opts] = mockPush.mock.calls[0];
    expect(url).toContain('map=1');
    expect(opts).toEqual({ scroll: false });
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
