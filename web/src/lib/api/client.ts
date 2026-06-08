import 'server-only';

import { ApiError, type ApiResponse } from './types';

/*
 * Server-only fetch wrapper for the Nirivio public API.
 *
 * Why server-only:
 *   The API_URL env var has NO NEXT_PUBLIC_ prefix on purpose (D4 + directive
 *   constraint). Bundling it into client code would expose the upstream URL
 *   in the browser's network panel and JS bundle. `import 'server-only'`
 *   throws at build time if any client component imports this module.
 *
 * Calling pattern:
 *   - Called from Server Components, route handlers, generateMetadata,
 *     generateStaticParams.
 *   - Throws ApiError on non-success envelope or transport failure; consumers
 *     handle via try/catch or let Next.js error boundary catch.
 *
 * Envelope contract (Brief 1):
 *   Success: { success: true, data: <payload> }
 *   Failure: { success: false, error: { message, statusCode } }
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Fetch a typed JSON payload from the public API.
 *
 * @param path - Absolute path under /api/v1/public/ (must start with /).
 * @param init - Optional RequestInit; merged with defaults (Accept JSON,
 *               AbortController timeout).
 * @returns The unwrapped `data` field of the success envelope.
 * @throws  ApiError on non-success envelope OR HTTP failure OR timeout.
 */
export async function serverFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    throw new ApiError(
      500,
      'API_URL env var is not set. Add it to web/.env.local for development or to Vercel project settings for deploy.',
    );
  }

  const url = `${apiUrl}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    throw new ApiError(0, `Fetch failed for ${path}: ${message}`);
  }

  clearTimeout(timeoutId);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      `Non-JSON response from ${path} (status ${response.status})`,
    );
  }

  if (!isApiResponse(body)) {
    throw new ApiError(
      response.status,
      `Unexpected response shape from ${path}`,
    );
  }

  if (!body.success) {
    throw new ApiError(
      body.error.statusCode ?? response.status,
      body.error.message,
      body.error.code,
    );
  }

  return body.data as T;
}

function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success: unknown }).success === 'boolean'
  );
}
