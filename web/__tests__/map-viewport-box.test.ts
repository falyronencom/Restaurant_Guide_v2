import { boxFromBounds } from '@/components/map/MapView';

/*
 * The camera-bounds → fetch-box seam of the interactive map.
 *
 * Every rectangle below is a REAL ymaps3 `map.bounds` value, measured against a
 * live prod build (Minsk, lat ~53.9, a 760×560 map container) — not a value
 * invented to fit the assertions. That matters here: this function's previous
 * guard was wrong precisely because it was written against an assumed shape of
 * `map.bounds` rather than an observed one.
 *
 * ymaps3 hands over [top-left, bottom-right] — north latitude in the FIRST
 * corner — so the inputs are north-first, as the live map emits them.
 */

// Real viewports, by zoom (measured). z21 is ymaps3's max: requesting 22, 23 or
// 25 clamps to the same rectangle.
const VIEWPORT = {
  z12: [
    [27.431037353515613, 53.95903029877306],
    [27.691962646484363, 53.84549220056087],
  ],
  z17: [
    [27.557423042297348, 53.904073994668536],
    [27.56557695770262, 53.90052592963305],
  ],
  z18: [
    [27.559461521148666, 53.90318700679115],
    [27.563538478851303, 53.901412974273605],
  ],
  z21: [
    [27.56124519014357, 53.902410876877425],
    [27.5617548098564, 53.90218912281274],
  ],
} as const satisfies Record<string, readonly [readonly number[], readonly number[]]>;

// What an un-laid-out (0×0) container actually reports at construction zoom 12:
// not a point, but ymaps3's 1×1-pixel minimum viewport — ~22×22m on the ground.
const ONE_PIXEL_AT_Z12 = [
  [27.561328338623035, 53.90240137315607],
  [27.561671661376938, 53.90219862658264],
] as const;

const span = (b: NonNullable<ReturnType<typeof boxFromBounds>>) => ({
  lat: b.neLat - b.swLat,
  lon: b.neLon - b.swLon,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asBounds = (b: unknown) => b as any;

describe('boxFromBounds', () => {
  it('normalizes a city-wide viewport into sw/ne corners', () => {
    const box = boxFromBounds(asBounds(VIEWPORT.z12));
    expect(box).toEqual({
      swLon: 27.431037353515613,
      neLon: 27.691962646484363,
      swLat: 53.84549220056087,
      neLat: 53.95903029877306,
    });
  });

  it('puts north in neLat whichever corner order it is handed', () => {
    // ymaps3 emits north-first; the function must not depend on that.
    const northFirst = boxFromBounds(asBounds(VIEWPORT.z12));
    const southFirst = boxFromBounds(
      asBounds([...VIEWPORT.z12].reverse().map((c) => [...c])),
    );
    expect(southFirst).toEqual(northFirst);
    expect(northFirst!.neLat).toBeGreaterThan(northFirst!.swLat);
  });

  /*
   * The regression this function was fixed for. The old guard rejected any span
   * under 0.005°, which is ~550m — larger than a real viewport from zoom ~17 in.
   * So a user zoomed to one block got `null` here, refetch fell back to the
   * city-wide boxAroundCenter, and the map pulled the whole city (measured: a
   * 0.640 × 1.120 bbox) while the badge counted establishments nobody could see.
   */
  it('accepts the deep-zoom viewports the 0.005° guard rejected', () => {
    // z21 is ymaps3's max zoom — the smallest camera a user can reach at all.
    for (const bounds of [VIEWPORT.z17, VIEWPORT.z18, VIEWPORT.z21]) {
      const box = boxFromBounds(asBounds(bounds));
      expect(box).not.toBeNull();
      // Guard the guard: each of these is genuinely under the old threshold, so
      // this case cannot quietly stop covering the regression.
      expect(span(box!).lat).toBeLessThan(0.005);
    }
  });

  it('tracks the viewport rather than widening it', () => {
    // The fetch box is the camera, verbatim. bufferBox adds the margin later —
    // this function must not smuggle any in.
    const box = boxFromBounds(asBounds(VIEWPORT.z18))!;
    expect(span(box).lat).toBeCloseTo(0.001774, 6);
    expect(span(box).lon).toBeCloseTo(0.004077, 6);
  });

  it('rejects a collapsed rectangle', () => {
    const point = boxFromBounds(
      asBounds([
        [27.5615, 53.9023],
        [27.5615, 53.9023],
      ]),
    );
    expect(point).toBeNull();
    // Flat in one axis only is equally unusable as a fetch box.
    expect(
      boxFromBounds(
        asBounds([
          [27.5615, 53.9023],
          [27.6615, 53.9023],
        ]),
      ),
    ).toBeNull();
  });

  it('rejects a malformed or non-finite read', () => {
    expect(boxFromBounds(undefined)).toBeNull();
    expect(boxFromBounds(asBounds([]))).toBeNull();
    expect(boxFromBounds(asBounds([[27.5, 53.9]]))).toBeNull();
    expect(
      boxFromBounds(
        asBounds([
          [NaN, 53.9],
          [27.6, 53.8],
        ]),
      ),
    ).toBeNull();
    expect(
      boxFromBounds(
        asBounds([
          [27.5, Infinity],
          [27.6, 53.8],
        ]),
      ),
    ).toBeNull();
  });

  /*
   * A deliberate, load-bearing trade-off — not an oversight.
   *
   * A 0×0 container makes ymaps3 report its 1×1-pixel minimum viewport, and this
   * function accepts it. It cannot do otherwise: at construction zoom 12 that box
   * spans ~22×22m, while a real 760×560 viewport at max zoom spans ~33×25m and a
   * phone's is smaller still. The two populations overlap, so any threshold that
   * rejected the pixel would reject someone's legitimate max-zoom camera — which
   * is the bug this function was just fixed for.
   *
   * If this ever needs rejecting, the discriminator is the container's pixel
   * size, not the box's degrees. Don't reintroduce a threshold here.
   */
  it('accepts the 1px box an un-laid-out container reports (documented trade-off)', () => {
    const pixel = boxFromBounds(asBounds(ONE_PIXEL_AT_Z12));
    expect(pixel).not.toBeNull();

    // The proof that no threshold separates them: the 1px box at city zoom is
    // the same size on the ground as a whole viewport at max zoom.
    const maxZoom = boxFromBounds(asBounds(VIEWPORT.z21))!;
    expect(span(pixel!).lat).toBeLessThan(span(maxZoom).lat);
    expect(span(pixel!).lon).toBeLessThan(span(maxZoom).lon);

    // ...and it is well above the 1e-4 a "tighter threshold" would have used,
    // so such a guard would have passed the very read it existed to catch.
    expect(span(pixel!).lat).toBeGreaterThan(1e-4);
    expect(span(pixel!).lon).toBeGreaterThan(1e-4);
  });
});
