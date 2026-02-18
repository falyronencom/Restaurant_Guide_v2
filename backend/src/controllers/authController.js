/**
 * Authentication Controller
 * 
 * This controller handles HTTP requests for authentication endpoints. Controllers
 * are thin orchestration layers that extract data from requests, call services to
 * perform business logic, and format responses. By keeping controllers focused on
 * HTTP concerns, we maintain clean separation of concerns.
 * 
 * All controllers follow the pattern:
 * 1. Extract and validate request data
 * 2. Call appropriate service functions
 * 3. Format and return response
 * 4. Handle errors gracefully
 */

import * as authService from '../services/authService.js';
import logger from '../utils/logger.js';

/**
 * Register a new user
 * 
 * POST /api/v1/auth/register
 * 
 * This endpoint creates a new user account and automatically logs them in by
 * returning JWT tokens. This provides smooth user experience where registration
 * flows directly into app usage without requiring separate login.
 * 
 * Request body:
 * - email (optional if phone provided): User's email address
 * - phone (optional if email provided): User's phone number
 * - password: Plain text password (will be hashed)
 * - name: User's display name
 * - authMethod: 'email' or 'phone'
 * 
 * Response:
 * - 201 Created: User registered successfully with tokens
 * - 400 Bad Request: Invalid input data
 * - 409 Conflict: Email or phone already exists
 * - 429 Too Many Requests: Rate limit exceeded
 */
export async function register(req, res, next) {
  try {
    const { email, phone, password, name } = req.body;
    let { authMethod } = req.body;
    
    // Validate that at least email or phone is provided
    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Either email or phone must be provided',
        },
      });
    }
    
    // Auto-detect authMethod if not provided
    if (!authMethod) {
      if (email && !phone) {
        authMethod = 'email';
      } else if (phone && !email) {
        authMethod = 'phone';
      } else if (email && phone) {
        // Both provided, default to email
        authMethod = 'email';
      }
    }
    
    // Validate auth method matches provided credentials
    if (authMethod === 'email' && !email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Email is required when auth_method is email',
        },
      });
    }
    
    if (authMethod === 'phone' && !phone) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Phone is required when auth_method is phone',
        },
      });
    }
    
    // Create the user account
    const user = await authService.createUser({
      email,
      phone,
      password,
      name,
      authMethod,
    });
    
    // Generate token pair for immediate login
    const tokens = await authService.generateTokenPair(user);
    
    // Return user data with tokens
    // Note: We return full user object so frontend can store user profile
    return res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          authMethod: user.auth_method,
          createdAt: user.created_at,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: 'Bearer',
        expiresIn: tokens.expiresIn,
      },
    });
    
  } catch (error) {
    // Handle duplicate email/phone errors with specific response
    if (error.message === 'EMAIL_ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        },
      });
    }
    
    if (error.message === 'PHONE_ALREADY_EXISTS') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'PHONE_EXISTS',
          message: 'An account with this phone number already exists',
        },
      });
    }
    
    // Pass unexpected errors to error handling middleware
    next(error);
  }
}

/**
 * Login with existing credentials
 * 
 * POST /api/v1/auth/login
 * 
 * Authenticates a user with email/phone and password. Returns JWT tokens if
 * credentials are valid. This endpoint has stricter rate limiting to prevent
 * brute force attacks.
 * 
 * Request body:
 * - email (optional if phone provided): User's email address
 * - phone (optional if email provided): User's phone number
 * - password: User's password
 * 
 * Response:
 * - 200 OK: Login successful with tokens
 * - 401 Unauthorized: Invalid credentials
 * - 429 Too Many Requests: Rate limit exceeded
 */
export async function login(req, res, next) {
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
    
    // Verify credentials
    const user = await authService.verifyCredentials({
      email,
      phone,
      password,
    });
    
    // If credentials invalid, return generic error message
    // We don't specify whether email/phone exists or password wrong
    // This prevents username enumeration attacks
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email/phone or password',
        },
      });
    }
    
    // Generate token pair for authenticated session
    const tokens = await authService.generateTokenPair(user);
    
    // Return user data with tokens
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
    // Pass errors to error handling middleware
    next(error);
  }
}

/**
 * Refresh access token
 * 
 * POST /api/v1/auth/refresh
 * 
 * Exchanges a valid refresh token for a new access token and refresh token pair.
 * Implements strict token rotation where old refresh token is immediately
 * invalidated. If already-used token is presented, all user tokens are invalidated
 * as security measure.
 * 
 * Request body:
 * - refreshToken: Current valid refresh token
 * 
 * Response:
 * - 200 OK: New token pair issued
 * - 401 Unauthorized: Invalid or expired token
 * - 403 Forbidden: Token reuse detected (security alert)
 */
