'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { resumeEstablishmentAction } from '@/lib/partner/client';
import { refusalMessage } from '@/lib/partner/errors';

/*
 * «Возобновить» for a card the partner paused (сверка находок тестировщика с
 * сайтом, 18.10, пункт С3): suspended → active, without moderation (backend
 * resumeEstablishment). Rendered only for the partner's own pause; a
 * moderator's suspension is refused by the server (403 ADMIN_SUSPENDED), and
 * its text is shown if a stale list offered the button.
 */
export function ResumeEstablishmentButton({
  establishmentId,
  onResumed,
}: {
  establishmentId: string;
  onResumed: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = async () => {
    setBusy(true);
    setError(null);
    const r = await resumeEstablishmentAction(establishmentId);
    setBusy(false);
    if (r.ok) onResumed(establishmentId);
    else setError(refusalMessage(r));
  };

  return (
    <>
      <Button type="button" size="sm" onClick={resume} disabled={busy} className="flex-1">
        {busy ? 'Возобновление…' : 'Возобновить показ'}
      </Button>
      {error && (
        <p className="w-full text-caption-m text-error-dark" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
