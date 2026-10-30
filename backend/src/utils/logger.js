import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Custom log format that redacts sensitive information before logging.
 * This prevents accidentally logging passwords, tokens, or other secrets.
 *
 * Critical security requirement from architectural review: all sensitive data
 * must be logged as [REDACTED] to prevent credential leakage through logs.
 *
 * Constraint that shapes the implementation (OSB-I1): with winston 3.x the
 * call pattern used across this codebase — `logger.error('message', { ctx })`
 * — spreads the context onto the TOP LEVEL of `info` (there is no
 * `info.meta`), so redaction walks the top-level keys and recurses into
 * plain nested objects/arrays. Depth-capped and cycle-guarded; non-plain
 * values (Error, Date, Buffer) pass through untouched so
 * `winston.format.errors` output stays intact.
 */
const SENSITIVE_FIELDS = new Set([
  'password',
  'token',
  'refresh_token',
  'access_token',
  'authorization',
]);
const REDACTION_DEPTH_LIMIT = 4;
const REDACTED = '[REDACTED]';

/**
 * Personal data: no e-mail address and no phone number of a person reaches
 * the log, whoever writes the line (30.10.2026). Two layers, so that a line
 * written later without thinking of it is caught either way:
 *  - a field NAMED for one (email, toEmail, user_email, phone, phoneNumber…)
 *    is replaced whole, whatever it holds — a phone typed without its plus
 *    included; a field about one (emailVerified, phone_verified) is not named
 *    for it and stays, and so do a null (no address at all) and a flag
 *    (hasEmail: true);
 *  - an ADDRESS or an international phone number (a plus and 9–15 digits,
 *    spaces, dashes or brackets between them) inside any text — the message,
 *    an error's message, a nested field — is cut out, the rest of the text
 *    kept, so the line still reads. Also as a URL's query carries them (the
 *    request line, e.g. the panel's user search): «@» as %40, «+» as %2B, a
 *    space as «+» or %20.
 * Not caught: a phone without its plus in a field not named for one — a bare
 * run of digits cannot be told from an id or a count.
 *
 * The patterns' runs are bounded (64 / 63 characters), so a long text costs
 * a linear pass, not a backtracking one.
 */
const PERSONAL_FIELD = /(e[-_]?mail|phone)s?(_?(address|number)s?)?$/i;
const EMAIL_IN_TEXT = /[\p{L}\p{N}._%+-]{1,64}(?:@|%40)(?:[\p{L}\p{N}-]{1,63}\.){1,8}\p{L}{2,63}/gu;
const PHONE_IN_TEXT = /(?:\+|%2[Bb])\d(?:(?:[ ()+-]|%20|%28|%29){0,2}\d){8,14}/g;
const ENCODED_PLUS = /%2b/i;

const redactText = (text) => {
  let out = text;
  if (out.includes('@') || out.includes('%40')) out = out.replace(EMAIL_IN_TEXT, REDACTED);
  if (out.includes('+') || ENCODED_PLUS.test(out)) out = out.replace(PHONE_IN_TEXT, REDACTED);
  return out;
};

const redactField = (key, value, depth, seen) => {
  if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
    return REDACTED;
  }
  if (PERSONAL_FIELD.test(key) && value !== null && value !== undefined && typeof value !== 'boolean') {
    return REDACTED;
  }
  return redactValue(value, depth, seen);
};

const redactValue = (value, depth, seen) => {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value === null || typeof value !== 'object' || depth > REDACTION_DEPTH_LIMIT) {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  let redacted;
  if (Array.isArray(value)) {
    redacted = value.map((item) => redactValue(item, depth + 1, seen));
  } else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      seen.delete(value);
      return value;
    }
    redacted = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = redactField(key, item, depth + 1, seen);
    }
  }

  // Backtrack so shared (non-circular) references are not misreported as
  // circular — only genuine cycles remain in `seen` on the way down.
  seen.delete(value);
  return redacted;
};

export const redactSensitiveData = winston.format((info) => {
  for (const [key, value] of Object.entries(info)) {
    info[key] = redactField(key, value, 1, new WeakSet());
  }
  return info;
});

/**
 * Production format: JSON for structured logging in log aggregation systems
 * Development format: Colorized console output for human readability
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactSensitiveData(),
  winston.format.json(),
);

const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactSensitiveData(),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  }),
);

/**
 * Winston logger instance configured for the current environment.
 * 
 * Log levels (in order of severity):
 * - error: Critical errors that need immediate attention
 * - warn: Warning conditions that should be reviewed
 * - info: General informational messages about application flow
 * - debug: Detailed debugging information for development
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
  // Prevent unhandled exception crashes - log and exit gracefully
  exitOnError: false,
});

/**
 * Add correlation ID to log context for request tracing.
 * This allows tracking a single request through all log entries.
 * 
 * @param {string} correlationId - Unique identifier for the request
 * @returns {winston.Logger} Child logger with correlation context
 */
export const createRequestLogger = (correlationId) => {
  return logger.child({ correlationId });
};

export default logger;
