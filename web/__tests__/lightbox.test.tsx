/**
 * PhotoLightbox (menu/gallery UX, 2026-07-20) — in-page photo viewer replacing
 * the «open original in a new tab» anchors. Provider + Trigger pattern: the
 * provider hosts one Base UI dialog per photo set; triggers are plain buttons
 * carrying the old tile styling.
 *
 * Covered here: open-at-index, «N / M» counter, arrow-button + arrow-key
 * navigation with looping, thumbnail-strip jump, close button, and the
 * single-photo degenerate case (no arrows / no strip). Swipe is pointer-based
 * and verified on a real device, not in jsdom.
 */
import { render, screen, fireEvent } from '@testing-library/react';

import {
  LightboxProvider,
  LightboxTrigger,
  type LightboxPhoto,
} from '@/components/establishment/Lightbox';

const photo = (n: number, over: Partial<LightboxPhoto> = {}): LightboxPhoto => ({
  id: `p${n}`,
  url: `https://cdn.example.com/${n}.jpg`,
  previewUrl: null,
  thumbnailUrl: null,
  caption: null,
  ...over,
});

function Fixture({ photos }: { photos: LightboxPhoto[] }) {
  return (
    <LightboxProvider photos={photos} label='Фотографии — Тест'>
      {photos.map((p, i) => (
        <LightboxTrigger key={p.id} index={i} aria-label={`Открыть фото ${i + 1}`}>
          <span>тайл {i + 1}</span>
        </LightboxTrigger>
      ))}
    </LightboxProvider>
  );
}

const counter = () => screen.getByText(/^\d+ \/ \d+$/).textContent;

describe('PhotoLightbox', () => {
  const threePhotos = [photo(1, { caption: 'Зал' }), photo(2), photo(3)];

  it('opens at the clicked tile index with a counter', () => {
    render(<Fixture photos={threePhotos} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 2' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(counter()).toBe('2 / 3');
  });

  it('navigates with the arrow buttons and loops past the ends', () => {
    render(<Fixture photos={threePhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 3' }));

    fireEvent.click(screen.getByRole('button', { name: 'Следующее фото' }));
    expect(counter()).toBe('1 / 3'); // looped forward

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущее фото' }));
    expect(counter()).toBe('3 / 3'); // looped back
  });

  it('navigates with ← / → keys', () => {
    render(<Fixture photos={threePhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter()).toBe('2 / 3');

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter()).toBe('1 / 3');
  });

  it('jumps via the thumbnail strip', () => {
    render(<Fixture photos={threePhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Фото 3' }));
    expect(counter()).toBe('3 / 3');
  });

  it('closes via the close button', () => {
    render(<Fixture photos={threePhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape regardless of focus (own capture handler)', () => {
    render(<Fixture photos={threePhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders no arrows and no thumbnail strip for a single photo', () => {
    render(<Fixture photos={[photo(1)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(counter()).toBe('1 / 1');
    expect(
      screen.queryByRole('button', { name: 'Следующее фото' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Фото 1' }),
    ).not.toBeInTheDocument();
  });
});
