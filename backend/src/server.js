import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { testConnection, closePool } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import routes from './routes/index.js';
import { rateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { UPLOADS_ROOT } from './middleware/upload.js';
import * as ocrJobPoller from './services/ocr/ocrJobPoller.js';
import * as refreshTokenPruner from './services/refreshTokenPruner.js';
import { JOB_DURATION_BOUND_MS as OCR_JOB_DURATION_BOUND_MS } from './services/ocr/ocrService.js';
import { resolveShutdownBudget } from './config/shutdown.js';
import { resolveRefreshReuseGraceSeconds } from './config/auth.js';
import { createGracefulShutdown, installShutdownHandlers } from './utils/gracefulShutdown.js';

// Load environment variables from .env file
dotenv.config();

/**
 * Initialize Express application with production-ready configuration.
 * ...existing code...
 */
const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Graceful-shutdown budget — resolved once, from Railway's drain period when
 * it is set (config/shutdown.js). startServer() logs it together with the
 * misalignments it reports; gracefulShutdown() arms its force-exit timer with it.
 */
const shutdownBudget = resolveShutdownBudget(process.env, {
  jobBoundMs: OCR_JOB_DURATION_BOUND_MS,
});

/**
 * Reuse grace window, resolved once for the startup log only. The refresh path
 * resolves it per call (authService.handleReusedToken) so the value can be
 * changed without a code path caching it.
 */
const refreshReuseGrace = resolveRefreshReuseGraceSeconds(process.env);

/**
 * Trust exactly ONE reverse-proxy hop (Railway's edge terminates TLS and
 * forwards X-Forwarded-For). Without this, req.ip is the proxy address and
 * every per-IP rate limit collapses into a single shared bucket (OSB-G1).
 *
 * MUST stay the integer 1, never `true`: `true` trusts the entire
 * client-supplied X-Forwarded-For chain, letting an attacker mint unlimited
 * per-IP buckets by spoofing the header. Revisit the hop count only if
 * another trusted proxy layer is ever added in front of the app.
 */
app.set('trust proxy', 1);

/**
 * Security middleware (helmet) - MUST be first.
 * ...existing code...
 */
app.use(helmet());

/**
 * CORS (Cross-Origin Resource Sharing) middleware.
 * ...existing code...
 */
const corsOptions = {
  origin (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }
    // Always allow localhost (Flutter Web dev server uses random ports)
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      return callback(null, true);
    }
    // Check additional allowed origins from env var
    if (process.env.CORS_ORIGIN) {
      const allowed = process.env.CORS_ORIGIN.split(',').map(s => s.trim());
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
};
app.use(cors(corsOptions));

/**
 * HTTP request logging middleware.
 * ...existing code...
 */
const morganFormat = NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(
  morgan(morganFormat, {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }),
);

/**
 * Request parsing middleware.
 * ...existing code...
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Request correlation ID middleware.
 * ...existing code...
 */
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

/**
 * Global rate limiting middleware.
 * ...existing code...
 */
app.use(rateLimiter);

/**
 * Serve uploaded files (avatars, images) as static assets.
 */
app.use('/uploads', express.static(UPLOADS_ROOT));

/**
 * Mount API routes under /api prefix.
 * ...existing code...
 */
app.use('/api', routes);

/**
 * 404 Not Found handler for undefined routes.
 * ...existing code...
 */
app.use(notFoundHandler);

/**
 * Centralized error handling middleware.
 * ...existing code...
 */
app.use(errorHandler);

/**
 * Graceful shutdown handler. The sequence and its exit code live in
 * utils/gracefulShutdown.js: force-exit timer first, both background loops
 * stopped in parallel with server.close() (stop() waits for the work in
 * flight, which must not queue behind a slow request still draining), then
 * the pool and Redis. Exit code 0 only for a planned stop (SIGTERM, SIGINT);
 * a crash shutdown ends with 1. The server is read when the shutdown starts —
 * it is assigned at the bottom of this file.
 */
const gracefulShutdown = createGracefulShutdown({
  getServer: () => server,
  backgroundLoops: [
    // Waits for the in-flight OCR job and the stale sweep.
    {
      stop: () => ocrJobPoller.stop(),
      failureMessage: 'OCR poller stop failed during shutdown',
    },
    // Waits only for the prune batch in flight.
    {
      stop: () => refreshTokenPruner.stop(),
      failureMessage: 'Refresh token pruner stop failed during shutdown',
    },
  ],
  closePool,
  disconnectRedis,
  timeoutMs: shutdownBudget.timeoutMs,
  logger,
});

/**
 * Application startup sequence.
 * ...existing code...
 */
const startServer = async () => {
  try {
    logger.info('Starting Restaurant Guide Belarus Backend API', {
      nodeEnv: NODE_ENV,
      port: PORT,
      nodeVersion: process.version,
    });

    // Shutdown budget vs. the platform drain and the OCR job bound — the only
    // place the misalignment surfaces without telemetry (config/shutdown.js)
    logger.info('Graceful shutdown budget resolved', {
      timeoutMs: shutdownBudget.timeoutMs,
      source: shutdownBudget.source,
      drainingMs: shutdownBudget.drainingMs,
      onRailway: shutdownBudget.onRailway,
      ocrJobBoundMs: OCR_JOB_DURATION_BOUND_MS,
    });
    for (const warning of shutdownBudget.warnings) {
      logger.warn(`Graceful shutdown budget: ${warning}`);
    }

    // How long a burned refresh token stays redeemable (config/auth.js). Said
    // once at startup because the value is a security posture, and because a
    // malformed variable must not be discovered one log line per refresh.
    logger.info('Refresh reuse grace window resolved', {
      graceSeconds: refreshReuseGrace.seconds,
      enabled: refreshReuseGrace.seconds > 0,
    });
    if (refreshReuseGrace.warning) {
      logger.warn(`Refresh reuse grace window: ${refreshReuseGrace.warning}`);
    }

    // Test database connection
    logger.info('Testing database connection...');
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting.');
      process.exit(1);
    }

    // Connect to Redis
    logger.info('Connecting to Redis...');
    const redisConnected = await connectRedis();
    if (!redisConnected) {
      logger.error('Failed to connect to Redis. Exiting.');
      process.exit(1);
    }

    // Start OCR background poller (processes pending menu OCR jobs)
    ocrJobPoller.start();

    // Start refresh-token pruner (deletes rows past expiry + retention tail).
    // Its policy is resolved here rather than at module load so the warnings
    // land in the startup log next to the other two, and it prunes once
    // immediately — redeploys can outpace the interval (config/refreshTokenPrune.js).
    const prunePolicy = refreshTokenPruner.start();
    logger.info('Refresh token pruner: policy resolved', {
      retentionDays: prunePolicy.retentionDays,
      intervalMs: prunePolicy.intervalMs,
    });
    for (const warning of prunePolicy.warnings) {
      logger.warn(`Refresh token pruner: policy ${warning}`);
    }

    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server listening on port ${PORT}`, {
        environment: NODE_ENV,
        apiEndpoint: `http://localhost:${PORT}/api`,
        healthCheck: `http://localhost:${PORT}/api/v1/health`,
      });
    });

    // Register graceful shutdown handlers: SIGTERM/SIGINT, plus uncaught
    // exceptions and unhandled rejections (those end with a non-zero code)
    installShutdownHandlers({ processRef: process, gracefulShutdown, logger });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

// Create HTTP server instance (needed for graceful shutdown)
let server;

// Only start server if not in test environment
// In tests, app is imported without starting the server
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(0); // Listen on port 0 temporarily
  server.close(); // Close it immediately

  // Start the application
  startServer();
} else {
  // In test environment, create a mock server reference
  server = { close: () => {}, listen: () => {} };
}

export default app;
