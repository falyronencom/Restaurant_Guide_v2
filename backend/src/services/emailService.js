/**
 * Email Service
 *
 * Wrapper around Resend (https://resend.com) for transactional email
 * delivery. Chosen over SendGrid because Resend does not require Twilio
 * account creation (SendGrid registration uses Twilio SMS verification,
 * which fails for Belarus phone numbers).
 *
 * Graceful fallback: if RESEND_API_KEY is unset, sendVerificationCodeEmail
 * logs a warning and returns { sent: false } instead of throwing. The
 * verification flow proceeds — code is created in DB and visible in logs,
 * just not actually emailed. This lets the backend run in dev / staging
 * without Resend setup.
 *
 * Production setup (Coordinator action):
 *   1. Create Resend account (https://resend.com/signup — no SMS required)
 *   2. Verify domain (DNS records: TXT for DKIM, TXT for SPF) OR
 *      verify Single Sender (your own email)
 *   3. Generate API key, set RESEND_API_KEY in Railway env
 *   4. Set EMAIL_FROM_ADDRESS to verified sender (e.g. noreply@niriveo.by)
 */

import { Resend } from 'resend';
import logger from '../utils/logger.js';

let resendClient = null;

const ensureConfigured = () => {
  if (resendClient) return true;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return false;
  }
  resendClient = new Resend(apiKey);
  return true;
};

/**
 * Build the verification email HTML body in Russian.
 * Plain template — no images, no inline CSS frameworks; works across clients.
 *
 * @param {string} code - 6-digit code
 * @param {string} userName
 * @param {number} expiryMinutes
 * @returns {string} HTML
 */
const buildHtmlBody = (code, userName, expiryMinutes) => `
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <title>Подтверждение email</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h1 style="color: #F06B32; font-size: 24px; margin-bottom: 16px;">Restaurant Guide Belarus</h1>
    <p style="font-size: 16px; line-height: 1.5;">Здравствуйте${userName ? `, ${userName}` : ''}!</p>
    <p style="font-size: 16px; line-height: 1.5;">Подтвердите свой email-адрес, введя код в приложении:</p>
    <div style="background: #F5F5F5; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: 600; letter-spacing: 8px; color: #1a1a1a; font-family: 'SF Mono', Menlo, monospace;">${code}</span>
    </div>
    <p style="font-size: 14px; color: #666; line-height: 1.5;">Код действителен ${expiryMinutes} минут. Если вы не запрашивали подтверждение, проигнорируйте это письмо.</p>
    <p style="font-size: 12px; color: #999; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">Это автоматическое сообщение, отвечать на него не нужно.</p>
  </body>
</html>
`;

/**
 * Build plain-text fallback body.
 */
const buildTextBody = (code, userName, expiryMinutes) =>
  `Здравствуйте${userName ? `, ${userName}` : ''}!\n\n` +
  `Подтвердите свой email-адрес, введя код в приложении:\n\n` +
  `${code}\n\n` +
  `Код действителен ${expiryMinutes} минут. Если вы не запрашивали подтверждение, проигнорируйте это письмо.\n\n` +
  `— Restaurant Guide Belarus`;

/**
 * Send a verification code email via Resend.
 *
 * Resend API can surface failures two ways:
 *   - response.error populated (no throw)
 *   - thrown exception (network / SDK bug)
 * Both are handled, returning { sent: false, reason: 'RESEND_ERROR' }.
 *
 * @param {string} toEmail
 * @param {string} code - 6-digit numeric
 * @param {string} userName - May be empty string
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export const sendVerificationCodeEmail = async (toEmail, code, userName) => {
  if (!ensureConfigured()) {
    logger.warn('Resend not configured — email verification code not sent', {
      toEmail,
      hint: 'Set RESEND_API_KEY env var to enable email delivery',
    });
    return { sent: false, reason: 'RESEND_NOT_CONFIGURED' };
  }

  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@niriveo.by';
  const expiryMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES, 10) || 15;

  const msg = {
    from: fromAddress,
    to: toEmail,
    subject: 'Подтверждение email — Restaurant Guide Belarus',
    text: buildTextBody(code, userName, expiryMinutes),
    html: buildHtmlBody(code, userName, expiryMinutes),
  };

  try {
    const result = await resendClient.emails.send(msg);
    if (result?.error) {
      logger.error('Resend returned error in response', {
        error: result.error,
        toEmail,
      });
      return { sent: false, reason: 'RESEND_ERROR' };
    }
    logger.info('Verification email sent', { toEmail, id: result?.data?.id });
    return { sent: true };
  } catch (error) {
    logger.error('Failed to send verification email via Resend', {
      error: error.message,
      toEmail,
    });
    return { sent: false, reason: 'RESEND_ERROR' };
  }
};

/**
 * Reset internal state. Test-only utility — exported so unit tests can
 * re-initialize between cases. Not used in production code paths.
 */
export const _resetForTests = () => {
  resendClient = null;
};
