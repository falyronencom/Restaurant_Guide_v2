/**
 * The pause and the resume keep the card's interval of page drops too (Trunk,
 * addendum 1 to the directive of part 1, 1.3): a pause or a resume made a
 * moment after another drop of the card is answered «deferred, retry in N ms»,
 * and the buttons hand that drop to the cabinet's timer
 * (lib/partner/page-refresh-client) — or the guest would see a paused card
 * for up to an hour.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';

jest.mock('@/lib/partner/client', () => ({
  suspendEstablishmentAction: jest.fn(),
  resumeEstablishmentAction: jest.fn(),
}));
jest.mock('@/lib/partner/page-refresh-client', () => ({ followPageRefresh: jest.fn() }));

import { ResumeEstablishmentButton } from '@/components/cabinet/ResumeEstablishmentButton';
import { SuspendEstablishmentButton } from '@/components/cabinet/SuspendEstablishmentButton';
import { resumeEstablishmentAction, suspendEstablishmentAction } from '@/lib/partner/client';
import { followPageRefresh } from '@/lib/partner/page-refresh-client';

const suspendMock = suspendEstablishmentAction as jest.Mock;
const resumeMock = resumeEstablishmentAction as jest.Mock;
const followMock = followPageRefresh as jest.Mock;

const DEFERRED = { refreshed: false, retryInMs: 12_000 };

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  for (const mock of [suspendMock, resumeMock, followMock]) mock.mockReset();
});

it('a pause the interval deferred: its drop goes to the cabinet\'s timer', async () => {
  suspendMock.mockResolvedValue({ ok: true, status: 'suspended', page: DEFERRED });
  const onSuspended = jest.fn();
  render(<SuspendEstablishmentButton establishmentId="e1" onSuspended={onSuspended} />);

  fireEvent.click(screen.getByRole('button', { name: 'Приостановить показ' }));
  await flush();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Приостановить' }));
  await flush();

  expect(onSuspended).toHaveBeenCalledWith('e1');
  expect(followMock).toHaveBeenCalledWith('e1', DEFERRED);
});

it('a resume the interval deferred: the same', async () => {
  resumeMock.mockResolvedValue({ ok: true, status: 'active', page: DEFERRED, publicPath: '/minsk/cafes/kafe' });
  const onResumed = jest.fn();
  render(<ResumeEstablishmentButton establishmentId="e1" onResumed={onResumed} />);

  fireEvent.click(screen.getByRole('button', { name: 'Возобновить показ' }));
  await flush();

  expect(onResumed).toHaveBeenCalledWith('e1', { publicPath: '/minsk/cafes/kafe' });
  expect(followMock).toHaveBeenCalledWith('e1', DEFERRED);
});

it('a refusal hands nothing to the timer', async () => {
  resumeMock.mockResolvedValue({ ok: false, code: 'ADMIN_SUSPENDED', message: 'Показ приостановил модератор.' });
  render(<ResumeEstablishmentButton establishmentId="e1" onResumed={jest.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Возобновить показ' }));
  await flush();

  expect(followMock).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Показ приостановил модератор.');
});
