/**
 * ReviewCard — SYNC Server Component (plain prop-taking, no top-level await).
 *
 * Renders directly under React Testing Library (no invoke-await workaround).
 * No data-layer mocks needed: the card is pure presentation over its `review`
 * prop. Date formatting goes through the real `formatDateRu` helper, so the
 * asserted string ('12 мая') is the genuine contract output for the fixture.
 */
import { fireEvent, render, screen } from '@testing-library/react';

import { ReviewCard } from '@/components/establishment/ReviewCard';
import type { PublicReview } from '@/lib/api/types';

const baseReview: PublicReview = {
  id: 'rev-1',
  establishment_id: 'est-1',
  rating: 4,
  content: 'Отличное место, вкусная еда',
  partner_response: null,
  partner_response_at: null,
  is_edited: false,
  // Midday local time so getDate()/getMonth() are timezone-edge safe → '12 мая'.
  created_at: '2026-05-12T12:00:00.000Z',
  updated_at: '2026-05-12T12:00:00.000Z',
  author: {
    id: 'user-1',
    name: 'Алексей',
    avatar_url: null,
  },
};

describe('ReviewCard — sync Server Component', () => {
  it('renders author, rating, content, and formatted date', () => {
    const { container } = render(<ReviewCard review={baseReview} />);

    // Author name.
    expect(screen.getByText('Алексей')).toBeInTheDocument();

    // Rating: StarRating exposes the score via an aria-label — and shows it as
    // filled stars, which is what a sighted reader actually sees: four of five.
    const stars = screen.getByLabelText('Оценка: 4 из 5');
    expect(stars.querySelectorAll('svg')).toHaveLength(5);
    expect(stars.querySelectorAll('svg.fill-brand')).toHaveLength(4);

    // Content body.
    expect(
      screen.getByText('Отличное место, вкусная еда'),
    ).toBeInTheDocument();

    // Date formatted via formatDateRu → '12 мая', carried on a <time> element
    // whose dateTime is the raw ISO string.
    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    expect(time).toHaveTextContent('12 мая');
    expect(time).toHaveAttribute('dateTime', '2026-05-12T12:00:00.000Z');
  });

  it('clamps the content paragraph by default (clamp defaults to true)', () => {
    render(<ReviewCard review={baseReview} />);

    const body = screen.getByText('Отличное место, вкусная еда');
    expect(body).toHaveClass('line-clamp-6');
  });

  it('omits the clamp class when clamp is false', () => {
    render(<ReviewCard review={baseReview} clamp={false} />);

    const body = screen.getByText('Отличное место, вкусная еда');
    expect(body).not.toHaveClass('line-clamp-6');
  });

  // Slice 2: an edited review carries the «изменён» marker next to the date
  // (is_edited comes from the public projection; VISUAL_SPEC_slice2 §1).
  it('marks an edited review with «изменён» and omits it otherwise', () => {
    const { rerender } = render(<ReviewCard review={baseReview} />);
    expect(screen.queryByText(/изменён/)).not.toBeInTheDocument();

    rerender(<ReviewCard review={{ ...baseReview, is_edited: true }} />);
    expect(screen.getByText(/изменён/)).toBeInTheDocument();
  });
});

/*
 * Author avatar (ReviewAvatar island, lib/avatar-source). Sign-in photos load
 * straight from the provider — the optimizer refuses their hosts (400, an empty
 * circle on production 30.09–12.10.2026); our cloud goes through the optimizer;
 * any other address and any failed load show the initial, like an author
 * without a photo.
 */
describe('ReviewCard — author avatar', () => {
  const GOOGLE =
    'https://lh3.googleusercontent.com/a/ACg8ocTestAvatar0123456789=s96-c';
  const YANDEX = 'https://avatars.yandex.net/get-yapic/12345/abcDEF-678/islands-200';
  const OUR_CLOUD =
    'https://res.cloudinary.com/davrzdre8/image/upload/v1791566923/avatars/user-1/photo.jpg';

  const withAvatar = (avatar_url: string | null): PublicReview => ({
    ...baseReview,
    author: { ...baseReview.author, avatar_url },
  });

  it('loads a Google or Yandex sign-in photo directly, without a Referer', () => {
    const { rerender } = render(<ReviewCard review={withAvatar(GOOGLE)} />);

    let img = screen.getByAltText('Алексей');
    expect(img).toHaveAttribute('src', GOOGLE);
    expect(img).not.toHaveAttribute('srcset');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByText('А')).not.toBeInTheDocument();

    rerender(<ReviewCard review={withAvatar(YANDEX)} />);
    img = screen.getByAltText('Алексей');
    expect(img).toHaveAttribute('src', YANDEX);
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('sends a photo from our cloud through the optimizer', () => {
    render(<ReviewCard review={withAvatar(OUR_CLOUD)} />);

    // The resolved property (jsdom's base is http://localhost): with onError set,
    // next/image re-assigns img.src after mount, so the attribute turns absolute.
    const { src } = screen.getByAltText('Алексей') as HTMLImageElement;
    expect(src).toMatch(
      /^http:\/\/localhost\/_next\/image\?url=https%3A%2F%2Fres\.cloudinary\.com%2Fdavrzdre8%2Fimage%2Fupload%2Fv1791566923%2Favatars%2Fuser-1%2Fphoto\.jpg&w=\d+&q=75$/,
    );
  });

  it('shows the initial and requests nothing for any other address', () => {
    const { container, rerender } = render(
      <ReviewCard review={withAvatar('https://tracker.example/pixel.png')} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('А')).toBeInTheDocument();

    // next/image would load an .svg from any host directly (it never optimizes SVG).
    rerender(<ReviewCard review={withAvatar('https://tracker.example/pixel.svg')} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('А')).toBeInTheDocument();

    // The pre-Cloudinary local path still stored for one production user.
    rerender(<ReviewCard review={withAvatar('/uploads/avatars/0a1b2c3d.jpg')} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('А')).toBeInTheDocument();
  });

  it('falls back to the initial when the photo fails to load', () => {
    const { container } = render(<ReviewCard review={withAvatar(GOOGLE)} />);

    fireEvent.error(screen.getByAltText('Алексей'));

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('А')).toBeInTheDocument();
  });

  it('shows a new photo after a failed one (the failure belongs to that address)', () => {
    const { rerender } = render(<ReviewCard review={withAvatar(GOOGLE)} />);
    fireEvent.error(screen.getByAltText('Алексей'));
    expect(screen.getByText('А')).toBeInTheDocument();

    rerender(<ReviewCard review={withAvatar(YANDEX)} />);

    expect(screen.getByAltText('Алексей')).toHaveAttribute('src', YANDEX);
    expect(screen.queryByText('А')).not.toBeInTheDocument();
  });
});
