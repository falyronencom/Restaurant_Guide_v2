'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { resendVerificationCodeAction } from '@/lib/auth/actions';
import { verifyEmailHref } from '@/lib/auth/verify-email-href';
import { SEND_CODE_LABEL } from '@/lib/reviews/email-gate';

/*
 * В9 — in place of the review form for a guest whose address is not
 * confirmed: «Отправить код» (and the В9 words, unless the dialog already
 * carries them as its description). The button sends the letter with the code
 * and then opens the code page, which leads back to this card
 * (/verify-email?returnTo=<card> — «Продолжить» after the code).
 *
 * The letter goes out here, once: /verify-email sends nothing when it opens
 * (its own button is «Отправить код повторно»), and a second press while the
 * first is on its way does nothing. A refused send says why — the texts of the
 * code page's own resend — keeps the button, and offers the code page all the
 * same («Подтвердить», as in the profile): after «Слишком много запросов
 * кода» the last code is most likely already in the mail. «Почта уже
 * подтверждена» (confirmed elsewhere — in the app — after the check) hands
 * back to the form: `onAlreadyVerified`. Closed before the answer came (the
 * dialog unmounts this), nothing follows the answer.
 *
 * Busy is `aria-disabled`, not `disabled`: a disabled button loses the focus
 * to the page (Chrome), and the dialog would not hand it back.
 *
 * Shared by WriteReviewCta (the check before the form) and WriteReviewModal
 * (the server's refusal EMAIL_NOT_VERIFIED — `text` there, announced).
 */
export function VerifyEmailToReview({
  text,
  detailPath,
  onAlreadyVerified,
}: {
  /** The В9 words, shown and announced; omitted where the dialog's description carries them. */
  text?: string;
  detailPath: string;
  onAlreadyVerified: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function sendCode() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await resendVerificationCodeAction(
      null,
      new FormData(),
    ).catch(() => null);
    if (!mounted.current) return;
    if (result?.ok) {
      // Stays «Отправляем…» until the code page opens.
      router.push(verifyEmailHref(detailPath));
      return;
    }
    setPending(false);
    if (result && result.code === 'EMAIL_ALREADY_VERIFIED') {
      onAlreadyVerified();
      return;
    }
    setError(result ? result.message : 'Сеть недоступна. Попробуйте позже.');
  }

  return (
    <div className='flex flex-col gap-3'>
      {text ? (
        <p role='alert' className='text-body-m text-foreground'>
          {text}
        </p>
      ) : null}
      {error ? (
        <p role='alert' className='text-caption-l text-destructive'>
          {error}{' '}
          <Link
            href={verifyEmailHref(detailPath)}
            className='font-medium text-brand underline-offset-4 hover:underline'
          >
            Подтвердить
          </Link>
        </p>
      ) : null}
      <Button
        type='button'
        size='cta'
        onClick={sendCode}
        aria-disabled={pending || undefined}
        className='self-start bg-brand text-text-on-primary hover:bg-brand/90 aria-disabled:opacity-50'
      >
        {pending ? 'Отправляем…' : SEND_CODE_LABEL}
      </Button>
    </div>
  );
}
