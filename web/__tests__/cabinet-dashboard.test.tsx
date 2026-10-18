/**
 * Список «Мои заведения» (сверка находок тестировщика с сайтом, 18.10):
 *   С4 — новый пользователь (ещё не партнёр: сервер отдаёт список только
 *        партнёру и отвечает 403) видит пустой кабинет с «Создать заведение»,
 *        а не «Не удалось загрузить заведения»;
 *   С3 — у карточки, которую партнёр приостановил сам, есть «Возобновить
 *        показ»; у приостановленной модератором — нет;
 *   С1 — удаление черновика стирает и форму «Создать заведение», которая
 *        сохраняет в него, а чужую незаконченную форму не трогает.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { CabinetDashboard } from '@/components/cabinet/CabinetDashboard';
import { EstablishmentVignette } from '@/components/cabinet/EstablishmentVignette';
import type {
  EstablishmentStatus,
  ModerationNotes,
  PartnerEstablishmentListing,
} from '@/lib/api/types';
import {
  deleteEstablishmentAction,
  loadEstablishments,
  resumeEstablishmentAction,
} from '@/lib/partner/client';
import { forgetWizardDraft } from '@/lib/partner/draft-storage';

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'p@e.by', name: 'П', role: 'user', avatarUrl: null },
  }),
}));
jest.mock('@/lib/partner/client', () => ({
  loadEstablishments: jest.fn(),
  resumeEstablishmentAction: jest.fn(),
  deleteEstablishmentAction: jest.fn(),
}));

const loadMock = loadEstablishments as jest.Mock;
const resumeMock = resumeEstablishmentAction as jest.Mock;
const deleteMock = deleteEstablishmentAction as jest.Mock;

const card = (
  status: EstablishmentStatus,
  moderation_notes: ModerationNotes = null,
): PartnerEstablishmentListing =>
  ({
    id: 'est-1',
    partner_id: 'partner-1',
    name: 'Кофейня у моста',
    description: null,
    city: 'Минск',
    address: 'ул. Немига, 5',
    latitude: null,
    longitude: null,
    phone: null,
    email: null,
    website: null,
    categories: ['Кофейня'],
    cuisines: [],
    price_range: null,
    status,
    subscription_tier: null,
    view_count: 0,
    favorite_count: 0,
    review_count: 0,
    average_rating: null,
    base_score: null,
    moderation_notes,
    primary_photo: null,
    created_at: '2026-07-01T10:00:00.000Z',
    updated_at: '2026-07-20T10:00:00.000Z',
    published_at: '2026-07-10T10:00:00.000Z',
  }) as PartnerEstablishmentListing;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('С4 — новый пользователь в кабинете', () => {
  it('403 на список (ещё не партнёр) — пустой кабинет с «Создать заведение»', async () => {
    loadMock.mockResolvedValue({
      ok: false,
      code: 'FORBIDDEN',
      role: 'user',
      message: 'Недостаточно прав для этого действия.',
    });
    render(<CabinetDashboard />);

    expect(await screen.findByText('У вас пока нет заведений')).toBeInTheDocument();
    expect(screen.queryByText(/Не удалось загрузить заведения/)).not.toBeInTheDocument();
  });

  it('403 не о роли (не «ещё не партнёр») — сбой, а не пустой кабинет', async () => {
    loadMock.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(<CabinetDashboard />);

    expect(
      await screen.findByText('Не удалось загрузить заведения. Обновите страницу.'),
    ).toBeInTheDocument();
  });

  it('настоящий сбой загрузки по-прежнему показан как сбой', async () => {
    loadMock.mockResolvedValue({ ok: false, code: 'NETWORK' });
    render(<CabinetDashboard />);

    expect(
      await screen.findByText('Не удалось загрузить заведения. Обновите страницу.'),
    ).toBeInTheDocument();
  });
});

describe('С3 — «Возобновить показ» в списке', () => {
  it('есть у карточки, приостановленной партнёром, и нет — у приостановленной модератором', () => {
    const self = render(<EstablishmentVignette establishment={card('suspended')} onDeleted={() => {}} onResumed={() => {}} />);
    expect(screen.getByRole('button', { name: 'Возобновить показ' })).toBeInTheDocument();
    self.unmount();

    render(
      <EstablishmentVignette
        establishment={card('suspended', { suspend_reason: 'Жалобы гостей' })}
        onDeleted={() => {}}
        onResumed={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Возобновить показ' })).not.toBeInTheDocument();
    expect(screen.getByText('Приостановлено: Жалобы гостей')).toBeInTheDocument();
  });

  it('после возобновления карточка переезжает в «Опубликовано»', async () => {
    loadMock.mockResolvedValue({ ok: true, establishments: [card('suspended')] });
    resumeMock.mockResolvedValue({ ok: true, status: 'active' });
    render(<CabinetDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Возобновить показ' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(resumeMock).toHaveBeenCalledWith('est-1');
    expect(screen.queryByRole('button', { name: 'Возобновить показ' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Опубликовано/ })).toHaveTextContent('1');
  });
});

describe('С1 — forgetWizardDraft', () => {
  const KEY = 'nirivio:wizard:new:u1';

  it('удаление черновика в списке стирает форму «Создать заведение», которая в него сохраняет', async () => {
    localStorage.setItem(KEY, JSON.stringify({ form: { name: 'Кофейня' }, draftId: 'est-1' }));
    loadMock.mockResolvedValue({
      ok: true,
      establishments: [{ ...card('draft'), published_at: null }],
    });
    deleteMock.mockResolvedValue({ ok: true });
    render(<CabinetDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Удалить «Кофейня у моста»' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(deleteMock).toHaveBeenCalledWith('est-1');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('стирает форму, которая сохраняет в удалённую карточку', () => {
    localStorage.setItem(KEY, JSON.stringify({ form: {}, draftId: 'd1' }));
    forgetWizardDraft('u1', 'd1');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('не трогает форму другой карточки', () => {
    localStorage.setItem(KEY, JSON.stringify({ form: {}, draftId: 'd2' }));
    forgetWizardDraft('u1', 'd1');
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});
