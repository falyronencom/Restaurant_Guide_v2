/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: emailService.js
 *
 * Verifies Resend wrapper behavior:
 *   - Graceful fallback when RESEND_API_KEY is unset
 *   - Correct invocation of resend.emails.send with Russian subject
 *     + HTML/text bodies
 *   - Error handling: response.error path AND thrown exception path
 */

import { jest } from '@jest/globals';

// Mock the Resend SDK. The SDK exports a class; we intercept the constructor
// so each Resend(apiKey) invocation returns a stub object whose
// emails.send is jest-controllable.
const mockSend = jest.fn();
const mockResendCtor = jest.fn(() => ({
  emails: {
    send: mockSend,
  },
}));

jest.unstable_mockModule('resend', () => ({
  Resend: mockResendCtor,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const emailService = await import('../../services/emailService.js');
const { default: logger } = await import('../../utils/logger.js');

describe('emailService.sendVerificationCodeEmail', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    emailService._resetForTests();
    // resetMocks:true (jest.config.js) wipes factory implementations between
    // tests — re-establish the Resend constructor stub each time so that
    // `new Resend(apiKey)` keeps returning the mocked emails.send handle
    // (per feedback_jest_resetmocks.md).
    mockResendCtor.mockImplementation(() => ({
      emails: { send: mockSend },
    }));
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns sent:false with RESEND_NOT_CONFIGURED when API key is unset', async () => {
    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '123456',
      'Иван',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_NOT_CONFIGURED');
    expect(mockResendCtor).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('configures Resend and sends email with Russian template when API key is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES = '20';

    mockSend.mockResolvedValue({ data: { id: 'msg_abc' }, error: null });

    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '654321',
      'Иван',
    );

    expect(result.sent).toBe(true);
    expect(mockResendCtor).toHaveBeenCalledWith('re_test_key');
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.to).toBe('user@test.com');
    expect(sentMsg.from).toBe('noreply@example.com');
    expect(sentMsg.subject).toContain('Подтверждение email');
    expect(sentMsg.html).toContain('654321');
    expect(sentMsg.text).toContain('654321');
    expect(sentMsg.html).toContain('Иван');
    expect(sentMsg.text).toContain('20 минут');
  });

  // Сверка находок тестировщика с сайтом, 18.10: the code letter goes to app
  // AND site registrations, so it must not send a site visitor «в приложение».
  test('the code letter does not say «в приложении» — one neutral line for app and site', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: { id: 'msg_abc' }, error: null });

    await emailService.sendVerificationCodeEmail('user@test.com', '333444', 'Иван');

    const sentMsg = mockSend.mock.calls[0][0];
    for (const body of [sentMsg.html, sentMsg.text]) {
      expect(body).not.toMatch(/приложени/i);
      expect(body).toContain(emailService.CODE_PROMPT);
    }
  });

  test('uses default nirivio.by from-address and 15-minute expiry when env vars unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: { id: 'msg_abc' }, error: null });

    await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '111222',
      '',
    );

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.from).toBe('noreply@nirivio.by');
    expect(sentMsg.text).toContain('15 минут');
  });

  test('returns sent:false with RESEND_ERROR when response.error is populated', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid recipient' },
    });

    const result = await emailService.sendVerificationCodeEmail(
      'bad-address',
      '999000',
      'Test',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_ERROR');
  });

  test('returns sent:false with RESEND_ERROR when send throws', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockRejectedValue(new Error('Network failure'));

    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '999000',
      'Test',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_ERROR');
  });

  test('caches Resend client across calls (constructor invoked once)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: { id: 'x' }, error: null });

    await emailService.sendVerificationCodeEmail('a@b.com', '111111', '');
    await emailService.sendVerificationCodeEmail('c@d.com', '222222', '');
    await emailService.sendVerificationCodeEmail('e@f.com', '333333', '');

    expect(mockResendCtor).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});

