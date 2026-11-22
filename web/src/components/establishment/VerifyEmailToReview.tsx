'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { resendVerificationCodeAction } from '@/lib/auth/actions';
import { verifyEmailHref } from '@/lib/auth/verify-email-href';
import { SEND_CODE_LABEL } from '@/lib/reviews/email-gate';

/*
 * В9 — in place of the review form for a guest whose address is not
 * confirmed: the text, and «Отправить код». The button sends the letter with
 * the code and then opens the code page, which leads back to this card
 * (/verify-email?returnTo=<card> — «Продолжить» after the code).
 *
 * The letter goes out here, once: /verify-email sends nothing when it opens
 * (its own button is «Отправить код повторно»). A refused send says why — the
 * texts of the code page's own resend — and the button stays. «Почта уже
 * подтверждена» (the address was confirmed elsewhere — in the app — after the
 * check) hands back to the form: `onAlreadyVerified`.
 *
 * Shared by WriteReviewCta (the check before the form) and WriteReviewModal
 * (the server's refusal EMAIL_NOT_VERIFIED).
 */
export function VerifyEmailToReview({
  text,
  detailPath,
  onAlreadyVerified,
}: {
  text: string;
  detailPath: string;
  onAlreadyVerified: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setPending(true);
    setError(null);
    const result = await resendVerificationCodeAction(
      null,
      new FormData(),
    ).catch(() => null);
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
      <p className='text-body-m text-foreground'>{text}</p>
      {error ? (
        <p aria-live='polite' className='text-caption-l text-destructive'>
          {error}
        </p>
      ) : null}
      <Button
        type='button'
        size='cta'
        onClick={sendCode}
        disabled={pending}
        className='self-start bg-brand text-text-on-primary hover:bg-brand/90'
      >
        {pending ? 'Отправляем…' : SEND_CODE_LABEL}
      </Button>
    </div>
  );
}
