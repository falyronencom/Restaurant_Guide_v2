/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: emailService.js
 *
 * Verifies SendGrid wrapper behavior:
 *   - Graceful fallback when SENDGRID_API_KEY is unset
 *   - Correct invocation of sgMail.send with Russian subject + HTML/text bodies
 *   - Error handling when SendGrid throws
 */

import { jest } from '@jest/globals';

// Mock @sendgrid/mail
const mockSetApiKey = jest.fn();
const mockSend = jest.fn();

jest.unstable_mockModule('@sendgrid/mail', () => ({
  default: {
    setApiKey: mockSetApiKey,
    send: mockSend,
  },
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
    // Default state: no API key
    delete process.env.SENDGRID_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('returns sent:false with SENDGRID_NOT_CONFIGURED when API key is unset', async () => {
    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '123456',
      'Иван',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('SENDGRID_NOT_CONFIGURED');
    expect(mockSetApiKey).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('configures SendGrid and sends email with Russian template when API key is set', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES = '20';

    mockSend.mockResolvedValue([{ statusCode: 202 }]);

    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '654321',
      'Иван',
    );

    expect(result.sent).toBe(true);
    expect(mockSetApiKey).toHaveBeenCalledWith('SG.test_key');
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.to).toBe('user@test.com');
    expect(sentMsg.from).toBe('noreply@example.com');
    expect(sentMsg.subject).toContain('Подтверждение email');
    // Code appears in both HTML and plain-text bodies
    expect(sentMsg.html).toContain('654321');
    expect(sentMsg.text).toContain('654321');
    // Russian greeting with name
    expect(sentMsg.html).toContain('Иван');
    // Custom expiry minutes propagated into copy
    expect(sentMsg.text).toContain('20 минут');
  });

  test('uses default from-address and 15-minute expiry when env vars unset', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    mockSend.mockResolvedValue([{ statusCode: 202 }]);

    await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '111222',
      '',
    );

    const sentMsg = mockSend.mock.calls[0][0];
    expect(sentMsg.from).toBe('noreply@restaurantguide.by');
    expect(sentMsg.text).toContain('15 минут');
  });

  test('returns sent:false with SENDGRID_ERROR when sgMail.send throws', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    mockSend.mockRejectedValue(new Error('Network failure'));

    const result = await emailService.sendVerificationCodeEmail(
      'user@test.com',
      '999000',
      'Test',
    );

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('SENDGRID_ERROR');
  });

  test('caches API key configuration across calls (setApiKey called once)', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test_key';
    mockSend.mockResolvedValue([{ statusCode: 202 }]);

    await emailService.sendVerificationCodeEmail('a@b.com', '111111', '');
    await emailService.sendVerificationCodeEmail('c@d.com', '222222', '');
    await emailService.sendVerificationCodeEmail('e@f.com', '333333', '');

    expect(mockSetApiKey).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});
