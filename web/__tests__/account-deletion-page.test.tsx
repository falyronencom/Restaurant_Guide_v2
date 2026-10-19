/**
 * /udalenie-uchetki — the page Google Play links to (brief В1, 18.10.2026):
 * how to delete the account in the app, on the site and without signing in,
 * and what is deleted and what stays. Static RSC, rendered as a function.
 */
import { render, screen, within } from '@testing-library/react';

import AccountDeletionPage, { metadata } from '@/app/(public)/udalenie-uchetki/page';
import { SiteFooter } from '@/components/layout/SiteFooter';

it('names the three ways and the path in the app', () => {
  render(<AccountDeletionPage />);

  expect(screen.getByRole('heading', { level: 1, name: 'Как удалить учётку Nirivio' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'В приложении' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'На сайте' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Без входа' })).toBeInTheDocument();
  expect(
    screen.getByText(/«Профиль» → «Показать профиль» → «Мои данные» → «Удалить учётку»/),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Войдите' })).toHaveAttribute('href', '/login?returnTo=/profile');
  expect(screen.getByRole('link', { name: 'support@nirivio.by' }))
    .toHaveAttribute('href', expect.stringMatching(/^mailto:support@nirivio\.by\?/));
});

it('without signing in — support confirms with the holder first, within 15 days', () => {
  render(<AccountDeletionPage />);

  const letter = screen.getByRole('heading', { name: 'Без входа' }).parentElement!;
  expect(within(letter).getByText(/мы ответим на этот адрес и\s+попросим подтвердить удаление/)).toBeInTheDocument();
  expect(within(letter).getByText(/Удалим учётку в течение 15 дней\./)).toBeInTheDocument();
});

it('a phone account — the app first; a call to the number alone does not prove the account', () => {
  render(<AccountDeletionPage />);

  // No phone is verified when an account is made: answering a call proves
  // the number, not the account (Phase 3.5 review, 18.10.2026).
  const letter = screen.getByRole('heading', { name: 'Без входа' }).parentElement!;
  expect(within(letter).getByText(/проще всего войти в\s+приложение по номеру и паролю и удалить её там/))
    .toBeInTheDocument();
  expect(within(letter).getByText(
    /укажите в письме номер, имя в профиле и примерно когда\s+вы завели учётку: мы сверим их с учёткой/,
  )).toBeInTheDocument();
  expect(letter).not.toHaveTextContent(/чтобы убедиться, что учётка ваша/);
});

it('says what is deleted and what stays without the name', () => {
  render(<AccountDeletionPage />);

  const deleted = screen.getByRole('heading', { name: 'Что удаляется' }).parentElement!;
  expect(within(deleted).getByText('Имя, почта, телефон и фото профиля')).toBeInTheDocument();
  expect(within(deleted).getByText('Черновики карточек заведений, которые не публиковались')).toBeInTheDocument();
  const kept = screen.getByRole('heading', { name: 'Что остаётся без вашего имени' }).parentElement!;
  expect(within(kept).getByText('Ваши отзывы и оценки — автором будет «Гость», без фото')).toBeInTheDocument();
});

it('has its own title — the layout adds «| Nirivio» — and canonical address', () => {
  expect(metadata.title).toBe('Как удалить учётку');
  expect(metadata.alternates).toEqual({ canonical: '/udalenie-uchetki' });
});

it('the footer links to it', () => {
  render(<SiteFooter cities={[]} />);

  expect(screen.getByRole('link', { name: 'Как удалить учётку' })).toHaveAttribute('href', '/udalenie-uchetki');
});
