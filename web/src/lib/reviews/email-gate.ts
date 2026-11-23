/*
 * A new review only with a confirmed address (thread «Отзыв без текста»: the
 * Coordinator's word of 20.11.2026; what the guest sees — В9, 21.11.2026).
 *
 * The words a signed-in guest whose address is not confirmed reads instead of
 * the review form: on «Оставить отзыв» (WriteReviewCta checks the address in
 * /auth/me first) and on the server's refusal 422 EMAIL_NOT_VERIFIED
 * (createReviewAction — the server's own text is written for the older app
 * builds; the site shows these). A plain module: the client islands and the
 * Server Action both import it, and a 'use server' module may export only
 * async functions.
 */

/** The button that sends the letter with the code (VerifyEmailToReview). */
export const SEND_CODE_LABEL = 'Отправить код';

/** В9, with the address the code goes to. */
export function verifyToReviewText(email: string | null | undefined): string {
  const address = email?.trim();
  return address
    ? `Чтобы оставить отзыв, подтвердите почту — пришлём код на ${address}`
    : 'Чтобы оставить отзыв, подтвердите почту';
}
