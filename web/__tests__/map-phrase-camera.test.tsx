/**
 * The results map under a search phrase does not re-query on camera moves.
 *
 * Why it matters: with a phrase, /api/map answers from the smart endpoint, and
 * every web visitor reaches the backend from the web server's one address —
 * the per-IP smart limit (30/min) is shared by the whole site. A map that
 * re-queried per pan would burn it in seconds, fall back to the classic text
 * search, and swap the pins for a different set mid-pan. The phrase map holds
 * the phrase's whole result set anyway (no viewport box), so a camera move has
 * nothing new to fetch. Without a phrase the map keeps refetching its
 * viewport, exactly as before — the control case below proves this harness
 * does see a camera-driven refetch when one happens. A filter change under a
 * phrase does refetch (the set changed), and an empty phrase map does not
 * tell the visitor to move the camera.
 *
 * Harness: a minimal fake of the Yandex JS API (window.ymaps3) that captures
 * the YMapListener's onUpdate — the camera-move hook — plus a stubbed clusterer
 * module and a mocked global fetch for /api/map. The real map needs WebGL and
 * Yandex's network, neither of which exists here.
 */
import { act, render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

jest.mock('next/script', () => ({ __esModule: true, default: () => null }));
jest.mock('@yandex/ymaps3-clusterer', () => ({
  YMapClusterer: class {
    update() {}
  },
  clusterByGrid: () => ({ render: null }),
}));

type OnUpdate = () => void;
let onCameraUpdate: OnUpdate | undefined;

function installFakeYmaps3() {
  (window as unknown as { ymaps3: unknown }).ymaps3 = {
    ready: Promise.resolve(),
    YMap: class {
      bounds = [
        [27.4, 53.8],
        [27.7, 54.0],
      ];
      addChild() {}
      removeChild() {}
      destroy() {}
      update() {}
    },
    YMapDefaultSchemeLayer: class {},
    YMapDefaultFeaturesLayer: class {},
    YMapMarker: class {},
    YMapListener: class {
      constructor(opts: { onUpdate?: OnUpdate }) {
        onCameraUpdate = opts.onUpdate;
      }
    },
  };
}

const realFetch = global.fetch;
const realMatchMedia = window.matchMedia;
let fetchMock: jest.Mock;

// The module reads the JS key at load time; set it before requiring MapView.
process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY = 'test-key';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MapView = require('@/components/map/MapView').default as typeof import('@/components/map/MapView').default;

beforeEach(() => {
  onCameraUpdate = undefined;
  installFakeYmaps3();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ establishments: [] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  window.matchMedia = realMatchMedia;
  delete (window as unknown as { ymaps3?: unknown }).ymaps3;
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Render, wait for the first fetch, move the camera, let the debounce elapse. */
async function renderAndPan(searchParams: Record<string, string>) {
  // The map's lifecycle is async (ymaps3.ready, the clusterer import, the
  // first refetch) and sets state as it goes — let it run inside act().
  await act(async () => {
    render(<MapView citySlug="minsk" searchParams={searchParams} />);
    await settle(200);
  });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(onCameraUpdate).toBeDefined();
  await act(async () => {
    onCameraUpdate!();
    await settle(600); // REFETCH_DEBOUNCE_MS is 350
  });
}

describe('MapView — camera moves under a search phrase', () => {
  it('control: without a phrase a camera move refetches the viewport', async () => {
    await renderAndPan({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('with a phrase: one request for the whole set, none on camera moves', async () => {
    await renderAndPan({ search: 'терраса' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const qs = new URLSearchParams(String(fetchMock.mock.calls[0][0]).split('?')[1]);
    expect(qs.get('search')).toBe('терраса');
    expect(qs.get('city')).toBe('minsk');
  });

  it('with a phrase, a filter change still refetches (the set itself changed)', async () => {
    let rerenderMap: (ui: ReactElement) => void = () => {};
    await act(async () => {
      rerenderMap = render(
        <MapView citySlug="minsk" searchParams={{ search: 'терраса' }} />,
      ).rerender;
      await settle(200);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      rerenderMap(
        <MapView citySlug="minsk" searchParams={{ search: 'терраса', features: 'wifi' }} />,
      );
      await settle(200);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const qs = new URLSearchParams(String(fetchMock.mock.calls[1][0]).split('?')[1]);
    expect(qs.get('features')).toBe('wifi');
  });

  it('an empty phrase map does not suggest moving the camera (it cannot find more)', async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<MapView citySlug="minsk" searchParams={{ search: 'терраса' }} />);
      await settle(200);
    });

    expect(await view.findByText('По этому запросу ничего не найдено')).toBeInTheDocument();
    expect(view.queryByText(/сместите/i)).not.toBeInTheDocument();
  });
});
