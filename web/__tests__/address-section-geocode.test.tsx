/*
 * The wizard's address assist (thread «Расходы посторонних», point 4,
 * 03.11.2026): it asks /api/geocode by a same-origin POST, and a refusal
 * reads as what happened — a gone session is not «address not found».
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AddressSection } from '@/components/cabinet/wizard/AddressSection';
import { emptyForm } from '@/lib/partner/form';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function renderFilled() {
  const patch = jest.fn();
  const form = { ...emptyForm(), city: 'Минск', street: 'проспект Независимости', building: '1' };
  render(<AddressSection form={form} patch={patch} />);
  return patch;
}

function answer(status: number, body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const press = () => fireEvent.click(screen.getByRole('button', { name: /определить/i }));

it('asks by POST with the address in the body, and fills the coordinates', async () => {
  const fetchMock = answer(200, { result: { lat: 53.9, lng: 27.56 } });
  const patch = renderFilled();

  press();

  await waitFor(() => expect(patch).toHaveBeenCalledWith({ latitude: 53.9, longitude: 27.56 }));
  expect(fetchMock).toHaveBeenCalledWith('/api/geocode', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ q: 'Минск, проспект Независимости, 1' }),
  }));
});

it('nothing found — the old sentence', async () => {
  answer(200, { result: null });
  renderFilled();

  press();

  expect(await screen.findByText('Адрес не найден — введите координаты вручную.')).toBeInTheDocument();
});

it('a gone session — named, not «address not found»', async () => {
  answer(401, { result: null, code: 'NO_SESSION' });
  renderFilled();

  press();

  expect(await screen.findByText('Сессия закончилась — войдите снова или введите координаты вручную.'))
    .toBeInTheDocument();
});

it('the hour\'s lookups spent — says so', async () => {
  answer(429, { result: null, code: 'RATE_LIMITED' });
  renderFilled();

  press();

  expect(await screen.findByText('Слишком много запросов за час — введите координаты вручную.'))
    .toBeInTheDocument();
});

it('any other refusal — the general sentence', async () => {
  answer(503, { result: null, code: 'BUSY' });
  renderFilled();

  press();

  expect(await screen.findByText('Не удалось определить координаты. Введите вручную.')).toBeInTheDocument();
});
