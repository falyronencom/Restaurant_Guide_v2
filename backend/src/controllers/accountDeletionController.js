/**
 * Account Deletion Controller — the person deletes their own account
 * (brief В1, 18.10.2026).
 *
 * Endpoints:
 *   GET    /api/v1/auth/account/deletion — may the account be deleted now, and
 *          if not, why (the screen asks before it shows the confirmation)
 *   DELETE /api/v1/auth/account          — delete it, body { confirmation: 'УДАЛИТЬ' }
 *
 * Thin layer: the rules and the texts are in services/accountDeletionService.js.
 */

import * as accountDeletionService from '../services/accountDeletionService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/** GET /api/v1/auth/account/deletion → { allowed, refusal: { code, message } | null } */
export const getDeletionCheck = asyncHandler(async (req, res) => {
  const check = await accountDeletionService.getDeletionCheck(req.user.userId);
  res.status(200).json({ success: true, data: check });
});

/** DELETE /api/v1/auth/account — body { confirmation } → { deleted: true } */
export const deleteAccount = asyncHandler(async (req, res) => {
  await accountDeletionService.deleteAccount(req.user.userId, req.body?.confirmation);
  res.status(200).json({ success: true, data: { deleted: true } });
});
