import 'server-only';

import type { AuthUserData } from '@/lib/api/types';
import { authedFetch } from '@/lib/auth/session';

/*
 * Profile — authenticated typed endpoint functions over /api/v1/auth/{me,profile}.
 *
 * Wire notes (verified against backend authController):
 *   ME      → GET /api/v1/auth/me           → data.user (camelCase, incl.
 *             emailVerified / authMethod — the rg_user cookie carries neither)
 *   UPDATE  → PUT /api/v1/auth/profile      body { name } (plain key; the other
 *             accepted key is snake_case avatar_url — NOT sent from here),
 *             echoes the same data.user shape as /me.
 *
 * user_id never travels in a payload — backend derives it from the JWT.
 */

export async function getMe(): Promise<AuthUserData> {
  const data = await authedFetch<{ user: AuthUserData }>('/api/v1/auth/me');
  return data.user;
}

export async function putProfileName(name: string): Promise<AuthUserData> {
  const data = await authedFetch<{ user: AuthUserData }>(
    '/api/v1/auth/profile',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  return data.user;
}
