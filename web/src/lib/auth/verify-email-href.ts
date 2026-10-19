/**
 * /verify-email carrying the page to go back to (сверка находок тестировщика с
 * сайтом, 18.10, п. 11): after registering, a visitor who came from a card,
 * the heart or «Стать партнёром» returns there — after confirming the code or
 * by «Позже» — instead of being left with «На главную». The value must be a
 * path already guarded by guardReturnTo; the page guards it again.
 */
export function verifyEmailHref(returnTo: string): string {
  return returnTo === '/'
    ? '/verify-email'
    : `/verify-email?returnTo=${encodeURIComponent(returnTo)}`;
}
