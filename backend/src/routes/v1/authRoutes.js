/**
 * Authentication Routes
 * 
 * This file defines all authentication-related routes and wires together:
 * - Route paths
 * - HTTP methods
 * - Rate limiting middleware
 * - Validation middleware
 * - Authentication middleware (where needed)
 * - Controller functions
 * 
 * Routes are declarative, making the API structure clear and maintainable.
 * Each route explicitly shows all middleware applied in order.
 */

import express from 'express';
import * as authController from '../../controllers/authController.js';
import {
  validateRegister,
  validateLogin,
  validateRefresh,
  validateLogout,
} from '../../validators/authValidation.js';
import { authenticate } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { uploadAvatar } from '../../middleware/upload.js';

const router = express.Router();

/**
 * POST /api/v1/auth/register
 * 
 * Public endpoint for user registration. Creates new user account and returns
 * JWT tokens for immediate login.
 * 
 * Middleware chain:
 * 1. Rate limiter: 20 requests per minute per IP (moderate limit for registrations)
 * 2. Validation: Check email/phone format, password complexity, etc.
 * 3. Controller: Create user and generate tokens
 * 
 * Rate limit is higher than login because legitimate use case is multiple users
 * registering from same IP (e.g., coffee shop WiFi, corporate network).
 */
router.post(
  '/register',
  createRateLimiter({
    limit: 20,
    windowSeconds: 60, // 1 minute
    keyPrefix: 'register',
  }),
  validateRegister,
  authController.register,
);

/**
 * POST /api/v1/auth/login
 * 
 * Public endpoint for user authentication. Verifies credentials and returns
 * JWT tokens if valid.
 * 
 * Middleware chain:
 * 1. Rate limiter: 10 requests per minute per IP (strict limit for brute force protection)
 * 2. Validation: Check email/phone format and password presence
 * 3. Controller: Verify credentials and generate tokens
 * 
 * Stricter rate limit than registration because this is prime target for brute
 * force attacks. 10 attempts per minute allows legitimate users several retries
 * if they mistype password, but makes sustained brute force attack impractical.
 */
router.post(
  '/login',
  createRateLimiter({
    limit: 10,
    windowSeconds: 60, // 1 minute
    keyPrefix: 'login',
  }),
  validateLogin,
  authController.login,
);

/**
 * POST /api/v1/auth/refresh
 * 
 * Public endpoint for refreshing access tokens. Exchanges valid refresh token
 * for new token pair with strict rotation.
 * 
 * Middleware chain:
 * 1. Rate limiter: 50 requests per minute per IP (moderate limit)
 * 2. Validation: Check refresh token presence and format
 * 3. Controller: Validate token, rotate, and return new pair
 * 
 * Higher rate limit because legitimate use case is frequent token refreshes
 * for long-lived sessions. Access tokens expire every 15 minutes, so active
 * users will hit this endpoint regularly.
 */
router.post(
  '/refresh',
  createRateLimiter({
    limit: 50,
    windowSeconds: 60, // 1 minute
    keyPrefix: 'refresh',
  }),
  validateRefresh,
  authController.refresh,
);

/**
 * POST /api/v1/auth/logout
 * 
 * Protected endpoint for user logout. Invalidates current refresh token.
 * 
 * Middleware chain:
 * 1. Authentication: Verify access token in Authorization header
 * 2. Validation: Check refresh token presence and format
 * 3. Controller: Invalidate refresh token
 * 
 * No additional rate limiting needed because endpoint requires valid authentication,
 * and authenticated users have higher default rate limits (100 req/min).
 */
router.post(
  '/logout',
  authenticate,
  validateLogout,
  authController.logout,
);

/**
 * GET /api/v1/auth/me
 * 
 * Protected endpoint to get current authenticated user information.
 * Useful for frontend to verify authentication status and retrieve user profile.
 * 
 * Middleware chain:
 * 1. Authentication: Verify access token in Authorization header
 * 2. Controller: Return user information
 * 
 * No additional validation needed because user ID comes from verified JWT token.
 */
router.get(
  '/me',
  authenticate,
  authController.getCurrentUser,
);

/**
 * PUT /api/v1/auth/profile
 *
 * Protected endpoint to update current user's profile (name, avatar_url).
 *
 * Middleware chain:
 * 1. Authentication: Verify access token in Authorization header
 * 2. Controller: Validate and update profile fields
 */
router.put(
  '/profile',
  authenticate,
  authController.updateProfile,
);

/**
 * POST /api/v1/auth/avatar
 *
 * Protected endpoint to upload user avatar image.
 * Accepts multipart/form-data with field "avatar" (max 5MB, JPEG/PNG/WebP).
 *
 * Middleware chain:
 * 1. Authentication: Verify access token
 * 2. Upload: multer processes the file
 * 3. Controller: Save file reference and update user
 */
router.post(
  '/avatar',
  authenticate,
  (req, res, next) => {
    uploadAvatar(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: { code: 'FILE_TOO_LARGE', message: 'File size must be under 5MB' },
          });
        }
        if (err.message === 'INVALID_FILE_TYPE') {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG and WebP images are allowed' },
          });
        }
        return next(err);
      }
      next();
    });
  },
  authController.uploadAvatar,
);

export default router;

