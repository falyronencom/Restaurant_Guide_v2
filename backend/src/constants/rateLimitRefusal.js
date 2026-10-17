/**
 * What a client reads when a limit refuses (429): every limiter, the global
 * one and every createRateLimiter alike (middleware/rateLimiter.js), and the
 * partner's restart of menu recognition refused by the daily recognition
 * allowance (services/ocrAllowance.js). Decision of the Coordinator,
 * 15.10.2026. The app shows the response's message as is on the partner's
 * screens and the guest's booking form; the code RATE_LIMIT_EXCEEDED stays
 * what clients key on.
 *
 * A module of its own so that a service can name the sentence without
 * importing the limiter middleware and everything it loads.
 */
export const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте позже.';