export async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    
    // Validate that refresh token is provided
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Refresh token is required',
        },
      });
    }
    
    // Attempt to refresh the token
    const result = await authService.refreshAccessToken(refreshToken);
    
    // Return new token pair with user info
    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: result.user.id,
          email: result.user.email,
          phone: result.user.phone,
          name: result.user.name,
          role: result.user.role,
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: 'Bearer',
        expiresIn: result.expiresIn,
      },
    });
    
  } catch (error) {
    // Handle specific token errors with appropriate responses
    if (error.message === 'INVALID_REFRESH_TOKEN') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired refresh token',
        },
      });
    }
    
    if (error.message === 'REFRESH_TOKEN_EXPIRED') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Refresh token has expired. Please log in again.',
        },
      });
    }
    
    if (error.message === 'REFRESH_TOKEN_REUSE_DETECTED') {
      // This is a security incident - return 403 Forbidden
      return res.status(403).json({
        success: false,
        error: {
          code: 'TOKEN_REUSE_DETECTED',
          message: 'Security alert: Token reuse detected. All sessions have been invalidated. Please log in again.',
        },
      });
    }
    
    if (error.message === 'USER_ACCOUNT_INACTIVE') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'User account is inactive',
        },
      });
    }
    
    // Pass unexpected errors to error handling middleware
    next(error);
  }
}

/**
 * Logout user
 * 
 * POST /api/v1/auth/logout
 * 
 * Invalidates the user's current refresh token, preventing further token refreshes.
 * Access token continues to work until natural expiration (15 minutes) which is
 * acceptable given short lifetime.
 * 
 * This endpoint requires authentication via access token in Authorization header.
 * 
 * Request body:
 * - refreshToken: Current refresh token to invalidate
 * 
 * Response:
 * - 200 OK: Logout successful
 * - 401 Unauthorized: Not authenticated
 */
export async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    
    // Validate that refresh token is provided
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Refresh token is required',
        },
      });
    }
    
    // Invalidate the refresh token
    await authService.invalidateRefreshToken(refreshToken);
    
    // Log the logout for audit trail
    logger.info('User logged out', { 
      userId: req.user.userId, // Set by authentication middleware
    });
    
    // Return success response
    return res.status(200).json({
      success: true,
      data: {
        message: 'Logged out successfully',
      },
    });
    
  } catch (error) {
    // Pass errors to error handling middleware
    next(error);
  }
}

/**
 * Update current user's profile
 *
 * PUT /api/v1/auth/profile
 *
 * Updates the authenticated user's profile fields (name, avatar_url).
 * At least one field must be provided.
 *
 * Request body:
 * - name (optional): New display name (max 100 chars)
 * - avatar_url (optional): New avatar URL (max 500 chars)
 *
 * Response:
 * - 200 OK: Updated user information
 * - 400 Bad Request: No fields provided or validation error
 * - 401 Unauthorized: Not authenticated
 * - 404 Not Found: User not found
 */
export async function updateProfile(req, res, next) {
  try {
    const userId = req.user.userId;
    const { name, avatar_url } = req.body;

    // Ensure at least one field is provided
    if (name === undefined && avatar_url === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'At least one field (name or avatar_url) must be provided',
        },
      });
    }

    const user = await authService.updateUserProfile(userId, {
      name,
      avatarUrl: avatar_url,
    });

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
          avatarUrl: user.avatar_url,
          emailVerified: user.email_verified,
          phoneVerified: user.phone_verified,
          createdAt: user.created_at,
        },
      },
    });

  } catch (error) {
    if (error.message === 'NAME_EMPTY') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name cannot be empty' },
      });
    }
    if (error.message === 'NAME_TOO_LONG') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name must be 100 characters or fewer' },
      });
    }
    if (error.message === 'AVATAR_URL_TOO_LONG') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Avatar URL must be 500 characters or fewer' },
      });
    }
    if (error.message === 'USER_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }
    next(error);
  }
}

/**
 * Upload user avatar
 *
 * POST /api/v1/auth/avatar
 *
 * Accepts a multipart/form-data file upload (field: "avatar").
 * Saves the file and updates the user's avatar_url in database.
 *
 * Response:
 * - 200 OK: Avatar uploaded, returns new avatar URL
 * - 400 Bad Request: No file or invalid file type
 * - 401 Unauthorized: Not authenticated
 */
export async function uploadAvatar(req, res, next) {
  try {
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE',
          message: 'No avatar file provided',
        },
      });
    }

    // Build public URL for the uploaded file
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Update avatar_url in database
    const user = await authService.updateUserProfile(userId, { avatarUrl });

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
          avatarUrl: user.avatar_url,
          emailVerified: user.email_verified,
          phoneVerified: user.phone_verified,
          createdAt: user.created_at,
        },
      },
    });

  } catch (error) {
    if (error.message === 'INVALID_FILE_TYPE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: 'Only JPEG, PNG and WebP images are allowed',
        },
      });
    }
    next(error);
  }
}

/**
 * Get current authenticated user
 *
 * GET /api/v1/auth/me
 * 
 * Returns information about the currently authenticated user based on the
 * access token in the Authorization header. Useful for frontend to verify
 * authentication status and retrieve user profile.
 * 
 * This endpoint requires authentication.
 * 
 * Response:
 * - 200 OK: User information
 * - 401 Unauthorized: Not authenticated
 */
export async function getCurrentUser(req, res, next) {
  try {
    // User ID is extracted from JWT by authentication middleware
    const userId = req.user.userId;
    
    // Find user in database
    const user = await authService.findUserById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
    }
    
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
          emailVerified: user.email_verified,
          phoneVerified: user.phone_verified,
          createdAt: user.created_at,
        },
      },
    });
    
  } catch (error) {
    next(error);
  }
}

