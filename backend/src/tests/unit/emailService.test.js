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

  test('uses default niriveo.by from-address and 15-minute expiry when env vars unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    mockSend.mockResolvedValue({ data: { id: 'msg_abc' }, error: null });

    await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '111222',
      '',
    );

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.from).toBe('noreply@niriveo.by');
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
