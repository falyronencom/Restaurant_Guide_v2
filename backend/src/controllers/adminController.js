/**
 * Admin Controller
 *
 * Handles HTTP requests for admin-specific endpoints.
 * Currently provides admin login with role verification.
 *
 * The admin login reuses the existing auth infrastructure (verifyCredentials,
 * generateTokenPair) but adds a role gate — only users with role 'admin'
 * are allowed to authenticate through this endpoint.
 */

import * as authService from '../services/authService.js';
import logger from '../utils/logger.js';

/**
 * Admin login
 *
 * POST /api/v1/admin/auth/login
 *
 * Authenticates an admin user. Reuses the standard credential verification
 * and token generation, but rejects non-admin users even with valid credentials.
 *
 * Request body:
 * - email (optional if phone provided): Admin's email address
 * - phone (optional if email provided): Admin's phone number
 * - password: Admin's password
 *
 * Response:
 * - 200 OK: Login successful with tokens
 * - 401 Unauthorized: Invalid credentials
 * - 403 Forbidden: Valid credentials but user is not an admin
 */
export async function adminLogin(req, res, next) {
  try {
    const { email, phone, password } = req.body;

    // Validate that credentials are provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Either email or phone must be provided',
        },
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Password is required',
        },
      });
    }

    // Verify credentials using existing auth service
    const user = await authService.verifyCredentials({
      email,
      phone,
      password,
    });

    // Generic error for invalid credentials (prevents enumeration)
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password',
        },
      });
    }

    // Role gate: reject non-admin users
    if (user.role !== 'admin') {
      logger.warn('Non-admin login attempt to admin endpoint', {
        userId: user.id,
        role: user.role,
        email: user.email,
      });
      return res.status(403).json({
        success: false,
        error: {
          code: 'ADMIN_ACCESS_REQUIRED',
          message: 'Admin access required',
        },
      });
    }

    // Generate token pair for authenticated admin session
    const tokens = await authService.generateTokenPair(user);

    // Return admin user data with tokens
    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          authMethod: user.auth_method,
          lastLoginAt: user.last_login_at,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: 'Bearer',
        expiresIn: tokens.expiresIn,
      },
    });

  } catch (error) {
    next(error);
  }
}
