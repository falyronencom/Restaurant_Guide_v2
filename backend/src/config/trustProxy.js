/**
 * Trusted proxy hops — how many X-Forwarded-For entries, counted from the
 * right, Express treats as Railway's own (server.js `trust proxy`). req.ip is
 * the entry just left of them: the direct client's address, the key of every
 * per-address limit.
 *
 * Why 2 (step 0 of directive D5, 25.10.2026). Until then the setting was 1, on
 * the assumption that Railway's edge appends the client last (OSB-G1, 04.07).
 * The production probe of 25.10 16:00Z disproved it: one machine with one
 * public address landed in at least four separate limiter counters within a
 * minute — one per path through the edge, while a single connection always
 * stayed in one. The right-most entry is a Railway hop, not the client.
 * A Railway employee on Help Station (12.06.2026) describes the chain as the
 * client first, «you may see another hop»; a user's capture (08.09.2026) saw
 * exactly two entries, the client and a public CDN-layer address. Other
 * replies there disagree — whether the edge strips a forged chain or appends
 * to it is not documented. With 2 hops either way gives the client.
 *
 * What the probe does not exclude: an edge that keeps the client's forged
 * chain and appends only its hop. Then the forged entry would become req.ip.
 * The probe saw only the right-most entry, so it cannot tell that case from
 * the two above; the probe after deploy sends a fresh forged address, from
 * two networks, precisely to see that it opens no counter of its own. Should
 * it, TRUST_PROXY_HOPS=1 in the Railway dashboard restores the old rule on
 * the next restart, without a build. 1 cannot be forged under any edge
 * behaviour the probe left open (at worst clients share a hop's counter), so a malformed value
 * falls back to it, not to the default.
 *
 * MUST stay an integer, never `true`: `true` trusts the whole client-supplied
 * chain and lets anyone mint unlimited per-address buckets. Hence the ceiling
 * — a CDN in front of the edge (Railway CDN, Cloudflare) adds one hop, and
 * then the probe is repeated before the number moves.
 *
 * Pure: reads the env object it is given and returns the warning instead of
 * logging it — server.js logs it once at startup.
 */

/** Railway's edge chain: the client, then one hop of Railway's own. */
export const DEFAULT_TRUST_PROXY_HOPS = 2;

/** A malformed value — the rule no X-Forwarded-For can forge. */
export const FALLBACK_TRUST_PROXY_HOPS = 1;

/** Above this the setting starts trusting what the client wrote. */
export const MAX_TRUST_PROXY_HOPS = 3;

/**
 * Resolve the trusted hop count from the environment.
 *
 * @param {Object} [env] - Environment map (process.env in production)
 * @returns {{ hops: number, warning: string|null }} unset → the default;
 *   malformed or out of range → FALLBACK_TRUST_PROXY_HOPS with a warning
 */
export const resolveTrustProxyHops = (env = {}) => {
  const raw = env.TRUST_PROXY_HOPS;

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { hops: DEFAULT_TRUST_PROXY_HOPS, warning: null };
  }

  const text = String(raw).trim();
  const parsed = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;

  if (parsed === null || parsed < 1 || parsed > MAX_TRUST_PROXY_HOPS) {
    return {
      hops: FALLBACK_TRUST_PROXY_HOPS,
      warning:
        `TRUST_PROXY_HOPS must be a whole number from 1 to ${MAX_TRUST_PROXY_HOPS} ` +
        `(${raw}): falling back to ${FALLBACK_TRUST_PROXY_HOPS}, the rule no ` +
        'forged X-Forwarded-For can pass',
    };
  }

  return { hops: parsed, warning: null };
};
