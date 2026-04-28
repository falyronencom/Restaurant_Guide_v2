/**
 * Email Service
 *
 * Wrapper around SendGrid for transactional email delivery.
 *
 * Graceful fallback: if SENDGRID_API_KEY is unset (local dev without
 * SendGrid setup), sendVerificationCodeEmail logs a warning and returns
 * { sent: false } instead of throwing. This lets the verification flow
 * proceed in development — code is created in DB and visible in logs,
 * just not actually emailed.
 *
 * Production setup (Coordinator action):
 *   1. Create SendGrid account
 *   2. Verify sender (Single Sender or domain DNS)
 *   3. Generate API key, set SENDGRID_API_KEY in Railway env
 *   4. Set EMAIL_FROM_ADDRESS to verified sender
 */

import sgMail from '@sendgrid/mail';
import logger from '../utils/logger.js';

let isConfigured = false;

const ensureConfigured = () => {
  if (isConfigured) return true;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return false;
  }
  sgMail.setApiKey(apiKey);
  isConfigured = true;
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
 * Send a verification code email.
 *
 * @param {string} toEmail
 * @param {string} code - 6-digit numeric
 * @param {string} userName - May be empty string
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export const sendVerificationCodeEmail = async (toEmail, code, userName) => {
  if (!ensureConfigured()) {
    logger.warn('SendGrid not configured — email verification code not sent', {
      toEmail,
      hint: 'Set SENDGRID_API_KEY env var to enable email delivery',
    });
    return { sent: false, reason: 'SENDGRID_NOT_CONFIGURED' };
  }

  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@restaurantguide.by';
  const expiryMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES, 10) || 15;

  const msg = {
    to: toEmail,
    from: fromAddress,
    subject: 'Подтверждение email — Restaurant Guide Belarus',
    text: buildTextBody(code, userName, expiryMinutes),
    html: buildHtmlBody(code, userName, expiryMinutes),
  };

  try {
    await sgMail.send(msg);
    logger.info('Verification email sent', { toEmail });
    return { sent: true };
  } catch (error) {
    logger.error('Failed to send verification email via SendGrid', {
      error: error.message,
      code: error.code,
      toEmail,
    });
    return { sent: false, reason: 'SENDGRID_ERROR' };
  }
};

/**
 * Reset internal state. Test-only utility — exported so unit tests can
 * re-initialize between cases. Not used in production code paths.
 */
export const _resetForTests = () => {
  isConfigured = false;
};
