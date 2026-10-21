/**
 * Admin User Controller — the panel's «Пользователи» screen.
 *
 * Endpoints (tester walkthrough 17.10, p. 8):
 *   GET  /api/v1/admin/users                    — find people (e-mail, phone, name)
 *   GET  /api/v1/admin/users/:id                — one person, with the latest block
 *   POST /api/v1/admin/users/:id/block          — block, body { reason }
 *   POST /api/v1/admin/users/:id/unblock        — unblock, body { reason, restore_reviews? }
 *   POST /api/v1/admin/users/:id/reset-name     — name to «Пользователь», body { reason }
 *
 * Thin layer: the rules and the texts are in services/adminUserService.js.
 */

import * as adminUserService from '../services/adminUserService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isViewer } from '../config/panelRoles.js';

const requestMeta = (req) => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

/** GET /api/v1/admin/users?search=&status=active|blocked&page=&per_page= */
export const listUsers = asyncHandler(async (req, res) => {
  const result = await adminUserService.getUsers({
    page: parseInt(req.query.page, 10) || 1,
    perPage: parseInt(req.query.per_page, 10) || 20,
    search: req.query.search,
    status: req.query.status,
    role: req.query.role,
    viewer: isViewer(req.user.role),
  });

  res.status(200).json({ success: true, data: result.users, meta: result.meta });
});

/** GET /api/v1/admin/users/:id */
export const getUser = asyncHandler(async (req, res) => {
  const user = await adminUserService.getUser(req.params.id, { viewer: isViewer(req.user.role) });
  res.status(200).json({ success: true, data: user });
});

/** POST /api/v1/admin/users/:id/block — body { reason } */
export const blockUser = asyncHandler(async (req, res) => {
  const result = await adminUserService.blockUser(
    req.params.id,
    req.body?.reason,
    req.user.userId,
    requestMeta(req),
  );
  res.status(200).json({ success: true, data: result });
});

/** POST /api/v1/admin/users/:id/unblock — body { reason, restore_reviews? } */
export const unblockUser = asyncHandler(async (req, res) => {
  const result = await adminUserService.unblockUser(
    req.params.id,
    req.body?.reason,
    req.user.userId,
    { ...requestMeta(req), restoreReviews: req.body?.restore_reviews },
  );
  res.status(200).json({ success: true, data: result });
});

/** POST /api/v1/admin/users/:id/reset-name — body { reason } */
export const resetUserName = asyncHandler(async (req, res) => {
  const result = await adminUserService.resetUserName(
    req.params.id,
    req.body?.reason,
    req.user.userId,
    requestMeta(req),
  );
  res.status(200).json({ success: true, data: result });
});
