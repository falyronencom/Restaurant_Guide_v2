import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import { testConnection, closePool } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import routes from './routes/index.js';
import { rateLimiter, globalRateLimitTiers } from './middleware/rateLimiter.js';
import { AppError, BODY_LIMIT_MB, errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { INSUFFICIENT_ROLE_MESSAGE } from './middleware/auth.js';
import { requestGuard } from './middleware/requestGuard.js';
import { UPLOADS_ROOT } from './middleware/upload.js';
import * as ocrJobPoller from './services/ocr/ocrJobPoller.js';
import * as refreshTokenPruner from './services/refreshTokenPruner.js';
import { JOB_DURATION_BOUND_MS as OCR_JOB_DURATION_BOUND_MS } from './services/ocr/ocrService.js';
import { resolveShutdownBudget } from './config/shutdown.js';
import { resolveRefreshReuseGraceSeconds } from './config/auth.js';
import { resolveTrustProxyHops } from './config/trustProxy.js';
import {
  createGracefulShutdown,
  installShutdownHandlers,
  isPlannedShutdown,
} from './utils/gracefulShutdown.js';

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
 * Trust Railway's edge chain — TRUST_PROXY_HOPS entries of X-Forwarded-For
 * counted from the right, 2 by default (config/trustProxy.js). req.ip is the
 * direct client's address, the key of every per-address limit; with 1 it was
 * the Railway hop the request came through, so clients sharing a hop shared
 * every such limit (production probe 25.10.2026, directive D5 step 0).
 *
 * MUST stay an integer, never `true`: `true` trusts the entire
 * client-supplied X-Forwarded-For chain, letting an attacker mint unlimited
 * per-IP buckets by spoofing the header. Resolved once: a change of the
 * variable takes effect on the next restart.
 */
const trustProxy = resolveTrustProxyHops(process.env);
app.set('trust proxy', trustProxy.hops);

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
    // Any other site is refused like a role the route does not admit: 403
    // FORBIDDEN with its sentence, a warning in the log. Until 20.10.2026 a
    // plain Error — a 500 with its stack in the log.
    callback(new AppError(INSUFFICIENT_ROLE_MESSAGE, 403, 'FORBIDDEN'));
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
 * Request correlation ID middleware.
 * ...existing code...
 */
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
});

/**
 * Global rate limiting middleware — ahead of every route, and so of every
 * route's authenticate: it verifies the access token itself to count a
 * signed-in request against its account, anything else against its address
 * (middleware/rateLimiter.js). It reads only the headers, so it stands before
 * the body is read: a request it refuses with 429 is not parsed (until
 * 20.10.2026 every body was, up to 10 MB, refused or not).
 */
app.use(rateLimiter);

/**
 * Request parsing middleware — after the limiter, before the request guard,
 * which reads the parsed body.
 * ...existing code...
 *
 * inflate: false — a compressed body (any Content-Encoding but identity) is
 * refused with 415, not unpacked: until 25.10.2026 it was unpacked before
 * parsing and the limit counted the unpacked bytes. No client of ours sends
 * one (the app's and the panel's Dio, the site's fetch; checked that day).
 * Their refusals of a body too large, compressed, in a foreign charset or
 * unreadable as a form answer in Russian with codes of their own
 * (errorHandler.js BODY_PARSER_REFUSALS); invalid JSON keeps INVALID_JSON.
 */
app.use(express.json({ limit: `${BODY_LIMIT_MB}mb`, inflate: false }));
app.use(express.urlencoded({ extended: true, limit: `${BODY_LIMIT_MB}mb`, inflate: false }));

/**
 * Serve uploaded files (avatars, images) as static assets.
 */
app.use('/uploads', express.static(UPLOADS_ROOT));

/**
 * Request guard — before any route can reach the database: a NUL anywhere in
 * the request is refused with 400, a page number past MAX_PAGE (the site's
 * ceiling) or an offset past MAX_OFFSET with 422 (middleware/requestGuard.js).
 */
app.use('/api', requestGuard);

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
    // Waits for the in-flight OCR job (its PDF parse is killed, not awaited)
    // and the stale sweep; on a deploy it also marks the job in flight, so a
    // process killed at the budget's end leaves a job the sweep retries.
    {
      stop: (reason) => ocrJobPoller.stop({ planned: isPlannedShutdown(reason) }),
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

    // Whose address req.ip is (config/trustProxy.js): said at startup because
    // every per-address limit keys on it, and an override set in the Railway
    // dashboard shows nowhere else.
    logger.info('Trusted proxy hops resolved', { hops: trustProxy.hops });
    if (trustProxy.warning) {
      logger.warn(`Trusted proxy hops: ${trustProxy.warning}`);
    }

    // The global limiter's numbers as read from RATE_LIMIT_* (middleware/
    // rateLimiter.js). Said at startup because the signed-in tier first counts
    // from 16.10.2026: a value nobody looked at while it had no effect shows
    // here, before it refuses anyone.
    logger.info('Rate limiter tiers resolved', {
      signedInPerAccount: globalRateLimitTiers.tiers.user,
      anonymousPerAddress: globalRateLimitTiers.tiers.ip,
    });
    for (const warning of globalRateLimitTiers.warnings) {
      logger.warn(`Rate limiter: ${warning}`);
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
