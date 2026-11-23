import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { CARD_TEXTS } from '@/lib/partner/cabinet-texts';
import { cn } from '@/lib/utils';

/*
 * «Сессия истекла.» with «Войти снова» — the card's sections, as the
 * cabinet's list shows it (CabinetDashboard DashboardError): the partner goes
 * to sign in by the button, back to the section after it. No redirect of its
 * own and no markAnonymous(): the cabinet's sign-in loop is fixed by its own
 * registry item, not here.
 */
export function SessionExpired({ returnTo }: { returnTo: string }) {
  return (
    <div className="rounded-[var(--radius-l)] border border-border bg-background p-l text-center">
      <p className="text-body-m text-foreground">{CARD_TEXTS.sessionExpired}</p>
      <Link
        href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        className={cn(buttonVariants({ size: 'sm' }), 'mt-m')}
      >
        {CARD_TEXTS.signInAgain}
      </Link>
    </div>
  );
}
