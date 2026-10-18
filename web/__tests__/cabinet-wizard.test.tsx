/**
 * Мастер кабинета партнёра (сверка находок тестировщика с сайтом, 18.10):
 *   С2 — правка, сделанная во время идущего сохранения, уходит следом, а не
 *        теряется; правка за миг до ухода со страницы — тоже;
 *   С7 — стёртое поле уходит на сервер как «стереть»;
 *   С1 — удалённый или отправленный черновик не «оживает» из памяти браузера,
 *        живой черновик можно отложить и начать новое заведение, а 403 на
 *        удалённый черновик не запирает форму;
 *   С3 — приостановленную партнёром карточку можно возобновить;
 *   С6 — неверный телефон назван под полем и не держит остальную правку.
 * Сеть подменена на уровне клиентских вызовов (lib/partner/client).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

import { EditWizardLoader } from '@/components/cabinet/wizard/EditWizardLoader';
import { EstablishmentWizard } from '@/components/cabinet/wizard/EstablishmentWizard';
import type { PartnerEstablishmentDetail } from '@/lib/api/types';
import {
  createEstablishmentAction,
  loadEstablishmentForEdit,
  resumeEstablishmentAction,
  updateEstablishmentAction,
} from '@/lib/partner/client';
import { emptyForm, type WizardFormState } from '@/lib/partner/form';

jest.mock('@/components/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'p@e.by', name: 'П', role: 'partner', avatarUrl: null },
    applySession: jest.fn(),
  }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/partner/client', () => ({
  createEstablishmentAction: jest.fn(),
  updateEstablishmentAction: jest.fn(),
  submitEstablishmentAction: jest.fn(),
  loadEstablishmentForEdit: jest.fn(),
  loadEstablishments: jest.fn(() => Promise.resolve({ ok: true, establishments: [] })),
  resumeEstablishmentAction: jest.fn(),
  retryOcrAction: jest.fn(),
}));

const updateMock = updateEstablishmentAction as jest.Mock;
const createMock = createEstablishmentAction as jest.Mock;
const loadMock = loadEstablishmentForEdit as jest.Mock;
const resumeMock = resumeEstablishmentAction as jest.Mock;

const KEY = 'nirivio:wizard:new:u1';

function card(): WizardFormState {
  return {
    ...emptyForm(),
    name: 'Кафе у моста',
    city: 'Минск',
    street: 'ул. Немига, 5',
    categories: ['Кафе'],
    cuisines: ['Народная'],
    description: 'Уютное кафе',
    phone: '+375291234567',
    workingHours: {
      ...emptyForm().workingHours,
      monday: { isOpen: true, open: '09:00', close: '18:00' },
    },
  };
}

function detail(status: PartnerEstablishmentDetail['status']): PartnerEstablishmentDetail {
  return {
    id: 'd1',
    name: 'Кафе у моста',
    description: null,
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
    attributes: {},
    interior_photos: [],
    menu_photos: [],
    primary_photo: null,
    working_hours: { monday: { is_open: true, open: '09:00', close: '18:00' } },
    status,
    moderation_notes: null,
  } as unknown as PartnerEstablishmentDetail;
}

/** A promise the test resolves by hand — a save that is still under way. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function tick(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

const renderEdit = (over: { readOnly?: boolean; onResumed?: () => void } = {}) =>
  render(
    <EstablishmentWizard
      mode="edit"
      establishmentId="e1"
      initial={card()}
      status={over.readOnly ? 'suspended' : 'active'}
      readOnly={over.readOnly ?? false}
      onResumed={over.onResumed}
    />,
  );

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('С2 — автосохранение не теряет правку', () => {
  it('правка во время идущего сохранения уходит следом за ним', async () => {
    const first = deferred<{ ok: true }>();
    updateMock.mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true });
    renderEdit();

    await tick(800); // the opening save (С9) is under way
    expect(updateMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Новое описание' } });
    await tick(800); // the timer fires while the first save is still running
    expect(updateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ ok: true });
      await Promise.resolve();
    });
    await tick();

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock.mock.calls[1][1].description).toBe('Новое описание');
  });

  it('правка за миг до ухода со страницы отправляется при уходе', async () => {
    updateMock.mockResolvedValue({ ok: true });
    const view = renderEdit();
    await tick(800);
    updateMock.mockClear();

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Успел' } });
    await tick(300);
    view.unmount();
    await tick();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][1].description).toBe('Успел');
  });
});

describe('С7 — стёртое при правке доходит до сервера', () => {
  it('стёртый телефон уходит как null, стёртое описание — как пустая строка', async () => {
    updateMock.mockResolvedValue({ ok: true });
    renderEdit();
    await tick(800);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: '' } });
    await tick(800);

    const payload = updateMock.mock.calls.at(-1)![1];
    expect(payload.phone).toBeNull();
    expect(payload.description).toBe('');
  });
});

describe('С7 — «стереть» только то, что сервер правда хранит', () => {
  it('телефон, которого на сервере не было: набран неверно, затем стёрт — «стереть» не отправляется', async () => {
    updateMock.mockResolvedValue({ ok: true });
    render(
      <EstablishmentWizard
        mode="edit"
        establishmentId="e1"
        initial={{ ...card(), phone: '' }}
        status="active"
        readOnly={false}
      />,
    );
    await tick(800);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+37529' } });
    await tick(800); // saved without the phone — it did not pass
    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '' } });
    await tick(800);

    const payload = updateMock.mock.calls.at(-1)![1];
    expect('phone' in payload).toBe(false);
  });
});

describe('С6 — неверный телефон назван и не держит остальную правку', () => {
  it('недописанный телефон: текст под полем, телефон не отправлен, описание отправлено', async () => {
    updateMock.mockResolvedValue({ ok: true });
    renderEdit();
    await tick(800);

    fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '+37529' } });
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Ещё уютнее' } });
    await tick(800);

    expect(
      screen.getByText('Номер не сохраняется: нужен формат +375XXXXXXXXX — 9 цифр после +375.'),
    ).toBeInTheDocument();
    const payload = updateMock.mock.calls.at(-1)![1];
    expect('phone' in payload).toBe(false);
    expect(payload.description).toBe('Ещё уютнее');
  });
});

describe('С1 — удалённый или отправленный черновик не «оживает»', () => {
  const keep = (draftId: string | null) =>
    localStorage.setItem(KEY, JSON.stringify({ form: card(), draftId }));

  it('черновик удалён (403): форма пустая, память браузера очищена', async () => {
    keep('d-gone');
    loadMock.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    expect(loadMock).toHaveBeenCalledWith('d-gone');
    expect(screen.getByLabelText('Название')).toHaveValue('');
    await tick(800);
    expect(updateMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')?.draftId ?? null).toBeNull();
  });

  it('черновик уже отправлен на модерацию: форма пустая, отправленную карточку не правим', async () => {
    keep('d1');
    loadMock.mockResolvedValue({ ok: true, establishment: detail('pending') });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();
    await tick(800);

    expect(screen.getByLabelText('Название')).toHaveValue('');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('живой черновик открывается таким, каким его хранит сервер, и сам ничего не сохраняет', async () => {
    // The browser copy is stale: the draft was edited since on its edit page.
    localStorage.setItem(KEY, JSON.stringify({ form: { ...card(), name: 'Старое имя' }, draftId: 'd1' }));
    loadMock.mockResolvedValue({
      ok: true,
      establishment: { ...detail('draft'), phone: '+375291112233' },
    });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    expect(screen.getByLabelText('Название')).toHaveValue('Кафе у моста');
    expect(screen.getByLabelText('Телефон')).toHaveValue('+375291112233');
    await tick(800);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('403 «не та роль» (устаревший вход) — не «черновик удалён»: форма остаётся', async () => {
    keep('d1');
    loadMock.mockResolvedValue({ ok: false, code: 'FORBIDDEN', role: 'user' });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    expect(screen.getByLabelText('Название')).toHaveValue('Кафе у моста');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null').draftId).toBe('d1');
  });

  it('живой черновик восстановлен, и его можно отложить — «Начать новое заведение»', async () => {
    keep('d1');
    loadMock.mockResolvedValue({ ok: true, establishment: detail('draft') });
    updateMock.mockResolvedValue({ ok: true });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    expect(screen.getByLabelText('Название')).toHaveValue('Кафе у моста');
    expect(screen.getByText(/Вы продолжаете свой черновик «Кафе у моста»/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Начать новое заведение' }));
    await tick(800);

    expect(screen.getByLabelText('Название')).toHaveValue('');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')?.draftId ?? null).toBeNull();
  });

  it('черновик удалён, пока страница открыта (403 на сохранение): форма не заперта и не пишется никуда сама', async () => {
    keep('d1');
    loadMock.mockResolvedValue({ ok: true, establishment: detail('draft') });
    updateMock.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    createMock.mockResolvedValue({ ok: true, id: 'd2', user: null });
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Дописала' } });
    await tick(800);
    await tick();

    expect(updateMock).toHaveBeenCalledWith('d1', expect.anything());
    // Not on its own: a tab left open under another account must not save
    // this form there (lens review, 18.10).
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.getByText(/удалён или недоступен при\s+текущем входе/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Дописала ещё' } });
    await tick(800);
    expect(createMock).not.toHaveBeenCalled();
    // …but the edit is kept in this browser meanwhile.
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null').form.description).toBe('Дописала ещё');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить как новый черновик' }));
    await tick();
    await tick();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].description).toBe('Дописала ещё');
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null').draftId).toBe('d2');
  });

  it('«Начать новое заведение» во время правки черновика: его отказ не касается новой формы', async () => {
    keep('d1');
    loadMock.mockResolvedValue({ ok: true, establishment: detail('draft') });
    const saving = deferred<{ ok: false; code: string }>();
    updateMock.mockReturnValueOnce(saving.promise);
    render(<EstablishmentWizard mode="create" />);
    await tick();
    await tick();

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Правка' } });
    await tick(800); // the update of d1 is under way
    expect(updateMock).toHaveBeenCalledWith('d1', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Начать новое заведение' }));
    await act(async () => {
      saving.resolve({ ok: false, code: 'FORBIDDEN' });
      await Promise.resolve();
    });
    await tick();

    expect(screen.queryByText(/удалён или недоступен/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Название')).toHaveValue('');
  });

  it('«Начать новое заведение» во время сохранения старой формы: новая не попадает в её черновик', async () => {
    keep(null); // a browser-only form that meets the minimum
    const creating = deferred<{ ok: true; id: string; user: null }>();
    createMock.mockReturnValueOnce(creating.promise);
    updateMock.mockResolvedValue({ ok: true });
    render(<EstablishmentWizard mode="create" />);
    await tick();

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Старая' } });
    await tick(800); // the create of the old form is under way
    expect(createMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Начать новое заведение' }));
    // An edit of the new form while the old create is still under way.
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Новое' } });
    await tick(800);
    await act(async () => {
      creating.resolve({ ok: true, id: 'old-card', user: null });
      await Promise.resolve();
    });
    await tick();

    // The old card is not bound to the new form, and the edit is not lost.
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    expect(kept.draftId ?? null).toBeNull();
    expect(kept.form.name).toBe('Новое');

    fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Другое' } });
    await tick(800);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('С3 — приостановленную партнёром карточку можно возобновить', () => {
  it('кнопка «Возобновить показ» зовёт сервер и переводит мастер в правку', async () => {
    resumeMock.mockResolvedValue({ ok: true, status: 'active' });
    const onResumed = jest.fn();
    renderEdit({ readOnly: true, onResumed });

    fireEvent.click(screen.getByRole('button', { name: 'Возобновить показ' }));
    await tick();

    expect(resumeMock).toHaveBeenCalledWith('e1');
    expect(onResumed).toHaveBeenCalledTimes(1);
  });

  it('отказ сервера показан его русским текстом', async () => {
    // A text unlike the site's own for the code — proves the server's is shown.
    resumeMock.mockResolvedValue({
      ok: false,
      code: 'ADMIN_SUSPENDED',
      message: 'Показ остановил модератор (текст сервера).',
    });
    renderEdit({ readOnly: true, onResumed: jest.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Возобновить показ' }));
    await tick();

    expect(screen.getByRole('alert')).toHaveTextContent('Показ остановил модератор (текст сервера).');
  });

  it('после возобновления карточку можно править (через загрузчик правки)', async () => {
    loadMock.mockResolvedValue({
      ok: true,
      establishment: { ...detail('suspended'), moderation_notes: null },
    });
    resumeMock.mockResolvedValue({ ok: true, status: 'active' });
    updateMock.mockResolvedValue({ ok: true });
    render(<EditWizardLoader id="d1" />);
    await tick();
    await tick();

    expect(screen.getByLabelText('Описание')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Возобновить показ' }));
    await tick();

    expect(screen.getByLabelText('Описание')).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Возобновить показ' })).not.toBeInTheDocument();
  });
});
