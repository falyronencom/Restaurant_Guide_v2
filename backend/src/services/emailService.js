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
 *   4. Set EMAIL_FROM_ADDRESS to verified sender (e.g. noreply@nirivio.by)
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
    <h1 style="color: #F06B32; font-size: 24px; margin-bottom: 16px; letter-spacing: 2px;">NIRIVIO</h1>
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
  `— Nirivio`;

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

  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@nirivio.by';
  const expiryMinutes = parseInt(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES, 10) || 15;

  const msg = {
    from: fromAddress,
    to: toEmail,
    subject: 'Подтверждение email — Nirivio',
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
 * Build the password reset email HTML body in Russian.
 * Same plain-template approach as the verification email.
 *
 * @param {string} resetUrl - Full deep link with token query param
 * @param {string} userName
 * @param {number} expiryMinutes
 * @returns {string} HTML
 */
const buildResetHtmlBody = (resetUrl, userName, expiryMinutes) => `
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8">
    <title>Сброс пароля</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h1 style="color: #F06B32; font-size: 24px; margin-bottom: 16px; letter-spacing: 2px;">NIRIVIO</h1>
    <p style="font-size: 16px; line-height: 1.5;">Здравствуйте${userName ? `, ${userName}` : ''}!</p>
    <p style="font-size: 16px; line-height: 1.5;">Мы получили запрос на сброс пароля вашего аккаунта. Чтобы задать новый пароль, нажмите на кнопку:</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${resetUrl}" style="display: inline-block; background: #F06B32; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 8px;">Сбросить пароль</a>
    </div>
    <p style="font-size: 14px; color: #666; line-height: 1.5;">Или скопируйте ссылку в браузер:<br><a href="${resetUrl}" style="color: #F06B32; word-break: break-all;">${resetUrl}</a></p>
    <p style="font-size: 14px; color: #666; line-height: 1.5;">Ссылка действительна ${expiryMinutes} минут и сработает только один раз. Если вы не запрашивали сброс пароля, проигнорируйте это письмо — ваш пароль останется прежним.</p>
    <p style="font-size: 12px; color: #999; margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">Это автоматическое сообщение, отвечать на него не нужно.</p>
  </body>
</html>
`;

/**
 * Build plain-text fallback body for the password reset email.
 */
const buildResetTextBody = (resetUrl, userName, expiryMinutes) =>
  `Здравствуйте${userName ? `, ${userName}` : ''}!\n\n` +
  `Мы получили запрос на сброс пароля вашего аккаунта. ` +
  `Чтобы задать новый пароль, перейдите по ссылке:\n\n` +
  `${resetUrl}\n\n` +
  `Ссылка действительна ${expiryMinutes} минут и сработает только один раз. ` +
  `Если вы не запрашивали сброс пароля, проигнорируйте это письмо — ваш пароль останется прежним.\n\n` +
  `— Nirivio`;

/**
 * Send a password reset email via Resend.
 *
 * The raw token is embedded in a deep link to the web reset page:
 *   ${SITE_URL}/reset-password?token=<raw token>
 * SITE_URL defaults to the production domain; set it explicitly in dev
 * (e.g. http://localhost:3001) to get clickable local links.
 *
 * Same graceful degradation contract as sendVerificationCodeEmail:
 * returns { sent: false, reason } instead of throwing.
 *
 * @param {string} toEmail
 * @param {string} rawToken - Unhashed reset token (hex string)
 * @param {string} userName - May be empty string
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export const sendPasswordResetEmail = async (toEmail, rawToken, userName) => {
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@nirivio.by';
  const expiryMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES, 10) || 30;
  const siteUrl = (process.env.SITE_URL || 'https://nirivio.by').replace(/\/+$/, '');
  const resetUrl = `${siteUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

  if (!ensureConfigured()) {
    logger.warn('Resend not configured — password reset email not sent', {
      toEmail,
      hint: 'Set RESEND_API_KEY env var to enable email delivery',
    });
    if (process.env.NODE_ENV !== 'production') {
      // Dev interception: the raw token exists nowhere but the email, and the
      // DB stores only its hash — without Resend the local console is the only
      // way to exercise the flow end-to-end (same philosophy as the
      // verification code being visible in the DB for dev). Never in prod.
      logger.info('Password reset link (dev interception)', { resetUrl });
    }
    return { sent: false, reason: 'RESEND_NOT_CONFIGURED' };
  }

  const msg = {
    from: fromAddress,
    to: toEmail,
    subject: 'Сброс пароля — Nirivio',
    text: buildResetTextBody(resetUrl, userName, expiryMinutes),
    html: buildResetHtmlBody(resetUrl, userName, expiryMinutes),
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
    logger.info('Password reset email sent', { toEmail, id: result?.data?.id });
    return { sent: true };
  } catch (error) {
    logger.error('Failed to send password reset email via Resend', {
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