describe('emailService.sendPasswordResetEmail', () => {
  const originalEnv = { ...process.env };
  const RAW_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

  beforeEach(() => {
    jest.clearAllMocks();
    emailService._resetForTests();
    mockResendCtor.mockImplementation(() => ({
      emails: { send: mockSend },
    }));
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.PASSWORD_RESET_EXPIRY_MINUTES;
    delete process.env.SITE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns sent:false with RESEND_NOT_CONFIGURED when API key is unset', async () => {
    const result = await emailService.sendPasswordResetEmail(
      'user@test.com',
      RAW_TOKEN,
      'Иван',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_NOT_CONFIGURED');
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('sends Russian reset email with deep link built from SITE_URL', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.SITE_URL = 'http://localhost:3001/';
    process.env.PASSWORD_RESET_EXPIRY_MINUTES = '45';

    mockSend.mockResolvedValue({ data: { id: 'msg_reset' }, error: null });

    const result = await emailService.sendPasswordResetEmail(
      'user@test.com',
      RAW_TOKEN,
      'Иван',
    );

    expect(result.sent).toBe(true);

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.to).toBe('user@test.com');
    expect(sentMsg.from).toBe('noreply@example.com');
    expect(sentMsg.subject).toContain('Сброс пароля');
    // Trailing slash on SITE_URL must not produce a double slash
    const expectedUrl = `http://localhost:3001/reset-password?token=${RAW_TOKEN}`;
    expect(sentMsg.html).toContain(expectedUrl);
    expect(sentMsg.text).toContain(expectedUrl);
    expect(sentMsg.html).toContain('Иван');
    expect(sentMsg.text).toContain('45 минут');
  });

  test('defaults: nirivio.by site + from-address, 30-minute expiry', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: { id: 'msg_reset' }, error: null });

    await emailService.sendPasswordResetEmail('user@test.com', RAW_TOKEN, '');

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.from).toBe('noreply@nirivio.by');
    expect(sentMsg.text).toContain(`https://nirivio.by/reset-password?token=${RAW_TOKEN}`);
    expect(sentMsg.text).toContain('30 минут');
  });

  test('returns sent:false with RESEND_ERROR when response.error is populated', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Invalid recipient' },
    });

    const result = await emailService.sendPasswordResetEmail(
      'bad-address',
      RAW_TOKEN,
      'Test',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_ERROR');
  });

  test('returns sent:false with RESEND_ERROR when send throws', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockRejectedValue(new Error('Network failure'));

    const result = await emailService.sendPasswordResetEmail(
      'user@test.com',
      RAW_TOKEN,
      'Test',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('RESEND_ERROR');
  });
});

