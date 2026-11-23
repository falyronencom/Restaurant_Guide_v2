/**
 * The card's header and sections in the cabinet (part 1 of «Кабинет партнёра
 * на сайте», directive 1.1, 1.5, 1.6): one load of the card per view of a
 * section, shared with the form; «Посмотреть на сайте» and «Приостановить
 * показ» for a published card; the pause switches the form to «только
 * просмотр» at once; the expired session as the cabinet's list shows it.
 * The network is mocked at the client fetchers (lib/partner/client).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockPathname = jest.fn(() => '/cabinet/e1/edit');

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'p@e.by', name: 'П', role: 'partner', avatarUrl: null },
    applySession: jest.fn(),
  }),
}));
jest.mock('@/lib/partner/client', () => ({
  loadEstablishmentForEdit: jest.fn(),
  suspendEstablishmentAction: jest.fn(),
  resumeEstablishmentAction: jest.fn(),
  updateEstablishmentAction: jest.fn(),
  createEstablishmentAction: jest.fn(),
  submitEstablishmentAction: jest.fn(),
  refreshCardPageAction: jest.fn(),
  loadEstablishments: jest.fn(() => Promise.resolve({ ok: true, establishments: [] })),
}));

import { CardShell } from '@/components/cabinet/card/CardShell';
import { EditWizardLoader } from '@/components/cabinet/wizard/EditWizardLoader';
import type { PartnerEstablishmentDetail } from '@/lib/api/types';
import {
  loadEstablishmentForEdit,
  resumeEstablishmentAction,
  suspendEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/client';

const loadMock = loadEstablishmentForEdit as jest.Mock;
const suspendMock = suspendEstablishmentAction as jest.Mock;
const resumeMock = resumeEstablishmentAction as jest.Mock;
const updateMock = updateEstablishmentAction as jest.Mock;

function detail(over: Partial<PartnerEstablishmentDetail> = {}): PartnerEstablishmentDetail {
  return {
    id: 'e1',
    partner_id: 'u1',
    name: 'Кафе у моста',
    description: 'Уютное кафе',
    city: 'Минск',
    address: 'ул. Немига, 5',
    latitude: 53.9,
    longitude: 27.55,
    phone: null,
    email: null,
    website: null,
    categories: ['Кафе'],
    cuisines: ['Народная'],
    price_range: null,
    status: 'active',
    subscription_tier: null,
    view_count: 0,
    favorite_count: 0,
    review_count: 0,
    average_rating: null,
    base_score: 70,
    moderation_notes: null,
    primary_photo: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    published_at: '2026-11-02T10:00:00Z',
    slug: 'kafe-u-mosta',
    working_hours: {},
    special_hours: null,
    attributes: null,
    interior_photos: [],
    menu_photos: [],
    legal_name: null,
    unp: null,
    contact_person: null,
    contact_email: null,
    ...over,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderCard() {
  return render(
    <CardShell id="e1">
      <EditWizardLoader id="e1" />
    </CardShell>,
  );
}

beforeEach(() => {
  for (const mock of [loadMock, suspendMock, resumeMock, updateMock]) mock.mockReset();
  // The edit form saves 800 ms after it opens (its autosave, as before this
  // part) and once more as it unmounts with a save armed.
  updateMock.mockResolvedValue({ ok: true });
  mockPathname.mockReturnValue('/cabinet/e1/edit');
});

describe('the card\'s header', () => {
  it('an expired session: «Сессия истекла.» and «Войти снова» back to this section, no redirect of its own', async () => {
    loadMock.mockResolvedValue({ ok: false, code: 'NO_SESSION' });
    renderCard();
    await flush();

    expect(screen.getByText('Сессия истекла.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти снова' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fcabinet%2Fe1%2Fedit',
    );
    expect(screen.queryByLabelText('Описание')).not.toBeInTheDocument();
  });

  it('a published card: name, status, «Посмотреть на сайте» in a new tab, «Приостановить показ»', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail(), publicPath: '/minsk/cafes/kafe-u-mosta' });
    renderCard();
    await flush();

    expect(screen.getByRole('heading', { level: 1, name: 'Кафе у моста' })).toBeInTheDocument();
    expect(screen.getByText('Опубликовано')).toBeInTheDocument();
    const site = screen.getByRole('link', { name: /Посмотреть на сайте/ });
    expect(site).toHaveAttribute('href', '/minsk/cafes/kafe-u-mosta');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Приостановить показ' })).toBeInTheDocument();
  });

  it('a card on moderation: neither the site link nor the pause', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail({ status: 'pending' }) });
    renderCard();
    await flush();

    expect(screen.getByText('На модерации')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Посмотреть на сайте/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Приостановить показ' })).not.toBeInTheDocument();
  });

  it('the row of sections: links, the current one marked', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail(), publicPath: '/minsk/cafes/kafe-u-mosta' });
    renderCard();
    await flush();

    const nav = screen.getByRole('navigation', { name: 'Разделы карточки' });
    expect(within(nav).getByRole('link', { name: 'Карточка' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Меню' })).toHaveAttribute('href', '/cabinet/e1/menu');
    expect(within(nav).getByRole('link', { name: 'Меню' })).not.toHaveAttribute('aria-current');
  });

  it('one load of the card per view: the form takes the header\'s, a new section loads anew', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail(), publicPath: '/minsk/cafes/kafe-u-mosta' });
    const view = renderCard();
    await flush();

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Описание')).toHaveValue('Уютное кафе');

    mockPathname.mockReturnValue('/cabinet/e1/menu');
    view.rerender(
      <CardShell id="e1">
        <p>Меню карточки</p>
      </CardShell>,
    );
    await flush();
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Меню карточки')).toBeInTheDocument();
  });
});

describe('the pause from the header', () => {
  it('behind the window T6; done → the form is «только просмотр», the header offers «Возобновить показ»', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail(), publicPath: '/minsk/cafes/kafe-u-mosta' });
    suspendMock.mockResolvedValue({ ok: true, status: 'suspended' });
    renderCard();
    await flush();
    expect(screen.getByLabelText('Описание')).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Приостановить показ' }));
    await flush();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Приостановить показ?')).toBeInTheDocument();
    expect(within(dialog).getByText(/Пока показ приостановлен, изменить данные карточки нельзя\./)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Приостановить' }));
    await flush();

    expect(suspendMock).toHaveBeenCalledWith('e1');
    expect(screen.getByLabelText('Описание')).toBeDisabled();
    expect(screen.getByText('Приостановлено')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Посмотреть на сайте/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Возобновить показ' }).length).toBeGreaterThan(0);
  });

  it('a refusal stays in the window, in the server\'s words', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail(), publicPath: '/minsk/cafes/kafe-u-mosta' });
    suspendMock.mockResolvedValue({
      ok: false,
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Приостановить можно только опубликованное заведение.',
    });
    renderCard();
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Приостановить показ' }));
    await flush();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Приостановить' }));
    await flush();

    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
      'Приостановить можно только опубликованное заведение.',
    );
    expect(screen.getByLabelText('Описание')).not.toBeDisabled();
  });

  it('a resume from the header: the form is editable again and the site link is back', async () => {
    loadMock.mockResolvedValue({ ok: true, establishment: detail({ status: 'suspended' }) });
    resumeMock.mockResolvedValue({ ok: true, status: 'active', publicPath: '/minsk/cafes/kafe-u-mosta' });
    renderCard();
    await flush();
    expect(screen.getByLabelText('Описание')).toBeDisabled();

    // The header's button (the form's own banner has the same one).
    fireEvent.click(screen.getAllByRole('button', { name: 'Возобновить показ' })[0]);
    await flush();

    expect(screen.getByLabelText('Описание')).not.toBeDisabled();
    expect(screen.getByRole('link', { name: /Посмотреть на сайте/ })).toHaveAttribute('href', '/minsk/cafes/kafe-u-mosta');
  });
});
