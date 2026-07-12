import type { Metadata } from 'next';

import { ProfileHub } from '@/components/account/ProfileHub';

/*
 * /profile — the user's account hub (user-ЛК Slice 1): name (editable), email
 * + verification status, password change entry, logout. Static RSC shell (no
 * cookies()); the island loads the fresh /auth/me user via the buffered Route
 * Handler and redirects anonymous visitors to /login?returnTo=/profile.
 */

export const metadata: Metadata = {
  title: 'Профиль',
};

export default function ProfilePage() {
  return (
    <div className="flex flex-col gap-l">
      <h1 className="font-display text-display-s text-foreground">Профиль</h1>
      <ProfileHub />
    </div>
  );
}
