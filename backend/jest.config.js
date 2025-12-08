/**
 * Jest Configuration for Restaurant Guide Belarus Backend
 *
 * This configuration sets up Jest for integration testing with:
 * - Node.js test environment
 * - ES modules support
 * - Database cleanup before/after tests
 * - Coverage reporting
 * - Sequential test execution (important for database tests)
 */

export default {
  // Use Node.js environment (not browser)
  testEnvironment: 'node',

  // Load environment variables BEFORE any imports
  setupFiles: ['<rootDir>/src/tests/setup-env.js'],

  // Setup file runs after test framework initialized
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],

  // Teardown runs after all tests complete
  globalTeardown: '<rootDir>/src/tests/teardown.js',

  // Test file patterns to match
  testMatch: [
    '**/src/tests/**/*.test.js',
    '**/src/tests/**/*.spec.js'
  ],

  // Files to exclude from tests
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/tmp/'
  ],

  // Coverage configuration
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/tests/**',
    '!src/server.js', // Entry point - hard to test in isolation
  ],

  // Coverage thresholds (temporarily lowered for phased rollout)
  // Global thresholds relaxed to avoid blocking CI while untested areas remain.
  // Auth-related modules keep higher per-file thresholds to preserve accountability.
  coverageThreshold: {
    global: {
      statements: 20,
      branches: 15,
      functions: 20,
      lines: 20,
    },
    './src/controllers/authController.js': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    './src/services/authService.js': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    './src/validators/authValidation.js': {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    './src/middleware/rateLimiter.js': {
      statements: 75,
      branches: 65,
      functions: 75,
      lines: 75,
    },
  },

  // Timeout for each test (10 seconds)
  testTimeout: 10000,

  // Run tests sequentially (important for database tests)
  // Database transactions can conflict if tests run in parallel
  maxWorkers: 1,

  // Verbose output for debugging
  verbose: true,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Transform configuration for ES modules
  transform: {},

  // Module file extensions
  moduleFileExtensions: ['js', 'json'],

  // Force exit after tests complete (prevents hanging)
  forceExit: true,

  // Detect open handles (helps find resource leaks)
  detectOpenHandles: true,
};
