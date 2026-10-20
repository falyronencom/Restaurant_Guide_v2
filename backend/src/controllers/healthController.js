import pool from '../config/database.js';
import redisClient, { withRedisDeadline } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Health check endpoint controller.
 * 
 * This endpoint is critical for production monitoring and load balancer health checks.
 * It verifies that all critical dependencies (database, Redis) are operational.
 * 
 * Health check philosophy:
 * - Fast: Should respond in <100ms to avoid triggering load balancer timeouts
 * - Comprehensive: Check all critical dependencies, not just that the server is running
 * - Healthy or unhealthy per dependency, and nothing more: the endpoint answers
 *   without sign-in, so an error's own text (addresses, ports, the database
 *   user) goes to the log only. Until 20.10.2026 the response carried that
 *   text, and the process's memory too. Railway's health check reads only the
 *   status code; uptime tells which deploy answers.
 * 
 * Response format follows industry standards for health checks, making it compatible
 * with common monitoring tools (Kubernetes, AWS ELB, etc.).
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const healthCheck = async (req, res) => {
  const startTime = Date.now();
  
  // Track status of each dependency
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: { status: 'unknown', responseTime: null },
      redis: { status: 'unknown', responseTime: null },
    },
  };

  // Check database connectivity
  try {
    const dbStartTime = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStartTime,
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.database = {
      status: 'unhealthy',
      responseTime: null,
    };
    logger.error('Database health check failed', { error: error.message });
  }

  // Check Redis connectivity. While the client reconnects it is open but not
  // ready — answer 503 at once instead of queueing a PING; a ready client that
  // does not answer (half-open connection) is bounded by the call deadline.
  try {
    if (!redisClient.isReady) {
      throw new Error('Redis client is not ready (reconnecting)');
    }
    const redisStartTime = Date.now();
    await withRedisDeadline(redisClient.ping());
    health.checks.redis = {
      status: 'healthy',
      responseTime: Date.now() - redisStartTime,
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.redis = {
      status: 'unhealthy',
      responseTime: null,
    };
    logger.error('Redis health check failed', { error: error.message });
  }

  // Calculate total response time
  health.responseTime = Date.now() - startTime;

  // Return appropriate HTTP status code based on health
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json({
    success: health.status === 'healthy',
    data: health,
    timestamp: new Date().toISOString(),
  });
};
