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

/** Whether the account may be deleted now — backend accountDeletionService. */
export type AccountDeletionCheck = {
  allowed: boolean;
  refusal: { code: string; message: string } | null;
};

/**
 * CHECK → GET /api/v1/auth/account/deletion → data { allowed, refusal }. A
 * holder of cards gets allowed:false with the server's Russian «напишите в
 * поддержку» — shown as is.
 */
export async function getAccountDeletionCheck(): Promise<AccountDeletionCheck> {
  return authedFetch<AccountDeletionCheck>('/api/v1/auth/account/deletion');
}

/**
 * DELETE → DELETE /api/v1/auth/account, body { confirmation } — the word as
 * the person typed it: the backend checks it again (case and spaces aside),
 * so a caller that forgot the question cannot delete anyone → data
 * { deleted: true }. Every session of the account ends on the server.
 */
export async function deleteOwnAccount(confirmation: string): Promise<void> {
  await authedFetch<{ deleted: boolean }>('/api/v1/auth/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  });
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