// Н33, Н35 (24.10): during the mail incident of 22–23.10 the reason a letter
// did not go out and the account it was for sat in different log lines, and a
// provider that kept silent held the resend request past the clients' own
// limits. Both senders: one error line with the account and the reason, and a
// bounded wait that ends the same way as a refusal.
describe.each([
  ['sendVerificationCodeEmail', (ctx) => emailService.sendVerificationCodeEmail('user@test.com', '123456', 'Иван', ctx)],
  ['sendPasswordResetEmail', (ctx) => emailService.sendPasswordResetEmail('user@test.com', 'a1b2c3', 'Иван', ctx)],
])('emailService.%s — a letter that did not go out', (_name, send) => {
  const originalEnv = { ...process.env };
  const USER = { userId: 'user-7' };

  beforeEach(() => {
    jest.clearAllMocks();
    emailService._resetForTests();
    mockResendCtor.mockImplementation(() => ({
      emails: { send: mockSend },
    }));
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_SEND_TIMEOUT_MS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test.each([
    ['the provider answers with an error', () => mockSend.mockResolvedValue({ data: null, error: { name: 'application_error' } })],
    ['the send throws', () => mockSend.mockRejectedValue(new Error('Network failure'))],
  ])('%s: one error line naming the account and the reason', async (_case, arrange) => {
    arrange();

    const result = await send(USER);

    expect(result).toEqual({ sent: false, reason: 'RESEND_ERROR' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 'user-7', reason: 'RESEND_ERROR' }),
    );
  });

  test('a provider that does not answer in time: sent:false, the request aborted, one error line', async () => {
    process.env.EMAIL_SEND_TIMEOUT_MS = '20';
    mockSend.mockReturnValue(new Promise(() => {}));

    const result = await send(USER);

    expect(result).toEqual({ sent: false, reason: 'RESEND_TIMEOUT' });
    const [, options] = mockSend.mock.calls[0];
    expect(options.signal.aborted).toBe(true);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 'user-7', reason: 'RESEND_TIMEOUT' }),
    );
  });

  test.each([
    ['unset', undefined],
    ['zero', '0'],
    ['negative', '-5'],
    ['not a number', 'soon'],
  ])('the wait is bounded at 8 s by default (EMAIL_SEND_TIMEOUT_MS %s)', async (_case, value) => {
    if (value !== undefined) process.env.EMAIL_SEND_TIMEOUT_MS = value;
    mockSend.mockResolvedValue({ data: { id: 'msg' }, error: null });
    const timeout = jest.spyOn(AbortSignal, 'timeout');

    try {
      const result = await send(USER);
      expect(result.sent).toBe(true);
      expect(timeout).toHaveBeenCalledWith(8000);
    } finally {
      timeout.mockRestore();
    }
  });

  test('no mail provider in production: an error line with the account', async () => {
    process.env.RESEND_API_KEY = '';
    process.env.NODE_ENV = 'production';

    try {
      const result = await send(USER);
      expect(result).toEqual({ sent: false, reason: 'RESEND_NOT_CONFIGURED' });
    } finally {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    }
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 'user-7', reason: 'RESEND_NOT_CONFIGURED' }),
    );
  });

  test('no mail provider outside production (dev, tests): a warning, not an error', async () => {
    process.env.RESEND_API_KEY = '';

    await send(USER);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 'user-7', reason: 'RESEND_NOT_CONFIGURED' }),
    );
  });
});

// Until 30.10.2026 every line about a letter — sent, refused, timed out, not
// configured — carried the recipient's address (toEmail). The account names
// the person; the address stays out of the log, whichever way the send ends.
describe.each([
  ['sendVerificationCodeEmail', (ctx) => emailService.sendVerificationCodeEmail('Anna.Petrova@test.by', '123456', 'Анна', ctx)],
  ['sendPasswordResetEmail', (ctx) => emailService.sendPasswordResetEmail('Anna.Petrova@test.by', 'a1b2c3', 'Анна', ctx)],
])('emailService.%s — the recipient address is not logged', (_name, send) => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    emailService._resetForTests();
    mockResendCtor.mockImplementation(() => ({
      emails: { send: mockSend },
    }));
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_SEND_TIMEOUT_MS = '20';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const logged = () => ['info', 'warn', 'error'].flatMap((level) => logger[level].mock.calls);

  test.each([
    ['sent', () => mockSend.mockResolvedValue({ data: { id: 'msg-1' }, error: null })],
    ['the provider answers with an error', () => mockSend.mockResolvedValue({ data: null, error: { name: 'application_error' } })],
    ['the send throws', () => mockSend.mockRejectedValue(new Error('Network failure'))],
    ['the provider does not answer in time', () => mockSend.mockReturnValue(new Promise(() => {}))],
    ['no mail provider (tests, dev)', () => { process.env.RESEND_API_KEY = ''; }],
    ['no mail provider in production', () => { process.env.RESEND_API_KEY = ''; process.env.NODE_ENV = 'production'; }],
  ])('%s: the account is there, the address is not', async (_case, arrange) => {
    arrange();

    try {
      await send({ userId: 'user-7' });
    } finally {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
    }

    expect(logged().length).toBeGreaterThan(0);
    const text = JSON.stringify(logged()).toLowerCase();
    expect(text).not.toContain('anna.petrova');
    expect(text).not.toContain('test.by');
    expect(logged().some(([, context]) => context?.userId === 'user-7')).toBe(true);
  });

  test('without an account named by the caller: no address either', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'application_error' } });

    await send(undefined);

    expect(JSON.stringify(logged()).toLowerCase()).not.toContain('anna.petrova');
  });
});
