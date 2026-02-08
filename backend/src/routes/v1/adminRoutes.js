/**
 * Admin Routes
 *
 * Defines admin-specific API endpoints. Currently provides admin
 * authentication with stricter rate limiting than standard user auth.
 *
 * All admin routes are mounted at /api/v1/admin/*
 */

import express from 'express';
import * as adminController from '../../controllers/adminController.js';
import { validateLogin } from '../../validators/authValidation.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/v1/admin/auth/login
 *
 * Admin login endpoint. Uses the same validation as standard login
 * but with stricter rate limiting (5 req/min vs 10 for regular users)
 * and an additional role check in the controller.
 *
 * Middleware chain:
 * 1. Rate limiter: 5 requests per minute per IP (strict for admin)
 * 2. Validation: Reuses validateLogin (email/phone format + password presence)
 * 3. Controller: Verify credentials + check admin role + generate tokens
 */
router.post(
  '/auth/login',
  createRateLimiter({
    limit: 5,
    windowSeconds: 60,
    keyPrefix: 'admin-login',
  }),
  validateLogin,
  adminController.adminLogin,
);

export default router;
